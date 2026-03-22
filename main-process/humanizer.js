// main-process/humanizer.js
// 审批弹窗人性化描述生成器
// 将工具调用的原始参数转换为用户可读的自然语言

'use strict';

/**
 * 从完整路径中提取文件名
 * @param {string} filePath
 * @returns {string}
 */
function _extractFileName(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || filePath;
}

class ApprovalHumanizer {
  /**
   * 将工具调用转换为自然语言描述
   * @param {string} toolName - 技能名
   * @param {Object} args - 工具参数
   * @param {Object} preview - 预览数据（file_edit 用）
   * @returns {{ title: string, description: string, isDangerous: boolean, preview?: Object }}
   */
  static humanize(toolName, args, preview = null) {
    const handler = this._handlers[toolName];
    if (!handler) {
      return {
        title: '确认执行操作',
        description: `AI 请求执行 ${toolName}`,
        isDangerous: false
      };
    }
    return handler.call(this, args || {}, preview);
  }

  static _humanizeFileWrite(args) {
    const fileName = _extractFileName(args.path);
    const content = String(args.content || '');
    const charCount = content.length;
    const lineCount = content.split('\n').length;

    let typeHint = '';
    if (/\.json$/i.test(args.path)) typeHint = '（JSON）';
    else if (/\.html?$/i.test(args.path)) typeHint = '（HTML）';
    else if (/\.(js|ts|py|sh|ps1)$/i.test(args.path)) typeHint = '（代码）';

    const sizeDesc = charCount > 1000
      ? `${lineCount} 行，约 ${(charCount / 1024).toFixed(1)} KB`
      : `${lineCount} 行，${charCount} 字`;

    return {
      title: '确认创建/覆盖文件',
      description: `AI 想要创建文件：${fileName}\n${sizeDesc} ${typeHint}`,
      isDangerous: false
    };
  }

  static _humanizeFileEdit(args, preview) {
    const fileName = _extractFileName(args.path);
    const oldLines = args.old_string ? args.old_string.split('\n').length : 0;
    const newLines = args.new_string ? args.new_string.split('\n').length : 0;
    const action = !args.old_string ? '追加' : '替换';
    const startLine = preview?.startLine || '?';

    return {
      title: '确认编辑文件',
      description: `AI 想要编辑文件：${fileName}\n第 ${startLine} 行，${action} ${Math.max(oldLines, newLines)} 行`,
      isDangerous: false,
      preview
    };
  }

  static _humanizeMultiFileEdit(args) {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    const fileList = edits.map(e => {
      const name = _extractFileName(e.path);
      const action = !e.old_string ? '追加' : `替换 ${e.old_string.split('\n').length} 行`;
      return `  • ${name} — ${action}`;
    }).join('\n');

    return {
      title: '确认批量编辑',
      description: `AI 想要同时编辑 ${edits.length} 个文件（全部成功才保存）\n${fileList}`,
      isDangerous: false
    };
  }

  static _humanizeBashRun(args) {
    const cmd = String(args.command || '');
    const timeoutSec = Math.round((args.timeout || 30000) / 1000);
    const dangerous = ['format', 'diskpart', 'del /s', 'rm -rf', 'reg delete', 'taskkill'];
    const isDangerous = dangerous.some(k => cmd.toLowerCase().includes(k));

    return {
      title: isDangerous ? '高风险命令' : '确认执行命令',
      description: `AI 想要执行命令：\n${cmd}\n\n超时: ${timeoutSec} 秒${isDangerous ? '\n此命令包含风险操作，请仔细审查' : ''}`,
      isDangerous
    };
  }

  static _humanizeOpenApp(args) {
    const appMap = {
      notepad: '记事本', code: 'VS Code', explorer: '文件浏览器',
      calc: '计算器', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox'
    };
    const display = appMap[String(args.app_name || '').toLowerCase()] || args.app_name;

    return {
      title: '确认打开应用',
      description: `AI 想要打开应用：${display}`,
      isDangerous: false
    };
  }

  static _humanizeGitOps(args) {
    if (args.action === 'commit') {
      return {
        title: '确认提交代码',
        description: `AI 想要提交代码\n消息：'${args.message || '(空)'}'`,
        isDangerous: false
      };
    }
    return {
      title: '确认 Git 操作',
      description: `AI 想要执行 git ${args.action}`,
      isDangerous: false
    };
  }
}

// 处理器映射（放在类外避免 static 初始化问题）
ApprovalHumanizer._handlers = {
  file_write: ApprovalHumanizer._humanizeFileWrite,
  file_edit: ApprovalHumanizer._humanizeFileEdit,
  multi_file_edit: ApprovalHumanizer._humanizeMultiFileEdit,
  bash_run: ApprovalHumanizer._humanizeBashRun,
  open_app: ApprovalHumanizer._humanizeOpenApp,
  git_ops: ApprovalHumanizer._humanizeGitOps
};

module.exports = ApprovalHumanizer;
