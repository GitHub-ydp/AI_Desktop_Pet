// 文本分块器
// 将长文本分割成适合嵌入的小块
// CommonJS 版本 - 用于主进程

const { MEMORY_CONFIG } = require('./config');

class TextChunker {
  constructor(options = {}) {
    this.config = {
      maxTokens: options.maxTokens || MEMORY_CONFIG.chunking.maxTokens,
      overlap: options.overlap || MEMORY_CONFIG.chunking.overlap,
      minLength: options.minLength || MEMORY_CONFIG.chunking.minLength
    };
  }

  // 粗略估算中文字符数（1中文字符 ≈ 1-2 tokens）
  estimateTokens(text) {
    // 简单估算：中文字符算1.5，英文单词算1
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords);
  }

  // 分割文本为多个块
  chunk(text, options = {}) {
    const {
      conversationId = null,
      maxTokens = this.config.maxTokens,
      overlap = this.config.overlap
    } = options;

    const chunks = [];
    let currentIndex = 0;

    while (currentIndex < text.length) {
      // 计算当前块的结束位置
      let endIndex = currentIndex + maxTokens * 2; // 粗略转换

      // 如果超过文本长度，使用文本长度
      if (endIndex > text.length) {
        endIndex = text.length;
      }

      // 尝试在句子边界处分割
      const chunk = this.splitAtSentenceBoundary(text, currentIndex, endIndex, maxTokens);

      chunks.push({
        id: this.generateChunkId(conversationId, chunks.length),
        conversationId: conversationId,
        chunkIndex: chunks.length,
        text: chunk.text,
        startPos: currentIndex,
        endPos: chunk.endIndex
      });

      // 移动索引（考虑重叠）
      currentIndex = chunk.endIndex - overlap;
    }

    return chunks;
  }

  // 在句子边界处分割
  splitAtSentenceBoundary(text, startIndex, endIndex, maxTokens) {
    let chunkEnd = endIndex;

    // 查找最近的句子结束符号
    const sentenceEndings = ['。', '！', '？', '.', '!', '?', '\n'];
    let bestEnd = endIndex;

    // 从 endIndex 向前查找最近的句子边界
    for (let i = 0; i < 100 && endIndex - i > startIndex; i++) {
      const char = text[endIndex - i];
      if (sentenceEndings.includes(char)) {
        bestEnd = endIndex - i + 1;
        break;
      }
    }

    // 检查块长度是否超过最大 token 数
    const chunk = text.substring(startIndex, bestEnd);
    const tokens = this.estimateTokens(chunk);

    if (tokens > maxTokens * 1.5) {
      // 如果仍然太长，强制分割
      bestEnd = startIndex + maxTokens * 2;
    }

    return {
      text: text.substring(startIndex, bestEnd),
      endIndex: bestEnd
    };
  }

  // 批量分块多个文本
  chunkBatch(texts) {
    const allChunks = [];

    texts.forEach((item, index) => {
      const chunks = this.chunk(item.text, {
        conversationId: item.conversationId
      });
      allChunks.push(...chunks);
    });

    return allChunks;
  }

  // 生成块 ID
  generateChunkId(conversationId, chunkIndex) {
    return `${conversationId || 'unknown'}-chunk-${chunkIndex}-${Date.now()}`;
  }

  // 过滤短块
  filterShortChunks(chunks, minLength = this.config.minLength) {
    return chunks.filter(chunk => chunk.text.length >= minLength);
  }
}

module.exports = TextChunker;
