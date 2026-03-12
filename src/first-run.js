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
    return !hasExistingHistory() && !settings.welcomeOverlayDismissed;
  }

  function installInitWindowInterceptor() {
    if (initWindowInterceptInstalled) return;
    if (!window.electron || typeof window.electron.createChildWindow !== 'function') return;

    const originalCreateChildWindow = window.electron.createChildWindow.bind(window.electron);
    window.electron.createChildWindow = function interceptedCreateChildWindow(options) {
      if (options && options.id === 'init' && shouldShowWelcome()) {
        return Promise.resolve({ blocked: true, reason: 'first_run_welcome_active' });
      }
      return originalCreateChildWindow(options);
    };
    initWindowInterceptInstalled = true;
  }

  function getWelcomeOverlay() {
    return document.getElementById('welcomeOverlay');
  }

  function showWelcomeOverlay() {
    const overlay = getWelcomeOverlay();
    if (!overlay || !shouldShowWelcome()) return;
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
        window.openInitModal();
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
      hideWelcomeOverlay(true);
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
      window.openInitModal = function patchedOpenInitModal() {
        const settings = getSettings();
        if (!settings.profileSetupCompleted && !hasExistingHistory()) {
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

  function initFirstRunExperience() {
    bindWelcomeActions();
    patchInitFlow();
    patchSendChat();
    showWelcomeOverlay();
    setTimeout(closeLegacyInitWindow, 1200);
    setTimeout(closeLegacyInitWindow, 2200);
  }

  installInitWindowInterceptor();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFirstRunExperience, { once: true });
  } else {
    initFirstRunExperience();
  }
})();
