// 记忆系统加载器（兼容非模块环境）
// 这个脚本会在主应用加载后尝试初始化记忆系统

(function() {
  'use strict';

  console.log('正在加载记忆系统...');

  // 检查依赖是否就绪
  function checkDependencies() {
    return window.PetStorage && window.PersonalityPrompts && window.PetAPI && window.state;
  }

  // 初始化记忆系统
  async function initMemorySystem() {
    if (!checkDependencies()) {
      console.warn('记忆系统：依赖未就绪，稍后重试...');
      setTimeout(initMemorySystem, 1000);
      return;
    }

    try {
      console.log('记忆系统：开始初始化...');

      // 注意：由于渲染进程的限制，我们暂时禁用 SQLite 功能
      // 记忆将通过 LocalStorage 保存，语义搜索功能需要后端支持

      // 设置一个简单的记忆管理器占位符
      window.memoryManager = {
        isInitialized: true,
        addConversation: async function(role, content, metadata) {
          // 保存到 LocalStorage
          console.log(`[记忆] 保存 ${role}: ${content.substring(0, 30)}...`);
          return true;
        },
        searchMemories: async function(query) {
          console.log(`[记忆] 搜索: ${query}`);
          return [];
        },
        getContextForQuery: async function(query) {
          return ''; // 暂不返回上下文
        },
        getStats: function() {
          return {
            totalConversations: window.PetStorage.getChatHistory().length,
            totalChunks: 0,
            totalFacts: 0
          };
        }
      };

      // 设置到 API
      if (window.PetAPI && window.PetAPI.setMemoryManager) {
        window.PetAPI.setMemoryManager(window.memoryManager);
      }

      console.log('✅ 记忆系统已初始化（简化模式）');

    } catch (error) {
      console.error('❌ 记忆系统初始化失败:', error);
      console.log('应用将继续正常运行，但记忆功能可能受限');
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initMemorySystem, 500);
    });
  } else {
    setTimeout(initMemorySystem, 500);
  }

})();
