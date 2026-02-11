// 主题管理器 - 管理应用的视觉主题
// 支持赛博朋克和懒猫橘两种主题

(function () {
  // 两套主题定义
  var THEMES = {
    cyberpunk: {
      name: '赛博朋克',
      icon: '⚡',
      desc: '霓虹深夜都市感',
      vars: {
        '--bg': '#020810',
        '--bg-surface': 'rgba(2, 10, 20, 0.98)',
        '--bg-card': 'rgba(0, 30, 55, 0.6)',
        '--border': 'rgba(0, 255, 240, 0.3)',
        '--border-bright': 'rgba(0, 255, 240, 0.7)',
        '--neon-cyan': '#00fff0',
        '--neon-magenta': '#ff2d78',
        '--text': '#cff0ff',
        '--text-muted': 'rgba(160, 220, 240, 0.55)',
        '--glow-sm': '0 0 8px rgba(0, 255, 240, 0.4)',
        '--glow-md': '0 0 16px rgba(0, 255, 240, 0.35), 0 0 4px rgba(0, 255, 240, 0.6)',
        '--radius': '8px',
        '--header-bg': 'rgba(0, 15, 30, 0.98)',
        '--input-area-bg': 'rgba(0, 12, 25, 0.98)',
        '--input-field-bg': 'rgba(0, 20, 40, 0.8)',
        '--personality-bg': 'rgba(0, 15, 35, 0.5)',
        '--confirm-bg': 'rgba(0, 20, 45, 0.98)',
        '--bubble-bg': 'rgba(2, 12, 28, 0.96)',
        '--bubble-border': 'rgba(0, 255, 240, 0.45)',
        '--bubble-shadow': 'rgba(0, 255, 240, 0.2)',
        '--close-icon': 'rgba(160, 220, 240, 0.6)',
        '--accent-bg-faint': 'rgba(0, 255, 240, 0.06)',
        '--accent-bg-dim': 'rgba(0, 255, 240, 0.08)',
        '--accent-bg-checked': 'rgba(0, 255, 240, 0.3)',
        '--accent-hover-bg': 'rgba(0, 255, 240, 0.1)',
        '--danger-glow': '0 0 8px rgba(255, 45, 120, 0.4)',
        '--danger-hover-bg': 'rgba(255, 45, 120, 0.08)',
        '--danger-border': 'rgba(255, 45, 120, 0.5)',
        '--scrollbar': 'rgba(0, 255, 240, 0.35)',
        '--scrollbar-hover': 'rgba(0, 255, 240, 0.6)',
      }
    },
    lazyCat: {
      name: '懒猫橘',
      icon: '🐱',
      desc: '温暖橘猫，慵懒午后',
      vars: {
        '--bg': '#1a0e05',
        '--bg-surface': 'rgba(22, 12, 4, 0.98)',
        '--bg-card': 'rgba(65, 35, 10, 0.65)',
        '--border': 'rgba(255, 175, 70, 0.3)',
        '--border-bright': 'rgba(255, 175, 70, 0.75)',
        '--neon-cyan': '#ffb347',
        '--neon-magenta': '#ff6b35',
        '--text': '#ffe8cc',
        '--text-muted': 'rgba(255, 205, 155, 0.55)',
        '--glow-sm': '0 0 8px rgba(255, 175, 70, 0.45)',
        '--glow-md': '0 0 16px rgba(255, 175, 70, 0.35), 0 0 4px rgba(255, 175, 70, 0.65)',
        '--radius': '8px',
        '--header-bg': 'rgba(14, 8, 2, 0.98)',
        '--input-area-bg': 'rgba(12, 7, 2, 0.98)',
        '--input-field-bg': 'rgba(30, 17, 5, 0.8)',
        '--personality-bg': 'rgba(35, 18, 5, 0.5)',
        '--confirm-bg': 'rgba(18, 10, 2, 0.98)',
        '--bubble-bg': 'rgba(22, 12, 4, 0.96)',
        '--bubble-border': 'rgba(255, 175, 70, 0.5)',
        '--bubble-shadow': 'rgba(255, 175, 70, 0.2)',
        '--close-icon': 'rgba(255, 205, 140, 0.6)',
        '--accent-bg-faint': 'rgba(255, 175, 70, 0.06)',
        '--accent-bg-dim': 'rgba(255, 175, 70, 0.08)',
        '--accent-bg-checked': 'rgba(255, 175, 70, 0.3)',
        '--accent-hover-bg': 'rgba(255, 175, 70, 0.1)',
        '--danger-glow': '0 0 8px rgba(255, 107, 53, 0.4)',
        '--danger-hover-bg': 'rgba(255, 107, 53, 0.08)',
        '--danger-border': 'rgba(255, 107, 53, 0.5)',
        '--scrollbar': 'rgba(255, 175, 70, 0.35)',
        '--scrollbar-hover': 'rgba(255, 175, 70, 0.6)',
      }
    }
  };

  function applyTheme(name) {
    var theme = THEMES[name] || THEMES.lazyCat;
    var root = document.documentElement;
    var vars = theme.vars;
    for (var key in vars) {
      root.style.setProperty(key, vars[key]);
    }
  }

  function getCurrentTheme() {
    return localStorage.getItem('pet_theme') || 'lazyCat';
  }

  function saveTheme(name) {
    localStorage.setItem('pet_theme', name);
    applyTheme(name);
  }

  // 页面加载时立即应用（在 <style> 解析前执行可防止闪烁）
  applyTheme(getCurrentTheme());

  // 监听其他窗口的主题变更（localStorage storage 事件跨窗口触发）
  window.addEventListener('storage', function (e) {
    if (e.key === 'pet_theme') {
      applyTheme(e.newValue || 'lazyCat');
    }
  });

  // 暴露到全局
  window.ThemeManager = {
    THEMES: THEMES,
    apply: applyTheme,
    save: saveTheme,
    getCurrent: getCurrentTheme
  };
})();
