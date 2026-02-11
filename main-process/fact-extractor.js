// LLM 事实提取器
// 利用 DeepSeek API 从对话中自动提取结构化事实
// CommonJS 版本 - 用于主进程

const https = require('https');

// 无实质信息的消息模式
const TRIVIAL_PATTERNS = [
  /^(嗯|哦|哈|好|啊|呃|嘿|哎|唔|噢|呀|嘛|吧|呢|啦|嘻|哼)+[~！!。.？?]*$/,
  /^(好的|知道了|明白|收到|ok|OK|谢谢|感谢|好吧|行|对|是的|没事|再见|拜拜|晚安|早安)[~！!。.？?]*$/,
  /^.{0,3}$/  // 太短的消息
];

// 提取提示词模板
const EXTRACTION_PROMPT = `你是一个信息提取助手。请从以下对话中提取关于用户的结构化事实。

对话内容：
---
用户：{userMessage}
AI回复：{aiResponse}
---

请提取以下类型的事实（如果有的话）：
- personal: 个人信息（名字、性别、年龄、生日、职业、住址等）
- preference: 偏好（喜欢/不喜欢什么，习惯用什么）
- relationship: 关系（家人、朋友、同事、宠物等）
- event: 事件（计划、经历、即将发生的事）
- routine: 习惯（作息、日常活动、定期做的事）

要求：
1. 只提取用户明确表达的信息，不要推测
2. 每条事实用简洁的三元组表示（主体-谓语-宾语）
3. 给每条事实评估置信度（0.0-1.0）
4. 如果没有可提取的信息，返回空数组

返回纯 JSON 格式（不要有其他内容）：
{"facts":[{"type":"personal|preference|relationship|event|routine","subject":"用户","predicate":"动作/关系","object":"内容","confidence":0.9}]}`;

class FactExtractorLLM {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.apiHost = config.apiHost || 'api.deepseek.com';
    this.apiPath = config.apiPath || '/v1/chat/completions';
    this.model = config.model || 'deepseek-chat';

    // 累积缓冲区：收集多轮对话后批量提取
    this._buffer = [];
    this._bufferThreshold = config.bufferThreshold || 3;  // 累积 3 轮后提取
    this._extracting = false;

    // 数据库引用
    this.storage = config.storage || null;
  }

  setStorage(storage) {
    this.storage = storage;
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  // 判断消息是否包含实质信息
  _hasMeaningfulContent(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return !TRIVIAL_PATTERNS.some(p => p.test(trimmed));
  }

  // 添加对话到缓冲区（累积后批量提取）
  async addConversation(userMessage, aiResponse, metadata = {}) {
    // 只处理包含实质信息的用户消息
    if (!this._hasMeaningfulContent(userMessage)) {
      return [];
    }

    this._buffer.push({ userMessage, aiResponse, metadata });

    // 达到阈值时触发提取
    if (this._buffer.length >= this._bufferThreshold) {
      return await this.flushBuffer();
    }

    return [];
  }

  // 刷新缓冲区，执行批量提取
  async flushBuffer() {
    if (this._buffer.length === 0 || this._extracting) return [];
    if (!this.apiKey) {
      console.log('[FactExtractor] 无 API Key，跳过事实提取');
      this._buffer = [];
      return [];
    }

    this._extracting = true;
    const conversations = [...this._buffer];
    this._buffer = [];

    try {
      // 合并多轮对话为一个提取请求
      const combinedUserMsg = conversations.map(c => c.userMessage).join('\n');
      const combinedAiMsg = conversations.map(c => c.aiResponse || '').join('\n');

      const facts = await this._extractFromLLM(combinedUserMsg, combinedAiMsg);

      // 保存提取到的事实
      if (facts.length > 0 && this.storage) {
        await this._saveFacts(facts, conversations);
        await this._updateUserProfile(facts);
      }

      console.log(`[FactExtractor] 从 ${conversations.length} 轮对话中提取了 ${facts.length} 条事实`);
      return facts;

    } catch (error) {
      console.error('[FactExtractor] 事实提取失败:', error.message);
      return [];
    } finally {
      this._extracting = false;
    }
  }

  // 调用 LLM 提取事实
  async _extractFromLLM(userMessage, aiResponse) {
    const prompt = EXTRACTION_PROMPT
      .replace('{userMessage}', userMessage)
      .replace('{aiResponse}', aiResponse);

    try {
      const response = await this._callAPI(prompt);
      if (!response) return [];

      // 解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[FactExtractor] LLM 返回无有效 JSON');
        return [];
      }

      const result = JSON.parse(jsonMatch[0]);
      const facts = result.facts || [];

      // 验证和标准化事实
      return facts
        .filter(f => f.type && f.predicate && f.object)
        .map(f => ({
          type: f.type,
          subject: f.subject || '用户',
          predicate: f.predicate,
          object: f.object,
          confidence: Math.min(1, Math.max(0, f.confidence || 0.8))
        }));

    } catch (error) {
      console.error('[FactExtractor] LLM 调用失败:', error.message);
      return [];
    }
  }

  // 保存事实到数据库
  async _saveFacts(facts, conversations) {
    if (!this.storage || !this.storage.db) return;

    const now = Date.now();
    const sourceConvId = conversations[0]?.metadata?.conversationId || null;

    const stmt = this.storage.db.prepare(`
      INSERT OR REPLACE INTO memory_facts
        (id, fact_type, subject, predicate, object, confidence, source_conversation_id, created_at, updated_at, last_confirmed_at, source_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.storage.db.transaction((factList) => {
      for (const fact of factList) {
        // 检查是否已有相同事实（相同类型+谓语+宾语）
        const existing = this._findExistingFact(fact);

        if (existing) {
          // 更新已有事实：取更高置信度，刷新确认时间
          this.storage.db.prepare(`
            UPDATE memory_facts
            SET confidence = MAX(confidence, ?),
                last_confirmed_at = ?,
                updated_at = ?,
                source_text = ?
            WHERE id = ?
          `).run(
            fact.confidence,
            now,
            now,
            conversations.map(c => c.userMessage).join(' | '),
            existing.id
          );
        } else {
          // 插入新事实
          const id = `fact-${now}-${Math.random().toString(36).substr(2, 9)}`;
          stmt.run(
            id,
            fact.type,
            fact.subject,
            fact.predicate,
            fact.object,
            fact.confidence,
            sourceConvId,
            now,
            now,
            now,
            conversations.map(c => c.userMessage).join(' | ')
          );
        }
      }
    });

    try {
      insertMany(facts);
    } catch (error) {
      console.error('[FactExtractor] 保存事实失败:', error.message);
    }
  }

  // 查找已存在的相同事实
  _findExistingFact(fact) {
    if (!this.storage || !this.storage.db) return null;

    try {
      return this.storage.db.prepare(`
        SELECT * FROM memory_facts
        WHERE fact_type = ? AND predicate = ? AND object = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(fact.type, fact.predicate, fact.object);
    } catch (error) {
      return null;
    }
  }

  // 更新用户画像表
  async _updateUserProfile(facts) {
    if (!this.storage || !this.storage.db) return;

    const now = Date.now();

    const stmt = this.storage.db.prepare(`
      INSERT INTO user_profile (key, value, confidence, updated_at, source_fact_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = CASE WHEN excluded.confidence >= user_profile.confidence
                THEN excluded.value ELSE user_profile.value END,
        confidence = MAX(user_profile.confidence, excluded.confidence),
        updated_at = excluded.updated_at,
        source_fact_id = CASE WHEN excluded.confidence >= user_profile.confidence
                         THEN excluded.source_fact_id ELSE user_profile.source_fact_id END
    `);

    try {
      const upsertMany = this.storage.db.transaction((factList) => {
        for (const fact of factList) {
          // 将事实映射为 profile key
          const key = this._factToProfileKey(fact);
          if (!key) continue;

          // 查找关联的 fact id
          const existing = this._findExistingFact(fact);
          const factId = existing ? existing.id : null;

          stmt.run(key, fact.object, fact.confidence, now, factId);
        }
      });

      upsertMany(facts);
    } catch (error) {
      console.error('[FactExtractor] 更新用户画像失败:', error.message);
    }
  }

  // 将事实映射为 profile key
  _factToProfileKey(fact) {
    const predicate = fact.predicate;

    // personal 类型直接用谓语作 key
    if (fact.type === 'personal') {
      if (predicate.includes('名字') || predicate.includes('叫')) return 'name';
      if (predicate.includes('性别')) return 'gender';
      if (predicate.includes('年龄')) return 'age';
      if (predicate.includes('生日')) return 'birthday';
      if (predicate.includes('职业') || predicate.includes('工作')) return 'occupation';
      if (predicate.includes('住') || predicate.includes('城市')) return 'location';
      return `personal.${predicate}`;
    }

    // preference 类型用 like/dislike 前缀
    if (fact.type === 'preference') {
      if (predicate.includes('不喜欢') || predicate.includes('讨厌')) {
        return `dislike.${fact.object}`;
      }
      return `like.${fact.object}`;
    }

    // relationship 类型用关系名作 key
    if (fact.type === 'relationship') {
      return `relationship.${predicate}`;
    }

    // event/routine 不直接映射到 profile（太动态）
    return null;
  }

  // 合并冲突事实：新事实覆盖旧事实（高置信度优先）
  async mergeFacts(existingFacts, newFacts) {
    const merged = new Map();

    // 加载现有事实
    for (const f of existingFacts) {
      const key = `${f.type || f.fact_type}-${f.predicate}`;
      merged.set(key, f);
    }

    // 合并新事实
    for (const f of newFacts) {
      const key = `${f.type}-${f.predicate}`;
      const existing = merged.get(key);

      if (!existing || f.confidence >= (existing.confidence || 0)) {
        merged.set(key, f);
      }
    }

    return Array.from(merged.values());
  }

  // 获取用户画像（从 user_profile 表）
  getUserProfile() {
    if (!this.storage || !this.storage.db) return {};

    try {
      const rows = this.storage.db.prepare(
        'SELECT key, value, confidence FROM user_profile ORDER BY confidence DESC'
      ).all();

      const profile = {};
      for (const row of rows) {
        profile[row.key] = {
          value: row.value,
          confidence: row.confidence
        };
      }
      return profile;

    } catch (error) {
      console.error('[FactExtractor] 获取用户画像失败:', error.message);
      return {};
    }
  }

  // API 调用
  async _callAPI(prompt) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.1  // 低温度保证输出稳定
      });

      const options = {
        hostname: this.apiHost,
        path: this.apiPath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`API error: ${res.statusCode}`));
              return;
            }
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content || '';
            resolve(content);
          } catch (e) {
            reject(new Error(`解析响应失败: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(postData);
      req.end();
    });
  }
}

module.exports = FactExtractorLLM;
