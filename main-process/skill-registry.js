// 技能注册中心
// 扫描并加载所有 SKILL.md 文件，管理技能生命周期
// 支持内置技能目录和用户自定义技能目录

const fs = require('fs');
const path = require('path');
const os = require('os');

class SkillRegistry {
  constructor(app) {
    // 内置技能目录（项目 skills/）
    this.bundledDir = path.join(__dirname, '..', 'skills');
    // 用户自定义技能目录（userData/skills/）
    this.userDir = app ? path.join(app.getPath('userData'), 'skills') : null;
    // name → skill 对象
    this.skills = new Map();
  }

  // 扫描并加载所有技能
  loadSkills() {
    this.skills.clear();

    // 1. 加载内置技能
    this._scanDirectory(this.bundledDir, 'bundled');

    // 2. 加载用户技能（同名覆盖内置）
    if (this.userDir && fs.existsSync(this.userDir)) {
      this._scanDirectory(this.userDir, 'user');
    }

    console.log(`[SkillRegistry] 已加载 ${this.skills.size} 个技能`);
    return this.skills.size;
  }

  // 扫描目录下所有子目录中的 SKILL.md
  _scanDirectory(dir, source) {
    if (!fs.existsSync(dir)) {
      console.log(`[SkillRegistry] 目录不存在，跳过: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const skill = this._parseSkillMd(skillMdPath);
        if (skill) {
          skill.source = source;
          skill.directory = path.join(dir, entry.name);
          this.skills.set(skill.name, skill);
          console.log(`[SkillRegistry] 已加载技能: ${skill.name} (${source})`);
        }
      } catch (error) {
        console.error(`[SkillRegistry] 解析失败: ${skillMdPath}`, error.message);
      }
    }
  }

  // 解析单个 SKILL.md 文件
  // 格式：YAML frontmatter（--- ... ---）+ Markdown 正文
  _parseSkillMd(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 提取 YAML frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!frontmatterMatch) {
      console.warn(`[SkillRegistry] 无 YAML frontmatter: ${filePath}`);
      return null;
    }

    const yamlText = frontmatterMatch[1];
    const instructions = content.slice(frontmatterMatch[0].length).trim();

    // 用正则解析 YAML（不依赖 js-yaml）
    const parsed = this._parseSimpleYaml(yamlText);

    if (!parsed.name) {
      console.warn(`[SkillRegistry] 缺少 name 字段: ${filePath}`);
      return null;
    }

    // 解析 metadata（可能是 JSON 字符串或普通对象）
    let metadata = {};
    if (parsed.metadata) {
      if (typeof parsed.metadata === 'string') {
        try {
          metadata = JSON.parse(parsed.metadata);
        } catch (e) {
          console.warn(`[SkillRegistry] metadata JSON 解析失败: ${filePath}`);
        }
      } else {
        metadata = parsed.metadata;
      }
    }

    return {
      name: parsed.name,
      description: parsed.description || '',
      metadata,
      userInvocable: parsed['user-invocable'] === 'true' || parsed['user-invocable'] === true,
      instructions,
      filePath
    };
  }

  // 简单 YAML 解析器（正则实现，支持单层键值对）
  _parseSimpleYaml(yamlText) {
    const result = {};
    const lines = yamlText.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 匹配 key: value 格式
      const match = trimmed.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // 布尔值转换
        if (value === 'true') value = true;
        else if (value === 'false') value = false;

        result[key] = value;
      }
    }

    return result;
  }

  // 根据当前环境过滤可用技能
  getEligibleSkills() {
    const eligible = [];
    const currentOS = process.platform;

    for (const [name, skill] of this.skills) {
      const requires = skill.metadata.requires || {};

      // 检查操作系统要求
      if (requires.os && Array.isArray(requires.os)) {
        if (!requires.os.includes(currentOS)) {
          continue;
        }
      }

      // 检查必要的可执行文件
      if (requires.bins && Array.isArray(requires.bins)) {
        let allBinsAvailable = true;
        for (const bin of requires.bins) {
          if (!this._isBinAvailable(bin)) {
            allBinsAvailable = false;
            break;
          }
        }
        if (!allBinsAvailable) continue;
      }

      eligible.push({
        name: skill.name,
        description: skill.description,
        dangerous: !!skill.metadata.dangerous,
        confirm: !!skill.metadata.confirm,
        userInvocable: skill.userInvocable,
        source: skill.source
      });
    }

    return eligible;
  }

  // 检查可执行文件是否在 PATH 中
  _isBinAvailable(binName) {
    const { execSync } = require('child_process');
    try {
      const cmd = process.platform === 'win32'
        ? `where ${binName}`
        : `which ${binName}`;
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // 生成系统提示词 XML 片段
  formatForPrompt() {
    const eligible = this.getEligibleSkills();
    if (eligible.length === 0) return '';

    let xml = '<available_skills>\n';
    for (const skill of eligible) {
      const fullSkill = this.skills.get(skill.name);
      xml += `<skill>\n`;
      xml += `  <name>${skill.name}</name>\n`;
      xml += `  <description>${skill.description}</description>\n`;
      if (fullSkill.instructions) {
        xml += `  <instructions>\n${fullSkill.instructions}\n  </instructions>\n`;
      }
      xml += `</skill>\n`;
    }
    xml += '</available_skills>';

    return xml;
  }

  // 生成 DeepSeek function calling tools 数组
  buildToolsArray() {
    const eligible = this.getEligibleSkills();
    const tools = [];

    for (const skill of eligible) {
      const fullSkill = this.skills.get(skill.name);
      const params = this._extractParameters(fullSkill.instructions);

      tools.push({
        type: 'function',
        function: {
          name: skill.name,
          description: skill.description,
          parameters: params
        }
      });
    }

    return tools;
  }

  // 从 SKILL.md 的 instructions 中提取参数定义
  _extractParameters(instructions) {
    if (!instructions) {
      return { type: 'object', properties: {}, required: [] };
    }

    const properties = {};
    const required = [];

    // 匹配 "- paramName (type, 必须/可选): description" 格式
    const paramRegex = /^-\s+(\w+)\s*\(([^)]+)\)\s*[：:]\s*(.+)$/gm;
    let match;

    while ((match = paramRegex.exec(instructions)) !== null) {
      const paramName = match[1];
      const typeInfo = match[2];
      const description = match[3].trim();

      // 解析类型
      const typeParts = typeInfo.split(',').map(s => s.trim());
      let paramType = 'string';
      let isRequired = false;

      for (const part of typeParts) {
        if (['string', 'number', 'boolean', 'integer', 'array', 'object'].includes(part)) {
          paramType = part;
        }
        if (part === '必须' || part === 'required') {
          isRequired = true;
        }
      }

      // 提取默认值
      const defaultMatch = description.match(/默认\s*(.+?)(?:[，,]|$)/);
      const prop = { type: paramType, description };
      if (defaultMatch) {
        const defaultVal = defaultMatch[1].trim();
        if (paramType === 'number' || paramType === 'integer') {
          prop.default = Number(defaultVal);
        } else if (paramType === 'boolean') {
          prop.default = defaultVal === 'true';
        } else {
          prop.default = defaultVal;
        }
      }

      properties[paramName] = prop;
      if (isRequired) {
        required.push(paramName);
      }
    }

    return { type: 'object', properties, required };
  }

  // 获取单个技能详情
  getSkill(name) {
    return this.skills.get(name) || null;
  }

  // 检查技能是否需要用户确认
  requiresConfirmation(name) {
    const skill = this.skills.get(name);
    return skill ? !!skill.metadata.confirm : false;
  }

  // 检查技能是否危险
  isDangerous(name) {
    const skill = this.skills.get(name);
    return skill ? !!skill.metadata.dangerous : false;
  }
}

module.exports = SkillRegistry;
