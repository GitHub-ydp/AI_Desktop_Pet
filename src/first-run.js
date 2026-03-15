(function () {
  const EXAMPLE_CHAT = '你好呀，你能做什么？';
  const EXAMPLE_REMINDER = '今晚8点提醒我喝水';
  let profilePromptTimer = null;
  let firstInteractionHandled = false;
  let initWindowInterceptInstalled = false;

  function getSettings() {
    return window.PetStorage?.getSettings?.() || {};
  }

  function saveSettings(patch) {
    const current = getSettings();
    window.PetStorage?.saveSettings?.({ ...current, ...patch });
  }

  function hasExistingHistory() {
    const history = window.PetStorage?.getChatHistory?.();
    return Array.isArray(history) && history.length > 0;
  }

  function shouldShowWelcome() {
    const settings = getSettings();
    return !hasExistingHistory() && !settings.profileSetupCompleted;
  }

  function installInitWindowInterceptor() {
    if (initWindowInterceptInstalled) return;
    if (!window.electron || typeof window.electron.createChildWindow !== 'function') return;

    const originalCreateChildWindow = window.electron.createChildWindow.bind(window.electron);
    window.electron.createChildWindow = function interceptedCreateChildWindow(options) {
      if (options && options.id === 'init' && !options._forceOpen && shouldShowWelcome()) {
        return Promise.resolve({ blocked: true, reason: 'first_run_welcome_active' });
      }
      return originalCreateChildWindow(options);
    };
    initWindowInterceptInstalled = true;
  }

  // 在 DOMContentLoaded 之前就抢先拦截 checkIfNeedsInit
  // 防止 app-vanilla.js 的 DOMContentLoaded handler 先于 patchInitFlow 执行
  // 导致 init 窗口在 Welcome Overlay 之前闪现
  function installCheckIfNeedsInitInterceptor() {
    if (!shouldShowWelcome()) return; // 非首次启动不拦截
    // 占位拦截：DOM 未就绪时只阻止返回值，不尝试操作 DOM
    // patchInitFlow() 在 DOMContentLoaded 后会升级这个 patch，加上 showWelcomeOverlay()
    window.checkIfNeedsInit = async function earlyBlockedCheckIfNeedsInit() {
      console.log('[first-run] checkIfNeedsInit blocked (early interceptor active)');
      return false;
    };
  }

  function getWelcomeOverlay() {
    return document.getElementById('welcomeOverlay');
  }

  function setPrimaryUiVisible(visible) {
    ['petWrapper', 'intimacy-widget'].forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.style.opacity = visible ? '1' : '0';
      element.style.visibility = visible ? 'visible' : 'hidden';
      element.style.pointerEvents = visible ? '' : 'none';
    });
  }

  function showWelcomeOverlay() {
    const overlay = getWelcomeOverlay();
    if (!overlay || !shouldShowWelcome()) return;
    setPrimaryUiVisible(false);
    overlay.hidden = false;
  }

  function hideWelcomeOverlay(markDismissed = false) {
    const overlay = getWelcomeOverlay();
    if (overlay) {
      overlay.hidden = true;
    }
    if (markDismissed) {
      saveSettings({ welcomeOverlayDismissed: true });
    }
    setPrimaryUiVisible(true);
  }

  function maybePromptForProfile() {
    const settings = getSettings();
    if (settings.profileSetupCompleted || settings.profilePromptDeferred) return;
    if (profilePromptTimer) clearTimeout(profilePromptTimer);

    profilePromptTimer = setTimeout(() => {
      if (typeof window.showBubbleMessage === 'function') {
        window.showBubbleMessage('要不要告诉我怎么称呼你？这样我会叫得更自然。');
      }
      if (typeof window.openInitModal === 'function') {
        window.openInitModal({ force: true });
      }
    }, 900);
  }

  function handleFirstSuccessfulInteraction() {
    if (firstInteractionHandled) return;
    firstInteractionHandled = true;
    hideWelcomeOverlay(true);
    if (typeof window.showBubbleMessage === 'function') {
      window.showBubbleMessage('我们已经开始认识彼此了。这次互动我会记住。');
    }
    maybePromptForProfile();
  }

  async function runPresetMessage(message) {
    hideWelcomeOverlay(true);

    if (typeof window.sendChat === 'function') {
      await window.sendChat(message, {
        returnReply: false,
        closeChatWindow: false
      });
      handleFirstSuccessfulInteraction();
      return;
    }

    if (typeof window.openChat === 'function') {
      window.openChat();
    }
  }

  async function runScreenshotPreset() {
    hideWelcomeOverlay(true);
    if (window.PetScreenshot?.captureFullScreen) {
      try {
        await window.PetScreenshot.captureFullScreen();
        if (typeof window.showBubbleMessage === 'function') {
          window.showBubbleMessage('截图已触发。截完图后可以继续问我。');
        }
        handleFirstSuccessfulInteraction();
      } catch (error) {
        console.error('[first-run] screenshot preset failed:', error);
      }
    }
  }

  function bindWelcomeActions() {
    document.getElementById('welcomeChatAction')?.addEventListener('click', () => {
      void runPresetMessage(EXAMPLE_CHAT);
    });
    document.getElementById('welcomeReminderAction')?.addEventListener('click', () => {
      void runPresetMessage(EXAMPLE_REMINDER);
    });
    document.getElementById('welcomeScreenshotAction')?.addEventListener('click', () => {
      void runScreenshotPreset();
    });
    document.getElementById('welcomeLaterAction')?.addEventListener('click', () => {
      hideWelcomeOverlay(false);
      maybePromptForProfile();
    });
  }

  function patchInitFlow() {
    const originalOpenInitModal = typeof window.openInitModal === 'function'
      ? window.openInitModal.bind(window)
      : null;
    const originalHandleInitCompleted = typeof window.handleInitCompleted === 'function'
      ? window.handleInitCompleted.bind(window)
      : null;
    const originalHandleInitSkipped = typeof window.handleInitSkipped === 'function'
      ? window.handleInitSkipped.bind(window)
      : null;

    if (originalOpenInitModal) {
      window.openInitModal = function patchedOpenInitModal(options = {}) {
        const settings = getSettings();
        if (!options.force && !settings.profileSetupCompleted && !hasExistingHistory()) {
          return;
        }
        return originalOpenInitModal();
      };
    }

    window.checkIfNeedsInit = async function patchedCheckIfNeedsInit() {
      showWelcomeOverlay();
      return false;
    };

    if (originalHandleInitCompleted) {
      window.handleInitCompleted = async function patchedHandleInitCompleted(event) {
        await originalHandleInitCompleted(event);
        saveSettings({
          profileSetupCompleted: true,
          profilePromptDeferred: true,
          welcomeOverlayDismissed: true
        });
      };
    }

    if (originalHandleInitSkipped) {
      window.handleInitSkipped = function patchedHandleInitSkipped() {
        saveSettings({ profilePromptDeferred: true });
        return originalHandleInitSkipped();
      };
    }
  }

  function closeLegacyInitWindow() {
    if (window.electron?.closeChildWindow) {
      window.electron.closeChildWindow('init').catch(() => {});
    }
  }

  function patchSendChat() {
    if (typeof window.sendChat !== 'function') return;
    const originalSendChat = window.sendChat.bind(window);
    window.sendChat = async function patchedSendChat(message, options) {
      const result = await originalSendChat(message, options);
      if (typeof message === 'string' && message.trim()) {
        handleFirstSuccessfulInteraction();
      }
      return result;
    };
  }

  // #5 ONNX 模型下载状态提示
  // 首次启动（无历史）时，延迟检查嵌入引擎状态并通过气泡告知用户
  function notifyEmbeddingStatus() {
    if (!shouldShowWelcome()) return; // 非首次启动不重复提示
    setTimeout(async () => {
      try {
        const status = await window.PetMemory?.getEmbeddingStatus?.();
        if (!status) return;
        if (status.loading && typeof window.showBubbleMessage === 'function') {
          window.showBubbleMessage('正在下载 AI 记忆模型（约 32MB），下载完成后我就能更好地记住你说的话了~');
        }
      } catch (e) {
        // 嵌入引擎不可用时静默忽略，不影响主流程
      }
    }, 4000); // 延迟 4 秒，避免与欢迎动画冲突
  }

  function initFirstRunExperience() {
    setPrimaryUiVisible(!shouldShowWelcome());
    bindWelcomeActions();
    patchInitFlow();   // 升级 checkIfNeedsInit patch：加上 showWelcomeOverlay()
    patchSendChat();
    showWelcomeOverlay();
    notifyEmbeddingStatus();
    // 移除原双 setTimeout hack：
    // 早期拦截器（installCheckIfNeedsInitInterceptor）已在 DOMContentLoaded 前阻断
    // createChildWindow 拦截器（installInitWindowInterceptor）提供第二道防线
    // 无需再用延时关窗作为兜底
  }

  // 两个拦截器都在 IIFE 立即执行，不等待 DOMContentLoaded
  // 确保 app-vanilla.js 的任何 DOMContentLoaded handler 都无法抢先打开 init 窗口
  installCheckIfNeedsInitInterceptor(); // 第一道：拦截 checkIfNeedsInit 返回值
  installInitWindowInterceptor();       // 第二道：拦截 createChildWindow 调用

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFirstRunExperience, { once: true });
  } else {
    initFirstRunExperience();
  }
})();
