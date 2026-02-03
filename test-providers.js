// 提供商系统测试脚本
// 运行: node test-providers.js

const providerFactory = require('./main-process/providers/factory');

console.log('======================================');
console.log('AI 提供商系统测试');
console.log('======================================\n');

// 测试配置
const testConfig = {
  qwenApiKey: process.env.QWEN_API_KEY || 'sk-e3c0a6a4b24440ff8de691b0294364ca',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  primary: 'qwen'
};

async function testProviders() {
  // 1. 初始化提供商
  console.log('1️⃣  初始化提供商...');
  const initialized = providerFactory.initialize(testConfig);

  if (!initialized) {
    console.error('❌ 提供商初始化失败');
    return;
  }

  console.log('✅ 提供商初始化成功\n');

  // 2. 获取提供商信息
  console.log('2️⃣  提供商信息:');
  const info = providerFactory.getProvidersInfo();
  console.log(JSON.stringify(info, null, 2));
  console.log('');

  // 3. 测试 Chat API
  console.log('3️⃣  测试 Chat API...');
  try {
    const provider = providerFactory.getPrimaryProvider();
    const messages = [
      { role: 'system', content: '你是一个友好的AI助手。' },
      { role: 'user', content: '你好，请用一句话介绍你自己。' }
    ];

    console.log('发送消息...');
    const response = await provider.chat(messages, { maxTokens: 50 });
    console.log('✅ Chat API 响应:');
    console.log(response);
    console.log('');
  } catch (error) {
    console.error('❌ Chat API 测试失败:', error.message);
    console.log('');
  }

  // 4. 测试 Embedding API
  console.log('4️⃣  测试 Embedding API...');
  try {
    const provider = providerFactory.getEmbeddingProvider();
    const testText = '这是一个测试文本，用于验证嵌入功能。';

    console.log('生成嵌入向量...');
    const embedding = await provider.embed(testText);
    console.log('✅ Embedding API 响应:');
    console.log(`- 维度: ${embedding.length}`);
    console.log(`- 前5个值: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
    console.log('');
  } catch (error) {
    console.error('❌ Embedding API 测试失败:', error.message);
    console.log('');
  }

  // 5. 测试批量 Embedding
  console.log('5️⃣  测试批量 Embedding API...');
  try {
    const provider = providerFactory.getEmbeddingProvider();
    const texts = [
      '今天天气很好',
      '我喜欢编程',
      '人工智能很有趣'
    ];

    console.log(`批量生成 ${texts.length} 个嵌入向量...`);
    const embeddings = await provider.embedBatch(texts);
    console.log('✅ 批量 Embedding API 响应:');
    console.log(`- 生成数量: ${embeddings.length}`);
    console.log(`- 每个维度: ${embeddings[0].length}`);
    console.log('');
  } catch (error) {
    console.error('❌ 批量 Embedding API 测试失败:', error.message);
    console.log('');
  }

  // 6. 总结
  console.log('======================================');
  console.log('测试完成！');
  console.log('======================================');
  console.log('');
  console.log('📊 提供商状态:');
  console.log(`- 主要提供商: ${info.primary}`);
  console.log(`- 嵌入提供商: ${info.embedding}`);
  console.log(`- 可用提供商数: ${Object.keys(info.providers).length}`);
  console.log('');

  const features = info.providers[Object.keys(info.providers)[0]]?.features || {};
  console.log('🔧 功能支持:');
  console.log(`- Chat: ${features.chat ? '✅' : '❌'}`);
  console.log(`- Stream: ${features.stream ? '✅' : '❌'}`);
  console.log(`- Embedding: ${features.embedding ? '✅' : '❌'}`);
  console.log(`- Batch Embedding: ${features.batchEmbedding ? '✅' : '❌'}`);
}

// 运行测试
testProviders().catch(error => {
  console.error('测试过程中发生错误:', error);
  process.exit(1);
});
