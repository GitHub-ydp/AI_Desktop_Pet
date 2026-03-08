// 意图分类器 - 轻量级关键词规则（< 5ms，无 LLM 调用）
// 渲染进程，同步函数

(function () {
  'use strict';

  // 意图类型及对应触发词
  const INTENT_KEYWORDS = {
    chat: [
      '你好', '嗨', '在吗', '聊聊', '陪我', '无聊', '开心', '难过',
      '心情', '感觉', '想你', '谢谢', '晚安', '早安', '么么', '哈哈',
      '嘿', '嗯嗯', '辛苦', '加油'
    ],
    task: [
      '提醒', '打开', '新建', '创建', '删除', '移动', '复制', '重命名',
      '设置', '关机', '定时', '帮我做', '执行', '运行', '安装', '卸载',
      '下载', '上传', '备份', '整理'
    ],
    search: [
      '是什么', '怎么', '为什么', '哪里', '谁是', '多少', '查一下',
      '搜索', '百科', '天气', '新闻', '什么意思', '告诉我', '请问',
      '如何', '哪个', '几点', '多大'
    ],
    creative: [
      '写一首', '编一个', '故事', '诗歌', '作文', '歌词', '小说',
      '起名', '文案', '剧本', '创作', '想象', '编造', '写一段',
      '续写', '改写', '仿写'
    ],
    code: [
      '代码', '脚本', '函数', '变量', '编程', '程序', '调试', 'bug',
      'python', 'javascript', '算法', '正则', 'api', '报错', '编译',
      '接口', '数据库', 'sql'
    ],
    vision: [
      '图片', '截图', '照片', '看看这', '图中', '分析图', '识别',
      'ocr', '拍的', '屏幕', '图像', '这张图', '看图', '图上'
    ]
  };

  // 意图到场景的映射（复用现有 llmSceneConfig 场景）
  const INTENT_TO_SCENE = {
    chat: 'chat',
    task: 'chat',
    search: 'chat',
    creative: 'chat',
    code: 'chat',
    vision: 'vision'
  };

  /**
   * 分类用户消息意图
   * @param {string} message - 用户输入
   * @returns {{ intent: string, confidence: number, reasoning: string, scene: string }}
   */
  function classify(message) {
    if (!message || typeof message !== 'string') {
      return { intent: 'chat', confidence: 1.0, reasoning: '空输入，默认聊天', scene: 'chat' };
    }

    const text = message.toLowerCase();
    const scores = {};
    const matched = {};

    // 计算每种意图的匹配分数
    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      const hits = keywords.filter(kw => text.includes(kw));
      scores[intent] = hits.length;
      matched[intent] = hits;
    }

    // 找最高分和次高分
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topIntent, topScore] = sorted[0];
    const secondScore = sorted[1] ? sorted[1][1] : 0;

    // 如果没有任何匹配，默认 chat
    if (topScore === 0) {
      return { intent: 'chat', confidence: 0.5, reasoning: '无关键词匹配，默认聊天', scene: 'chat' };
    }

    // 计算置信度
    const epsilon = 0.1;
    const confidence = Math.min(0.99, topScore / (topScore + secondScore + epsilon));

    const reasoning = `匹配关键词: ${matched[topIntent].join(', ')}`;
    const scene = INTENT_TO_SCENE[topIntent] || 'chat';

    return { intent: topIntent, confidence, reasoning, scene };
  }

  // 暴露到全局
  window.IntentClassifier = {
    classify,
    INTENT_TO_SCENE,
    // 用于调试
    getKeywords: () => ({ ...INTENT_KEYWORDS })
  };
})();
