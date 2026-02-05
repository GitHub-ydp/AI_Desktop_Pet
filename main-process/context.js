// 上下文构建器
// 负责格式化搜索结果并构建 AI 上下文
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');

class ContextBuilder {
  constructor(options = {}) {
    this.config = {
      maxTokens: options.maxTokens || MEMORY_CONFIG.context.maxTokens,
      maxMemories: options.maxMemories || MEMORY_CONFIG.context.maxMemories,
      includeFacts: options.includeFacts !== undefined
        ? options.includeFacts
        : MEMORY_CONFIG.context.includeFacts,
      includeTimestamp: options.includeTimestamp !== undefined
        ? options.includeTimestamp
        : MEMORY_CONFIG.context.includeTimestamp
    };
  }

  // 构建上下文（增强情感感知）
  build(searchResults, options = {}) {
    const {
      query = '',
      maxTokens = this.config.maxTokens,
      maxMemories = this.config.maxMemories,
      includeFacts = this.config.includeFacts,
      includeTimestamp = this.config.includeTimestamp,
      // 新增：情感上下文
      currentMood = 80,
      currentPersonality = 'healing'
    } = options;

    let context = '';
    let usedTokens = 0;

    // 0. 提取用户的关键信息（名字、性别等）
    const userProfile = this.extractUserProfile(searchResults);
    if (userProfile) {
      context += userProfile + '\n\n';
      usedTokens += this.estimateTokens(userProfile);
    }

    // 1. 添加相关记忆
    // 过滤掉分数太低的，但保留足够的候选
    const filteredResults = searchResults.filter(r => r.score >= 0.05);
    const memories = filteredResults.slice(0, maxMemories);

    if (memories.length > 0) {
      context += '【重要对话记录】\n';

      for (const memory of memories) {
        const memoryText = this.formatMemory(memory, includeTimestamp, currentMood);

        // 粗略估算 token 数（中文约1.5倍，英文约1倍）
        const estimatedTokens = this.estimateTokens(memoryText);

        if (usedTokens + estimatedTokens > maxTokens * 0.8) {
          break;
        }

        context += memoryText + '\n';
        usedTokens += estimatedTokens;
      }

      context += '\n请记住以上信息，并在对话中自然地使用。\n';
    }

    // 2. 添加相关事实（提取的结构化信息）
    if (includeFacts) {
      const allFacts = this.extractFacts(memories);

      if (allFacts.length > 0) {
        const factText = this.formatFacts(allFacts, currentPersonality);

        if (usedTokens + this.estimateTokens(factText) < maxTokens * 0.9) {
          context += '\n关于我的重要信息：\n' + factText + '\n';
          usedTokens += this.estimateTokens(factText);
        }
      }
    }

    // 3. 添加当前查询
    if (query) {
      context += `\n【当前对话】用户说：${query}\n`;
    }

    return context;
  }

  // 提取用户基本信息（名字、性别等）
  extractUserProfile(searchResults) {
    if (!searchResults || searchResults.length === 0) {
      return '';
    }

    // 只查看用户的对话
    const userMessages = searchResults.filter(r => r.role === 'user');

    if (userMessages.length === 0) {
      return '';
    }

    let name = null;
    let gender = null;
    let birthday = null;
    let interests = [];

    // 从对话中提取信息
    userMessages.forEach(msg => {
      const text = (msg.text || msg.content || '').toLowerCase();

      // 提取名字："我叫xxx"
      const nameMatch = text.match(/我叫(.{1,5})/);
      if (nameMatch && !name) {
        name = nameMatch[1].trim();
      }

      // 提取性别："我是xx生"
      if (text.includes('我是男生') || text.includes('我是男的')) {
        gender = '男';
      } else if (text.includes('我是女生') || text.includes('我是女的')) {
        gender = '女';
      }

      // 提取生日
      const birthMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (birthMatch && !birthday) {
        birthday = `${birthMatch[1]}年${birthMatch[2]}月${birthMatch[3]}日`;
      }

      // 提取兴趣："我喜欢xxx"
      const likeMatch = text.match(/我喜欢(.{1,20})/);
      if (likeMatch) {
        interests.push(likeMatch[1].trim());
      }
    });

    // 构建用户信息字符串
    let profile = '';
    if (name) {
      profile += `【用户名字】${name}\n`;
    }
    if (gender) {
      profile += `【性别】${gender}\n`;
    }
    if (birthday) {
      profile += `【生日】${birthday}\n`;
    }
    if (interests.length > 0) {
      profile += `【兴趣爱好】${interests.join('、')}\n`;
    }

    return profile;
  }

  // 构建情感状态提示
  buildEmotionalHint(mood, personality) {
    const hints = [];

    // 心情提示
    if (mood >= 80) {
      hints.push('我现在心情很好，充满活力');
    } else if (mood >= 60) {
      hints.push('我现在心情还不错');
    } else if (mood >= 40) {
      hints.push('我现在心情一般');
    } else {
      hints.push('我现在心情有点低落');
    }

    // 性格提示
    const personalityHints = {
      healing: '作为治愈型伙伴，我希望给主人温暖和关怀',
      funny: '作为幽默型伙伴，我希望让主人开心大笑',
      cool: '作为高冷型伙伴，我保持着独特的方式关心主人',
      assistant: '作为助手型伙伴，我希望高效地帮助主人'
    };

    if (personalityHints[personality]) {
      hints.push(personalityHints[personality]);
    }

    return hints.join('，');
  }

  // 格式化单个记忆（增强情感信息）
  formatMemory(memory, includeTimestamp, currentMood) {
    const role = memory.role === 'user' ? '用户' : '我';
    const date = includeTimestamp
      ? `[${new Date(memory.timestamp).toLocaleDateString('zh-CN')}] `
      : '';

    // 添加心情上下文
    let moodHint = '';
    if (memory.mood !== undefined) {
      if (memory.mood >= 80) {
        moodHint = '[开心] ';
      } else if (memory.mood <= 40) {
        moodHint = '[低落] ';
      }
    }

    // 截断过长的文本
    let content = memory.text || memory.content;
    if (content.length > 100) {
      content = content.substring(0, 100) + '...';
    }

    return `${date}${moodHint}${role}: ${content}`;
  }

  // 从搜索结果中提取事实
  extractFacts(searchResults) {
    const facts = [];

    searchResults.forEach(result => {
      if (result.relatedFacts && result.relatedFacts.length > 0) {
        facts.push(...result.relatedFacts);
      }
    });

    // 去重（基于 fact id）
    const uniqueFacts = [];
    const seen = new Set();

    facts.forEach(fact => {
      if (!seen.has(fact.id)) {
        seen.add(fact.id);
        uniqueFacts.push(fact);
      }
    });

    return uniqueFacts;
  }

  // 格式化事实列表（基于性格调整）
  formatFacts(facts, personality = 'healing') {
    const factGroups = {
      preference: [],
      event: [],
      relationship: [],
      routine: []
    };

    // 分组
    facts.forEach(fact => {
      if (factGroups[fact.fact_type]) {
        factGroups[fact.fact_type].push(fact);
      }
    });

    // 根据性格调整呈现顺序和重点
    const personalityOrder = {
      healing: ['relationship', 'preference', 'event', 'routine'],
      funny: ['preference', 'event', 'relationship', 'routine'],
      cool: ['relationship', 'event', 'preference', 'routine'],
      assistant: ['preference', 'routine', 'event', 'relationship']
    };

    const order = personalityOrder[personality] || personalityOrder.healing;
    let text = '';

    order.forEach(type => {
      const group = factGroups[type];
      if (group.length === 0) return;

      const typeLabels = {
        preference: '偏好',
        event: '事件',
        relationship: '关系',
        routine: '习惯'
      };

      text += `${typeLabels[type]}：`;
      group.forEach(f => {
        text += `${f.subject || '用户'}${f.predicate}${f.object || ''}，`;
      });
      text = text.slice(0, -1) + '；';
    });

    return text;
  }

  // 构建带记忆的系统提示词（增强情感感知）
  buildSystemPrompt(basePrompt, context, personality, mood = 80) {
    let prompt = basePrompt;

    // 根据性格和心情调整提示词
    const personalityHints = {
      healing: {
        high: '请用温暖、关切的语气，记得主人过去说过的话，给予关怀。主人心情很好，一起开心地聊天吧！',
        medium: '请用温暖、关切的语气，记得主人过去说过的话，给予关怀。',
        low: '请用温暖、关切的语气，记得主人过去说过的话，给予特别的关怀和安慰。'
      },
      funny: {
        high: '请用幽默、轻松的语气，可以引用过去的有趣对话。主人心情很好，尽情发挥幽默感！',
        medium: '请用幽默、轻松的语气，可以引用过去的有趣对话。',
        low: '请用幽默、轻松的语气，用幽默来安慰主人，但不要过度开玩笑。'
      },
      cool: {
        high: '请用傲娇、有点高冷的语气，但也要记住重要的事情。主人心情不错，可以稍微多聊几句。',
        medium: '请用傲娇、有点高冷的语气，但也要记住重要的事情。',
        low: '请用傲娇、有点高冷的语气，但主人心情低落时，要表现出隐晦的关心。'
      },
      assistant: {
        high: '请用专业、贴心的语气，记住主人的偏好和习惯。主人心情很好，可以更活泼一些！',
        medium: '请用专业、贴心的语气，记住主人的偏好和习惯。',
        low: '请用专业、贴心的语气，记住主人的偏好和习惯，并给予适当的关怀。'
      }
    };

    if (context) {
      prompt += `\n\n【记忆上下文】\n${context}\n\n`;
    }

    // 根据心情选择提示词
    let moodLevel = 'medium';
    if (mood >= 80) moodLevel = 'high';
    else if (mood <= 40) moodLevel = 'low';

    if (personalityHints[personality] && personalityHints[personality][moodLevel]) {
      prompt += `【对话风格】\n${personalityHints[personality][moodLevel]}\n`;
    }

    return prompt;
  }

  // 粗略估算 token 数
  estimateTokens(text) {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords);
  }

  // 简化版上下文（用于快速响应）
  buildQuickContext(relevantMemories, query) {
    if (relevantMemories.length === 0) {
      return query;
    }

    // 只取最相关的记忆
    const topMemory = relevantMemories[0];
    const summary = `[记忆: ${topMemory.text.substring(0, 50)}...]`;

    return `${summary} ${query}`;
  }
}

module.exports = ContextBuilder;
