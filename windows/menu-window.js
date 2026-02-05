// 菜单独立窗口控制逻辑

function closeMenuWindow() {
  if (window.electron && window.electron.closeMenuWindow) {
    window.electron.closeMenuWindow();
  }
}

function openChat() {
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'chat',
      title: '和宠物说话',
      width: 400,
      height: 500,
      html: 'windows/chat-window.html'
    });
  }
  closeMenuWindow();
}

function openSettings() {
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'settings',
      title: '设置',
      width: 500,
      height: 600,
      html: 'windows/settings-window.html'
    });
  }
  closeMenuWindow();
}

function openHistory() {
  if (window.electron && window.electron.createChildWindow) {
    window.electron.createChildWindow({
      id: 'history',
      title: '对话历史',
      width: 500,
      height: 600,
      html: 'windows/history-window.html'
    });
  }
  closeMenuWindow();
}

window.openChat = openChat;
window.openSettings = openSettings;
window.openHistory = openHistory;

const MenuWindowUtils = window.MenuWindowUtils || {
  shouldCloseMenuOnTarget: (target) => {
    if (!target || typeof target.closest !== 'function') return true;
    if (target.closest('.rotary-dial')) return false;
    if (target.closest('.dial-item')) return false;
    return true;
  },
  isMenuItemTarget: (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest('.dial-item');
  },
  isDragMovement: (distance, threshold) => distance > threshold
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.PetMenu) {
    window.PetMenu.initialize();
    window.PetMenu.open();
  }
});

// 点击空白区域关闭菜单（拖拽后抑制一次点击）
let suppressNextClick = false;
document.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (MenuWindowUtils.shouldCloseMenuOnTarget(e.target)) {
    closeMenuWindow();
  }
});

// 空白区域拖拽时移动主窗口
const DRAG_THRESHOLD = 6;
let isDragging = false;
let dragCandidate = false;
let hasMoved = false;
let startX = 0;
let startY = 0;
let shouldCloseOnClick = false;

function onMouseDown(e) {
  if (e.button !== 0) return;
  if (MenuWindowUtils.isMenuItemTarget(e.target)) return;
  dragCandidate = true;
  isDragging = false;
  hasMoved = false;
  startX = e.screenX;
  startY = e.screenY;
  shouldCloseOnClick = MenuWindowUtils.shouldCloseMenuOnTarget(e.target);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
  if (!dragCandidate) return;
  const deltaX = e.screenX - startX;
  const deltaY = e.screenY - startY;
  const distance = Math.hypot(deltaX, deltaY);

  if (!isDragging && MenuWindowUtils.isDragMovement(distance, DRAG_THRESHOLD)) {
    isDragging = true;
    hasMoved = true;
  }

  if (!isDragging) return;

  if (window.electron && window.electron.moveWindow) {
    window.electron.moveWindow(deltaX, deltaY).catch(() => {});
  }
  startX = e.screenX;
  startY = e.screenY;
}

function onMouseUp() {
  if (!dragCandidate) return;
  if (hasMoved) {
    suppressNextClick = true;
  } else if (shouldCloseOnClick) {
    suppressNextClick = true;
    closeMenuWindow();
  }
  dragCandidate = false;
  isDragging = false;
  hasMoved = false;
  shouldCloseOnClick = false;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

document.addEventListener('mousedown', onMouseDown);

// 监听主进程命令
if (window.electron && window.electron.onMenuCommand) {
  window.electron.onMenuCommand((event, data) => {
    if (!window.PetMenu || !data) return;
    if (data.type === 'open') {
      window.PetMenu.open();
    } else if (data.type === 'close') {
      window.PetMenu.close();
    }
  });
}
