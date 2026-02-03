// 上下文构建器
// 负责格式化搜索结果并构建 AI 上下文

import { MEMORY_CONFIG } from './config.js';

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

  // 构建上下文
  build(searchResults, options = {}) {
    const {
      query = '',
      maxTokens = this.config.maxTokens,
      maxMemories = this.config.maxMemories,
      includeFacts = this.config.includeFacts,
      includeTimestamp = this.config.includeTimestamp
    } = options;

    let context = '';
    let usedTokens = 0;

    // 1. 添加相关记忆
    const memories = searchResults.slice(0, maxMemories);

    if (memories.length > 0) {
      context += '相关记忆：\n';

      for (const memory of memories) {
        const memoryText = this.formatMemory(memory, includeTimestamp);

        // 粗略估算 token 数（中文约1.5倍，英文约1倍）
        const estimatedTokens = this.estimateTokens(memoryText);

        if (usedTokens + estimatedTokens > maxTokens * 0.8) {
          break;
        }

        context += memoryText + '\n';
        usedTokens += estimatedTokens;
      }
    }

    // 2. 添加相关事实
    if (includeFacts) {
      const allFacts = this.extractFacts(memories);

      if (allFacts.length > 0) {
        context += '\n记住的信息：\n';
        const factText = this.formatFacts(allFacts);

        if (usedTokens + this.estimateTokens(factText) < maxTokens) {
          context += factText + '\n';
          usedTokens += this.estimateTokens(factText);
        }
      }
    }

    // 3. 添加查询上下文
    if (query) {
      context += `\n当前对话：${query}\n`;
    }

    return context;
  }

  // 格式化单个记忆
  formatMemory(memory, includeTimestamp) {
    const role = memory.role === 'user' ? '用户' : '我';
    const date = includeTimestamp
      ? `[${new Date(memory.timestamp).toLocaleDateString('zh-CN')}] `
      : '';

    // 截断过长的文本
    let content = memory.text || memory.content;
    if (content.length > 100) {
      content = content.substring(0, 100) + '...';
    }

    return `${date}${role}: ${content}`;
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

  // 格式化事实列表
  formatFacts(facts) {
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

    let text = '';

    // 格式化偏好
    if (factGroups.preference.length > 0) {
      text += '偏好：';
      factGroups.preference.forEach(f => {
        text += `${f.subject || '用户'}${f.predicate}${f.object || ''}，`;
      });
      text = text.slice(0, -1) + '；';
    }

    // 格式化事件
    if (factGroups.event.length > 0) {
      text += '事件：';
      factGroups.event.forEach(f => {
        text += `${f.subject || ''}${f.predicate}${f.object || ''}，`;
      });
      text = text.slice(0, -1) + '；';
    }

    // 格式化习惯
    if (factGroups.routine.length > 0) {
      text += '习惯：';
      factGroups.routine.forEach(f => {
        text += `${f.subject || '用户'}${f.predicate}${f.object || ''}，`;
      });
      text = text.slice(0, -1) + '；';
    }

    return text;
  }

  // 构建带记忆的系统提示词
  buildSystemPrompt(basePrompt, context, personality) {
    let prompt = basePrompt;

    // 根据性格调整提示词
    const personalityHints = {
      healing: '请用温暖、关切的语气，记得主人过去说过的话，给予关怀。',
      funny: '请用幽默、轻松的语气，可以引用过去的有趣对话。',
      cool: '请用傲娇、有点高冷的语气，但也要记住重要的事情。',
      assistant: '请用专业、贴心的语气，记住主人的偏好和习惯。'
    };

    if (context) {
      prompt += `\n\n【记忆上下文】\n${context}\n\n`;
    }

    if (personalityHints[personality]) {
      prompt += `【对话风格】\n${personalityHints[personality]}\n`;
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

export default ContextBuilder;
