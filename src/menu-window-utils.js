// 菜单窗口辅助逻辑（可用于测试）

function shouldCloseMenuOnTarget(target) {
  if (!target || typeof target.closest !== 'function') return true;
  if (target.closest('.rotary-dial')) return false;
  if (target.closest('.dial-item')) return false;
  return true;
}

function isMenuItemTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('.dial-item');
}

function isDragMovement(distance, threshold) {
  return distance > threshold;
}

const api = {
  shouldCloseMenuOnTarget,
  isMenuItemTarget,
  isDragMovement
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.MenuWindowUtils = api;
}
