// 关键信息提取器
// 从对话中提取结构化信息

import { MEMORY_CONFIG } from './config.js';

class FactExtractor {
  constructor(options = {}) {
    this.config = {
      enabled: options.enabled !== undefined ? options.enabled : MEMORY_CONFIG.extraction.enabled,
      autoExtract: options.autoExtract !== undefined ? options.autoExtract : MEMORY_CONFIG.extraction.autoExtract,
      useAI: options.useAI !== undefined ? options.useAI : MEMORY_CONFIG.extraction.useAI,
      confidence: options.confidence !== undefined ? options.confidence : MEMORY_CONFIG.extraction.confidence
    };
    this.storage = options.storage || null;
    this.apiKey = options.apiKey || '';
  }

  // 设置存储实例
  setStorage(storage) {
    this.storage = storage;
  }

  // 从对话提取事实
  async extractFacts(conversation) {
    if (!this.config.enabled) {
      return [];
    }

    let facts = [];

    // 基于规则的提取（快速）
    facts = this.extractWithRules(conversation.content);

    // 如果启用 AI 提取，使用 AI 增强
    if (this.config.useAI && this.apiKey) {
      try {
        const aiFacts = await this.extractWithAI(conversation.role, conversation.content);
        facts = this.mergeFacts(facts, aiFacts);
      } catch (error) {
        console.error('AI extraction failed, using rule-based facts only:', error);
      }
    }

    // 过滤低置信度事实
    return facts.filter(f => f.confidence >= this.config.confidence);
  }

  // 基于规则的提取
  extractWithRules(content) {
    const facts = [];
    const factTypes = MEMORY_CONFIG.factTypes;

    for (const [type, config] of Object.entries(factTypes)) {
      // 检查关键词
      const hasKeyword = config.keywords.some(keyword =>
        content.includes(keyword)
      );

      if (!hasKeyword) continue;

      // 使用正则模式提取
      for (const pattern of config.patterns) {
        const matches = content.matchAll(pattern);

        for (const match of matches) {
          const fact = this.buildFactFromMatch(type, match, content);
          if (fact) {
            facts.push(fact);
          }
        }
      }
    }

    return facts;
  }

  // 从正则匹配构建事实
  buildFactFromMatch(type, match, content) {
    const factTypes = {
      preference: { label: '用户偏好' },
      event: { label: '重要事件' },
      relationship: { label: '关系信息' },
      routine: { label: '日常习惯' }
    };

    let subject = '用户';
    let predicate = '';
    let object = '';
    let confidence = 0.7; // 规则提取的默认置信度

    switch (type) {
      case 'preference':
        // 提取：我喜欢X, 我讨厌X
        const prefMatch = match[0].match(/我喜欢?(.+)/) || match[0].match(/我讨厌?(.+)/);
        if (prefMatch) {
          const isLike = match[0].includes('喜欢') || match[0].includes('爱');
          predicate = isLike ? '喜欢' : '讨厌';
          object = prefMatch[1].trim();
          confidence = isLike ? 0.8 : 0.7;
        }
        break;

      case 'event':
        // 提取：我的生日是X, 我有个约会X
        if (match[0].includes('生日')) {
          predicate = '生日是';
          object = match[1]?.trim() || '';
          confidence = 0.9;
        } else if (match[0].includes('会议') || match[0].includes('约会')) {
          predicate = '有' + (match[1] || '计划');
          object = match[2]?.trim() || '';
          confidence = 0.7;
        }
        break;

      case 'relationship':
        // 提取：我的X是Y
        if (match[1] && match[2]) {
          predicate = '的' + match[1] + '是';
          object = match[2].trim();
          confidence = 0.75;
        }
        break;

      case 'routine':
        // 提取：我每天X, 我习惯X
        if (match[1]) {
          predicate = match[0].includes('每天') ? '每天' : '习惯';
          object = match[1].trim();
          confidence = 0.8;
        }
        break;
    }

    if (!predicate) return null;

    return {
      id: this.generateFactId(),
      factType: type,
      subject,
      predicate,
      object,
      confidence
    };
  }

  // 使用 AI 提取（更准确）
  async extractWithAI(role, content) {
    const prompt = `从以下对话中提取关键信息，以 JSON 格式返回。

对话内容：
${content}

请提取以下类型的信息（如果没有相关内容，返回空数组）：
1. preference - 用户偏好（喜欢/讨厌的事物）
2. event - 重要事件（生日、会议、约会等）
3. relationship - 关系信息（家人、朋友、同事等）
4. routine - 日常习惯（每天做的事情）

返回格式（纯 JSON，不要有其他内容）：
{
  "facts": [
    {
      "factType": "preference|event|relationship|routine",
      "subject": "主体（如'用户'或具体人名）",
      "predicate": "谓语（如'喜欢'、'生日是'）",
      "object": "宾语（具体内容）",
      "confidence": 0.0-1.0
    }
  ]
}`;

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const aiContent = data.choices[0].message.content;

      // 解析 JSON 响应
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('AI extraction: no JSON found in response');
        return [];
      }

      const result = JSON.parse(jsonMatch[0]);
      const facts = result.facts || [];

      // 添加 ID
      return facts.map(f => ({
        ...f,
        id: this.generateFactId()
      }));

    } catch (error) {
      console.error('AI extraction error:', error);
      return [];
    }
  }

  // 合并规则提取和 AI 提取的结果
  mergeFacts(ruleFacts, aiFacts) {
    const merged = [...ruleFacts];
    const seen = new Set(ruleFacts.map(f => `${f.factType}-${f.predicate}-${f.object}`));

    // 添加 AI 提取的唯一事实
    aiFacts.forEach(fact => {
      const key = `${fact.factType}-${fact.predicate}-${fact.object}`;
      if (!seen.has(key)) {
        merged.push(fact);
        seen.add(key);
      }
    });

    return merged;
  }

  // 提取并保存事实
  async extractAndSaveFacts(conversation) {
    if (!this.storage) {
      throw new Error('Storage not set');
    }

    const facts = await this.extractFacts(conversation);

    if (facts.length > 0) {
      // 添加来源对话 ID
      facts.forEach(fact => {
        fact.sourceConversationId = conversation.id;
      });

      // 批量保存
      this.storage.batchSaveFacts(facts);
      console.log(`Extracted and saved ${facts.length} facts`);
    }

    return facts;
  }

  // 生成事实 ID
  generateFactId() {
    return `fact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 获取用户画像
  async getUserProfile() {
    if (!this.storage) {
      return {};
    }

    const facts = this.storage.getFacts({ minConfidence: 0.7 });

    const profile = {
      preferences: [],
      events: [],
      relationships: [],
      routines: []
    };

    facts.forEach(fact => {
      const item = {
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence
      };

      if (profile[fact.factType + 's']) {
        profile[fact.factType + 's'].push(item);
      }
    });

    return profile;
  }
}

export default FactExtractor;
