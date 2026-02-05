// 聊天 IPC 辅助方法

function createChatRequestId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = {
  createChatRequestId,
  withTimeout
};
