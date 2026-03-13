// 主题管理器 - 管理应用的视觉主题
// 支持赛博朋克、懒猫橘、小清新三种主题

(function () {
  // 主题定义
  var THEMES = {
    classic: {
      name: '经典主题',
      icon: '⚪',
      desc: '简约时尚，经典白灰橙',
      vars: {
        '--bg': '#F7F7F7',
        '--bg-surface': '#FFFFFF',
        '--bg-card': '#EDEDED',
        '--border': 'rgba(0, 0, 0, 0.08)',
        '--border-bright': 'rgba(0, 0, 0, 0.15)',
        '--neon-cyan': '#FFC73D',
        '--neon-magenta': '#FF9500',
        '--text': '#333333',
        '--text-muted': 'rgba(0, 0, 0, 0.45)',
        '--glow-sm': '0 2px 8px rgba(0, 0, 0, 0.05)',
        '--glow-md': '0 4px 12px rgba(0, 0, 0, 0.08)',
        '--radius': '8px',
        '--header-bg': '#F7F7F7',
        '--input-area-bg': '#FFFFFF',
        '--input-field-bg': '#F2F2F2',
        '--personality-bg': '#F7F7F7',
        '--confirm-bg': '#FFFFFF',
        '--bubble-bg': '#FFFFFF',
        '--bubble-border': '#EEEEEE',
        '--bubble-shadow': 'rgba(0, 0, 0, 0.05)',
        '--close-icon': 'rgba(0, 0, 0, 0.4)',
        '--accent-bg-faint': 'rgba(255, 199, 61, 0.1)',
        '--accent-bg-dim': 'rgba(255, 199, 61, 0.2)',
        '--accent-bg-checked': 'rgba(255, 199, 61, 0.8)',
        '--accent-hover-bg': 'rgba(255, 199, 61, 0.15)',
        '--danger-glow': '0 0 8px rgba(255, 85, 85, 0.3)',
        '--danger-hover-bg': 'rgba(255, 85, 85, 0.1)',
        '--danger-border': 'rgba(255, 85, 85, 0.4)',
        '--scrollbar': 'rgba(0, 0, 0, 0.1)',
        '--scrollbar-hover': 'rgba(0, 0, 0, 0.2)',
      }
    },
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
    },
    freshSpring: {
      name: '小清新',
      icon: '🍃',
      desc: '浅色清爽，薄荷蓝绿',
      vars: {
        '--bg': '#eef8f6',
        '--bg-surface': 'rgba(245, 253, 251, 0.98)',
        '--bg-card': 'rgba(220, 242, 236, 0.68)',
        '--border': 'rgba(90, 178, 162, 0.30)',
        '--border-bright': 'rgba(90, 178, 162, 0.65)',
        '--neon-cyan': '#4aaea0',
        '--neon-magenta': '#6fa7d8',
        '--text': '#25454a',
        '--text-muted': 'rgba(54, 104, 110, 0.58)',
        '--glow-sm': '0 0 8px rgba(90, 178, 162, 0.30)',
        '--glow-md': '0 0 16px rgba(90, 178, 162, 0.24), 0 0 4px rgba(90, 178, 162, 0.45)',
        '--radius': '8px',
        '--header-bg': 'rgba(230, 247, 244, 0.98)',
        '--input-area-bg': 'rgba(236, 250, 247, 0.98)',
        '--input-field-bg': 'rgba(255, 255, 255, 0.88)',
        '--personality-bg': 'rgba(214, 239, 232, 0.58)',
        '--confirm-bg': 'rgba(240, 252, 249, 0.98)',
        '--bubble-bg': 'rgba(232, 249, 245, 0.96)',
        '--bubble-border': 'rgba(90, 178, 162, 0.35)',
        '--bubble-shadow': 'rgba(90, 178, 162, 0.16)',
        '--close-icon': 'rgba(66, 132, 124, 0.65)',
        '--accent-bg-faint': 'rgba(90, 178, 162, 0.08)',
        '--accent-bg-dim': 'rgba(90, 178, 162, 0.12)',
        '--accent-bg-checked': 'rgba(90, 178, 162, 0.28)',
        '--accent-hover-bg': 'rgba(90, 178, 162, 0.16)',
        '--danger-glow': '0 0 8px rgba(111, 167, 216, 0.30)',
        '--danger-hover-bg': 'rgba(111, 167, 216, 0.10)',
        '--danger-border': 'rgba(111, 167, 216, 0.42)',
        '--scrollbar': 'rgba(90, 178, 162, 0.35)',
        '--scrollbar-hover': 'rgba(90, 178, 162, 0.58)',
      }
    },
    milkBlush: {
      name: '奶白淡粉',
      icon: '🌸',
      desc: '奶白柔和，浅粉点缀',
      vars: {
        '--bg': '#fffaf8',
        '--bg-surface': 'rgba(255, 252, 250, 0.98)',
        '--bg-card': 'rgba(255, 238, 240, 0.62)',
        '--border': 'rgba(231, 166, 183, 0.30)',
        '--border-bright': 'rgba(231, 166, 183, 0.62)',
        '--neon-cyan': '#d98ca8',
        '--neon-magenta': '#e8a0b7',
        '--text': '#5b3b49',
        '--text-muted': 'rgba(120, 82, 96, 0.56)',
        '--glow-sm': '0 0 8px rgba(231, 166, 183, 0.28)',
        '--glow-md': '0 0 16px rgba(231, 166, 183, 0.22), 0 0 4px rgba(231, 166, 183, 0.40)',
        '--radius': '8px',
        '--header-bg': 'rgba(255, 245, 247, 0.98)',
        '--input-area-bg': 'rgba(255, 248, 250, 0.98)',
        '--input-field-bg': 'rgba(255, 255, 255, 0.92)',
        '--personality-bg': 'rgba(255, 232, 238, 0.55)',
        '--confirm-bg': 'rgba(255, 250, 251, 0.98)',
        '--bubble-bg': 'rgba(255, 244, 247, 0.96)',
        '--bubble-border': 'rgba(231, 166, 183, 0.35)',
        '--bubble-shadow': 'rgba(231, 166, 183, 0.14)',
        '--close-icon': 'rgba(153, 96, 117, 0.64)',
        '--accent-bg-faint': 'rgba(231, 166, 183, 0.08)',
        '--accent-bg-dim': 'rgba(231, 166, 183, 0.12)',
        '--accent-bg-checked': 'rgba(231, 166, 183, 0.26)',
        '--accent-hover-bg': 'rgba(231, 166, 183, 0.16)',
        '--danger-glow': '0 0 8px rgba(217, 140, 168, 0.30)',
        '--danger-hover-bg': 'rgba(217, 140, 168, 0.10)',
        '--danger-border': 'rgba(217, 140, 168, 0.42)',
        '--scrollbar': 'rgba(231, 166, 183, 0.34)',
        '--scrollbar-hover': 'rgba(231, 166, 183, 0.56)',
      }
    }
  };

  function applyTheme(name) {
    var theme = THEMES[name] || THEMES.classic;
    var root = document.documentElement;
    var vars = theme.vars;
    for (var key in vars) {
      root.style.setProperty(key, vars[key]);
    }
  }

  function getCurrentTheme() {
    return localStorage.getItem('pet_theme') || 'classic';
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
      applyTheme(e.newValue || 'classic');
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
