# 截图功能 UI 样式设计方案

> 版本：v1.0
> 日期：2026-02-12
> 作者：style-designer
> 基于：screenshot-feature-design.md（feature-designer）

---

## 一、设计原则

### 1.1 与现有系统保持一致

所有截图相关 UI 必须遵循项目已有的设计系统：
- **主题集成**：引入 `theme-manager.js`，所有颜色使用 CSS 变量
- **组件复用**：header、close-btn、btn、scrollbar 等使用与 chat/settings/history 窗口完全一致的样式
- **字体**：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **圆角**：统一使用 `var(--radius)` (8px)
- **间距**：padding 12-16px，gap 8-10px
- **字号**：正文 13px，标题 14px，辅助 11px
- **动画**：0.2s ease 过渡，fadeIn 入场动画

### 1.2 截图场景特殊考虑

截图覆盖层不同于普通弹窗，需要：
- **不遮盖截图内容**：工具栏/按钮用半透明深色背景，不能太亮
- **高对比度可读性**：在任何桌面背景上都能看清控件
- **精准操作感**：选区边框、手柄等需要视觉清晰、操作精确
- **快速反馈**：所有交互都有即时视觉反馈

---

## 二、CSS 变量体系

### 2.1 基础变量（由 theme-manager.js 提供）

所有截图窗口 HTML 文件头部引入：
```html
<script src="../src/theme-manager.js"></script>
```

:root 中的默认值（作为 fallback，会被 theme-manager.js 覆盖）：

```css
:root {
  /* 来自 theme-manager.js 的变量 */
  --bg: #020810;
  --bg-surface: rgba(2, 10, 20, 0.98);
  --bg-card: rgba(0, 30, 55, 0.6);
  --border: rgba(0, 255, 240, 0.3);
  --border-bright: rgba(0, 255, 240, 0.7);
  --neon-cyan: #00fff0;
  --neon-magenta: #ff2d78;
  --text: #cff0ff;
  --text-muted: rgba(160, 220, 240, 0.55);
  --glow-sm: 0 0 8px rgba(0, 255, 240, 0.4);
  --glow-md: 0 0 16px rgba(0, 255, 240, 0.35), 0 0 4px rgba(0, 255, 240, 0.6);
  --radius: 8px;
  --header-bg: rgba(0, 15, 30, 0.98);
  --close-icon: rgba(160, 220, 240, 0.6);
  --accent-bg-faint: rgba(0, 255, 240, 0.06);
  --accent-bg-dim: rgba(0, 255, 240, 0.08);
  --accent-hover-bg: rgba(0, 255, 240, 0.1);
  --danger-glow: 0 0 8px rgba(255, 45, 120, 0.4);
  --danger-border: rgba(255, 45, 120, 0.5);
  --scrollbar: rgba(0, 255, 240, 0.35);
  --scrollbar-hover: rgba(0, 255, 240, 0.6);

  /* 截图专用扩展变量 */
  --screenshot-overlay: rgba(0, 0, 0, 0.55);
  --screenshot-selection-border: var(--neon-cyan);
  --screenshot-handle-size: 8px;
  --screenshot-handle-fill: var(--neon-cyan);
  --screenshot-handle-border: #fff;
  --screenshot-toolbar-bg: rgba(2, 8, 16, 0.92);
  --screenshot-toolbar-border: var(--border);
  --screenshot-toolbar-radius: 10px;
  --screenshot-tool-size: 32px;
  --screenshot-magnifier-border: var(--neon-cyan);
  --screenshot-magnifier-bg: rgba(0, 0, 0, 0.85);
}
```

### 2.2 两套主题对照

| 变量用途 | 赛博朋克值 | 懒猫橘值 |
|----------|-----------|----------|
| 选区边框 | `#00fff0`（霓虹青） | `#ffb347`（琥珀橙） |
| 选区发光 | `0 0 8px rgba(0,255,240,0.4)` | `0 0 8px rgba(255,175,70,0.45)` |
| 工具栏背景 | `rgba(2,8,16,0.92)` | `rgba(20,10,2,0.92)` |
| 工具栏边框 | `rgba(0,255,240,0.3)` | `rgba(255,175,70,0.3)` |
| 激活工具高亮 | `rgba(0,255,240,0.15)` | `rgba(255,175,70,0.15)` |
| 危险色/品红 | `#ff2d78` | `#ff6b35` |
| 文字颜色 | `#cff0ff` | `#ffe8cc` |
| 次要文字 | `rgba(160,220,240,0.55)` | `rgba(255,205,155,0.55)` |

---

## 三、区域选择窗口样式 (screenshot-capture.html)

### 3.1 全屏遮罩层

```css
/* 全屏覆盖层 - body */
body {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: transparent;
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
}

/* 截图背景图（全屏截图作为静态背景） */
#screenshot-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

#screenshot-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 半透明暗色遮罩 */
#overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--screenshot-overlay);
  pointer-events: none;
  z-index: 1;
  transition: background 0.15s ease;
}
```

### 3.2 选区框

```css
/* 选择框 - 使用主题色边框 + 遮罩裁剪效果 */
#selection {
  position: fixed;
  display: none;
  z-index: 10;
  pointer-events: none;

  /* 主题色边框 */
  border: 2px solid var(--screenshot-selection-border);

  /* 选区外围暗色遮罩（替代旧的 box-shadow 方案） */
  box-shadow:
    0 0 0 9999px var(--screenshot-overlay),
    var(--glow-sm);

  /* 内部阴影增加选区边缘对比度 */
  outline: 1px solid rgba(255, 255, 255, 0.15);
  outline-offset: -1px;
}

/* 选区确认后（可调整状态） */
#selection.confirmed {
  border-style: solid;
  cursor: move;
  pointer-events: auto;
}
```

### 3.3 选区调整手柄

```css
/* 8 个调整手柄 */
.resize-handle {
  position: absolute;
  width: var(--screenshot-handle-size);
  height: var(--screenshot-handle-size);
  background: var(--screenshot-handle-fill);
  border: 1.5px solid var(--screenshot-handle-border);
  border-radius: 2px;
  z-index: 20;
  pointer-events: auto;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.resize-handle:hover {
  transform: scale(1.3);
  box-shadow: var(--glow-sm), 0 0 4px rgba(0, 0, 0, 0.5);
}

/* 四角手柄 */
.handle-nw { top: -5px; left: -5px; cursor: nwse-resize; }
.handle-ne { top: -5px; right: -5px; cursor: nesw-resize; }
.handle-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
.handle-se { bottom: -5px; right: -5px; cursor: nwse-resize; }

/* 四边手柄 */
.handle-n  { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.handle-s  { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.handle-w  { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }
.handle-e  { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }

.handle-n:hover, .handle-s:hover { transform: translateX(-50%) scale(1.3); }
.handle-w:hover, .handle-e:hover { transform: translateY(-50%) scale(1.3); }
```

### 3.4 尺寸信息标签

```css
/* 尺寸提示标签 - 跟随选区右下角 */
#size-info {
  position: fixed;
  display: none;
  z-index: 30;
  pointer-events: none;

  padding: 4px 10px;
  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: 4px;

  color: var(--neon-cyan);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums; /* 等宽数字，防止尺寸变化时抖动 */
  letter-spacing: 0.3px;
  white-space: nowrap;

  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

/* 坐标信息（选区左上角显示起点坐标） */
#position-info {
  position: fixed;
  display: none;
  z-index: 30;
  pointer-events: none;

  padding: 3px 8px;
  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: 4px;

  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

### 3.5 提示文字（初始状态）

```css
/* 屏幕中央提示文字 */
#hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 5;
  pointer-events: none;

  text-align: center;
  color: var(--text);
  font-size: 16px;
  line-height: 1.8;
  letter-spacing: 0.5px;
  opacity: 0.85;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

#hint .hint-key {
  display: inline-block;
  padding: 2px 8px;
  margin: 0 2px;
  background: var(--accent-bg-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--neon-cyan);
  font-family: monospace;
}
```

### 3.6 模式切换栏

```css
/* 模式切换栏 - 屏幕顶部居中 */
.mode-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;

  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: var(--screenshot-toolbar-radius);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);

  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);

  animation: modeBarSlideIn 0.25s ease-out;
}

@keyframes modeBarSlideIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.mode-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}

.mode-btn:hover {
  color: var(--text);
  background: var(--accent-hover-bg);
}

.mode-btn.active {
  color: var(--neon-cyan);
  background: var(--accent-bg-dim);
  font-weight: 600;
  text-shadow: var(--glow-sm);
}

/* 分隔线 */
.mode-separator {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 6px;
  flex-shrink: 0;
}

/* ESC 提示 */
.mode-hint {
  padding: 6px 12px;
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.3px;
}

.mode-hint kbd {
  padding: 1px 5px;
  background: var(--accent-bg-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  font-family: monospace;
  color: var(--neon-cyan);
}
```

### 3.7 放大镜

```css
/* 鼠标旁的放大镜 */
.magnifier {
  position: fixed;
  display: none;
  z-index: 50;
  pointer-events: none;

  width: 120px;
  height: 120px;
  border: 2px solid var(--screenshot-magnifier-border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--screenshot-magnifier-bg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), var(--glow-sm);

  image-rendering: pixelated; /* 放大时显示像素网格 */
}

.magnifier canvas {
  width: 100%;
  height: 100%;
}

/* 放大镜十字线 */
.magnifier::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* 十字准线 */
  background:
    linear-gradient(var(--neon-cyan) 1px, transparent 1px) 0 50% / 100% 1px no-repeat,
    linear-gradient(90deg, var(--neon-cyan) 1px, transparent 1px) 50% 0 / 1px 100% no-repeat;
  opacity: 0.5;
}

/* 放大镜下方的颜色/坐标提示 */
.magnifier-info {
  position: fixed;
  display: none;
  z-index: 50;
  pointer-events: none;

  padding: 3px 8px;
  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

---

## 四、编辑工具栏样式

### 4.1 工具栏容器

工具栏定位在选区下方 8px（空间不足时移到选区上方）。

```css
/* 编辑工具栏 - 浮动面板 */
.edit-toolbar {
  position: fixed;
  z-index: 200;

  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--screenshot-toolbar-border);
  border-radius: var(--screenshot-toolbar-radius);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.5),
    0 0 1px var(--border);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  animation: toolbarSlideIn 0.2s ease-out;
  user-select: none;
  -webkit-user-select: none;
}

@keyframes toolbarSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 工具组分隔线 */
.toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}
```

### 4.2 工具按钮

```css
/* 单个工具按钮 */
.tool-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  cursor: pointer;

  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, color 0.15s;
}

.tool-btn:hover {
  border-color: var(--border);
  background: var(--accent-hover-bg);
  color: var(--neon-cyan);
}

.tool-btn:active {
  background: var(--accent-bg-dim);
  transform: scale(0.94);
}

/* 当前选中的工具 */
.tool-btn.active {
  border-color: var(--neon-cyan);
  background: var(--accent-bg-dim);
  color: var(--neon-cyan);
  box-shadow: var(--glow-sm);
}

/* 工具按钮内的 SVG 图标 */
.tool-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 工具 tooltip（悬停时显示在上方） */
.tool-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;

  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
  white-space: nowrap;

  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

.tool-btn:hover::after {
  opacity: 1;
}
```

### 4.3 颜色选择器

```css
/* 颜色选择器按钮 */
.color-picker-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.color-picker-btn:hover {
  border-color: var(--border-bright);
  box-shadow: var(--glow-sm);
}

/* 颜色预览圆点 */
.color-preview {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
  /* 具体颜色由 JS 设置 inline style */
}

/* 下拉箭头 */
.color-picker-btn .dropdown-arrow {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 3px solid var(--text-muted);
}

/* 颜色调色板弹出面板 */
.color-palette {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;

  display: none;
  padding: 8px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);

  animation: paletteIn 0.15s ease-out;
}

.color-palette.show {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

@keyframes paletteIn {
  from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.95); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}

/* 调色板中的颜色方块 */
.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.1s, transform 0.1s, box-shadow 0.1s;
}

.color-swatch:hover {
  transform: scale(1.15);
  border-color: rgba(255, 255, 255, 0.5);
}

.color-swatch.selected {
  border-color: #fff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.3);
}

/* 预设颜色 */
.color-swatch[data-color="#ff2d78"] { background: #ff2d78; }
.color-swatch[data-color="#00fff0"] { background: #00fff0; }
.color-swatch[data-color="#ffb347"] { background: #ffb347; }
.color-swatch[data-color="#4ade80"] { background: #4ade80; }
.color-swatch[data-color="#60a5fa"] { background: #60a5fa; }
.color-swatch[data-color="#fbbf24"] { background: #fbbf24; }
.color-swatch[data-color="#ffffff"] { background: #ffffff; }
.color-swatch[data-color="#000000"] { background: #000000; border-color: rgba(255,255,255,0.15); }
```

### 4.4 线宽选择器

```css
/* 线宽选择器按钮 */
.linewidth-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.linewidth-btn:hover {
  border-color: var(--border-bright);
  box-shadow: var(--glow-sm);
}

/* 线宽预览（水平线段） */
.linewidth-preview {
  width: 16px;
  border-radius: 2px;
  background: var(--neon-cyan);
  /* height 由 JS 根据当前线宽设置 */
}

/* 线宽弹出面板 */
.linewidth-palette {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;

  display: none;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);

  animation: paletteIn 0.15s ease-out;
}

.linewidth-palette.show {
  display: flex;
}

/* 线宽选项 */
.linewidth-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.linewidth-option:hover {
  background: var(--accent-hover-bg);
}

.linewidth-option.selected {
  background: var(--accent-bg-dim);
}

.linewidth-option .line-demo {
  width: 28px;
  border-radius: 2px;
  background: var(--neon-cyan);
  /* height 由各选项设定: 2px, 4px, 6px, 8px */
}

.linewidth-option .line-label {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

### 4.5 确认/取消按钮

```css
/* 确认按钮 */
.toolbar-confirm-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid var(--neon-cyan);
  border-radius: 6px;
  background: var(--accent-bg-dim);
  color: var(--neon-cyan);
  font-size: 16px;
  cursor: pointer;

  transition: background 0.15s, box-shadow 0.15s, transform 0.1s;
}

.toolbar-confirm-btn:hover {
  background: rgba(0, 255, 240, 0.18);
  box-shadow: var(--glow-sm);
}

.toolbar-confirm-btn:active {
  transform: scale(0.92);
}

/* 取消按钮 */
.toolbar-cancel-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid var(--danger-border);
  border-radius: 6px;
  background: transparent;
  color: var(--neon-magenta);
  font-size: 14px;
  cursor: pointer;

  transition: background 0.15s, box-shadow 0.15s, transform 0.1s;
}

.toolbar-cancel-btn:hover {
  background: rgba(255, 45, 120, 0.08);
  box-shadow: var(--danger-glow);
}

.toolbar-cancel-btn:active {
  transform: scale(0.92);
}
```

### 4.6 撤销/重做按钮

```css
/* 撤销/重做按钮 */
.undo-redo-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: var(--screenshot-tool-size);
  height: var(--screenshot-tool-size);
  padding: 0;

  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;

  transition: border-color 0.15s, background 0.15s, color 0.15s, opacity 0.15s;
}

.undo-redo-btn:hover {
  border-color: var(--border);
  background: var(--accent-hover-bg);
  color: var(--neon-cyan);
}

.undo-redo-btn:active {
  background: var(--accent-bg-dim);
  transform: scale(0.94);
}

/* 无操作可撤销/重做时 */
.undo-redo-btn:disabled,
.undo-redo-btn.disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

.undo-redo-btn svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
}
```

---

## 五、操作按钮栏样式

编辑确认后（或跳过编辑），在选区下方显示操作按钮。

```css
/* 操作按钮栏 */
.action-bar {
  position: fixed;
  z-index: 200;

  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--screenshot-toolbar-border);
  border-radius: var(--screenshot-toolbar-radius);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  animation: toolbarSlideIn 0.2s ease-out;
}

/* 操作按钮 - 与编辑工具类似但带文字 */
.action-btn {
  display: flex;
  align-items: center;
  gap: 5px;

  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;

  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, color 0.15s;
}

.action-btn:hover {
  border-color: var(--border);
  background: var(--accent-hover-bg);
  color: var(--neon-cyan);
}

.action-btn:active {
  background: var(--accent-bg-dim);
  transform: scale(0.96);
}

.action-btn .action-icon {
  font-size: 14px;
}

/* 主要操作按钮（复制）高亮 */
.action-btn.primary {
  border-color: var(--border-bright);
  color: var(--neon-cyan);
}

.action-btn.primary:hover {
  background: var(--accent-bg-dim);
  box-shadow: var(--glow-sm);
}

/* 关闭/取消按钮 */
.action-btn.close-action {
  color: var(--text-muted);
}

.action-btn.close-action:hover {
  border-color: var(--danger-border);
  color: var(--neon-magenta);
  background: rgba(255, 45, 120, 0.06);
}
```

---

## 六、贴图窗口样式 (pin-window.html)

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: transparent;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* 贴图容器 */
.pin-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  cursor: grab;
  -webkit-app-region: drag;
}

.pin-container:active {
  cursor: grabbing;
}

/* 截图图片 */
.pin-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  border-radius: 4px;
}

/* 发光边框（hover 时显示） */
.pin-container::after {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 2px solid var(--neon-cyan, #00fff0);
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  box-shadow: var(--glow-sm, 0 0 8px rgba(0, 255, 240, 0.4));
}

.pin-container:hover::after {
  opacity: 1;
}

/* 贴图控制栏（hover 时在底部显示） */
.pin-controls {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;

  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;

  background: rgba(2, 8, 16, 0.9);
  border: 1px solid var(--border, rgba(0, 255, 240, 0.3));
  border-radius: 6px;

  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.pin-container:hover .pin-controls {
  opacity: 1;
  pointer-events: auto;
}

.pin-ctrl-btn {
  padding: 3px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text, #cff0ff);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.pin-ctrl-btn:hover {
  background: rgba(0, 255, 240, 0.1);
}

/* 透明度指示器 */
.pin-opacity-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 3px;
  color: #fff;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.pin-opacity-indicator.show {
  opacity: 1;
}
```

---

## 七、通知 Toast 样式

截图操作成功/失败时显示的通知。

```css
/* 通知 toast */
.screenshot-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 500;

  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;

  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  animation: toastIn 0.25s ease-out;
  pointer-events: none;
}

@keyframes toastIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes toastOut {
  from { opacity: 1; }
  to   { opacity: 0; transform: translateX(-50%) translateY(-6px); }
}

.screenshot-toast.hiding {
  animation: toastOut 0.2s ease-in forwards;
}

/* 成功通知 */
.screenshot-toast.success {
  background: var(--neon-cyan);
  color: #020810;
  box-shadow: var(--glow-sm), 0 4px 16px rgba(0, 0, 0, 0.3);
}

/* 错误通知 */
.screenshot-toast.error {
  background: var(--neon-magenta);
  color: #fff;
  box-shadow: var(--danger-glow), 0 4px 16px rgba(0, 0, 0, 0.3);
}

/* 信息通知 */
.screenshot-toast.info {
  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  color: var(--text);
}
```

---

## 八、加载状态样式

AI 分析、OCR 等异步操作时显示。

```css
/* 全屏加载遮罩 */
.screenshot-loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 400;

  display: none;
  align-items: center;
  justify-content: center;

  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.screenshot-loading.show {
  display: flex;
}

.loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 24px 36px;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--neon-cyan);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 13px;
  color: var(--text);
  animation: loadingPulse 1.5s ease-in-out infinite;
}

@keyframes loadingPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
```

---

## 九、文字标注输入框

点击文字工具后在 Canvas 上出现的内联输入框。

```css
/* 文字标注输入框（叠加在 canvas 上） */
.text-annotation-input {
  position: fixed;
  z-index: 250;

  min-width: 40px;
  max-width: 400px;
  padding: 4px 6px;

  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--neon-cyan);
  border-radius: 3px;
  outline: none;

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 16px;
  color: #fff;
  /* 具体颜色和字号由 JS 根据当前工具设置动态修改 */

  box-shadow: var(--glow-sm);
  caret-color: var(--neon-cyan);
}

.text-annotation-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
}
```

---

## 十、窗口智能识别高亮

窗口模式下，鼠标悬停时高亮的窗口边框。

```css
/* 窗口识别高亮框 */
.window-highlight {
  position: fixed;
  z-index: 8;
  pointer-events: none;

  border: 2px solid var(--neon-cyan);
  background: rgba(0, 255, 240, 0.08);
  box-shadow: var(--glow-sm);

  transition: top 0.1s ease, left 0.1s ease, width 0.1s ease, height 0.1s ease;
}
```

---

## 十一、AI 分析结果面板

截图后点击 AI 分析时，在选区下方弹出的结果面板。

```css
/* AI 分析结果面板 */
.analysis-panel {
  position: fixed;
  z-index: 250;

  width: 380px;
  max-height: 300px;
  padding: 0;
  overflow: hidden;

  background: var(--screenshot-toolbar-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);

  animation: panelSlideIn 0.2s ease-out;
  display: flex;
  flex-direction: column;
}

@keyframes panelSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.analysis-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.analysis-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--neon-cyan);
  letter-spacing: 0.3px;
}

.analysis-close-btn {
  background: transparent;
  border: none;
  color: var(--close-icon);
  font-size: 16px;
  cursor: pointer;
  padding: 2px;
  transition: color 0.15s;
}

.analysis-close-btn:hover {
  color: var(--neon-magenta);
}

.analysis-content {
  flex: 1;
  padding: 12px 14px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-wrap: break-word;
}

/* 分析结果区域滚动条 */
.analysis-content::-webkit-scrollbar { width: 3px; }
.analysis-content::-webkit-scrollbar-track { background: transparent; }
.analysis-content::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 3px; }
.analysis-content::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }

/* 分析结果中的代码块 */
.analysis-content code {
  padding: 1px 4px;
  background: var(--accent-bg-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 12px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: var(--neon-cyan);
}

/* 复制分析结果按钮 */
.analysis-footer {
  display: flex;
  justify-content: flex-end;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.analysis-copy-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.analysis-copy-btn:hover {
  border-color: var(--neon-cyan);
  color: var(--neon-cyan);
}
```

---

## 十二、动效设计规范

### 12.1 过渡时长标准

| 场景 | 时长 | 缓动函数 |
|------|------|----------|
| 按钮 hover/active | 0.15s | ease |
| 面板出现 | 0.2s | ease-out |
| 面板消失 | 0.15s | ease-in |
| 选区边框变化 | 0.1s | ease |
| 手柄缩放 | 0.1s | ease |
| 调色板弹出 | 0.15s | ease-out |
| Toast 出现 | 0.25s | ease-out |
| Toast 消失 | 0.2s | ease-in |

### 12.2 交互反馈

- **工具按钮点击**：`transform: scale(0.94)` 收缩 + 快速恢复
- **确认/取消按钮**：`transform: scale(0.92)` 更明显的收缩
- **手柄悬停**：`transform: scale(1.3)` 放大 + `box-shadow` 发光
- **选区拖动**：即时跟随鼠标，无动画延迟
- **工具栏入场**：从下方 8px 滑入 + 淡入
- **调色板/线宽面板**：从下方 4px 滑入 + 缩放 0.95->1.0

### 12.3 光标样式

| 状态 | 光标 |
|------|------|
| 默认（选区前） | `crosshair` |
| 选区内部拖动 | `move` |
| 角手柄 NW/SE | `nwse-resize` |
| 角手柄 NE/SW | `nesw-resize` |
| 边手柄 N/S | `ns-resize` |
| 边手柄 W/E | `ew-resize` |
| 绘制工具激活 | `crosshair` |
| 文字工具激活 | `text` |
| 贴图窗口 | `grab` / `grabbing` |

---

## 十三、响应式与无障碍

### 13.1 高 DPI 适配

```css
/* 高 DPI 下手柄不宜太小 */
@media (-webkit-min-device-pixel-ratio: 1.5) {
  :root {
    --screenshot-handle-size: 10px;
  }
}

@media (-webkit-min-device-pixel-ratio: 2) {
  :root {
    --screenshot-handle-size: 10px;
  }

  .resize-handle {
    border-width: 1px;
  }
}
```

### 13.2 减少动画偏好

```css
@media (prefers-reduced-motion: reduce) {
  .edit-toolbar,
  .action-bar,
  .mode-bar,
  .color-palette,
  .linewidth-palette,
  .analysis-panel,
  .screenshot-toast {
    animation: none !important;
  }

  .tool-btn,
  .action-btn,
  .color-swatch,
  .resize-handle,
  .mode-btn {
    transition: none !important;
  }
}
```

### 13.3 高对比度模式

```css
@media (prefers-contrast: high) {
  .edit-toolbar,
  .action-bar,
  .mode-bar {
    border-width: 2px;
  }

  .tool-btn.active {
    border-width: 2px;
  }

  #selection {
    border-width: 3px;
  }
}
```

---

## 十四、完整 HTML 结构参考

### 14.1 screenshot-capture.html 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>截图</title>
  <script src="../src/theme-manager.js"></script>
  <style>
    /* 上述所有截图相关 CSS 整合到此 */
  </style>
</head>
<body>
  <!-- 截图背景 -->
  <div id="screenshot-bg"><canvas id="bgCanvas"></canvas></div>

  <!-- 遮罩层 -->
  <div id="overlay"></div>

  <!-- 选区框 + 手柄 -->
  <div id="selection">
    <div class="resize-handle handle-nw"></div>
    <div class="resize-handle handle-n"></div>
    <div class="resize-handle handle-ne"></div>
    <div class="resize-handle handle-w"></div>
    <div class="resize-handle handle-e"></div>
    <div class="resize-handle handle-sw"></div>
    <div class="resize-handle handle-s"></div>
    <div class="resize-handle handle-se"></div>
  </div>

  <!-- 标注 Canvas（叠加在选区内） -->
  <canvas id="annotationCanvas"></canvas>

  <!-- 尺寸/坐标提示 -->
  <div id="size-info"></div>
  <div id="position-info"></div>

  <!-- 初始提示 -->
  <div id="hint">
    拖拽鼠标选择截图区域<br>
    按 <span class="hint-key">ESC</span> 取消
  </div>

  <!-- 模式切换栏 -->
  <div class="mode-bar">
    <button class="mode-btn" data-mode="fullscreen">全屏</button>
    <button class="mode-btn" data-mode="window">窗口</button>
    <button class="mode-btn active" data-mode="region">区域</button>
    <div class="mode-separator"></div>
    <span class="mode-hint"><kbd>ESC</kbd> 取消</span>
  </div>

  <!-- 编辑工具栏 -->
  <div class="edit-toolbar" id="editToolbar" style="display:none;">
    <!-- 绘制工具组 -->
    <button class="tool-btn active" data-tool="rect" data-tooltip="矩形">
      <svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/></svg>
    </button>
    <button class="tool-btn" data-tool="ellipse" data-tooltip="圆形">
      <svg viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="6" ry="5"/></svg>
    </button>
    <button class="tool-btn" data-tool="arrow" data-tooltip="箭头">
      <svg viewBox="0 0 16 16"><line x1="3" y1="13" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>
    </button>
    <button class="tool-btn" data-tool="line" data-tooltip="直线">
      <svg viewBox="0 0 16 16"><line x1="2" y1="14" x2="14" y2="2"/></svg>
    </button>
    <button class="tool-btn" data-tool="brush" data-tooltip="画笔">
      <svg viewBox="0 0 16 16"><path d="M2 14 Q 5 8, 8 9 Q 11 10, 14 2"/></svg>
    </button>
    <button class="tool-btn" data-tool="text" data-tooltip="文字">
      <svg viewBox="0 0 16 16"><text x="4" y="13" font-size="13" font-weight="bold" fill="currentColor" stroke="none">A</text></svg>
    </button>
    <button class="tool-btn" data-tool="mosaic" data-tooltip="马赛克">
      <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" fill="currentColor" stroke="none" opacity="0.6"/><rect x="9" y="2" width="5" height="5" fill="currentColor" stroke="none" opacity="0.3"/><rect x="2" y="9" width="5" height="5" fill="currentColor" stroke="none" opacity="0.3"/><rect x="9" y="9" width="5" height="5" fill="currentColor" stroke="none" opacity="0.6"/></svg>
    </button>
    <button class="tool-btn" data-tool="number" data-tooltip="序号">
      <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><text x="8" y="11.5" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" stroke="none">1</text></svg>
    </button>

    <div class="toolbar-divider"></div>

    <!-- 颜色选择器 -->
    <div class="color-picker-btn" id="colorPicker">
      <div class="color-preview" id="colorPreview" style="background:#ff2d78;"></div>
      <div class="dropdown-arrow"></div>
      <div class="color-palette" id="colorPalette">
        <!-- 8 个颜色方块由 JS 动态生成 -->
      </div>
    </div>

    <!-- 线宽选择器 -->
    <div class="linewidth-btn" id="linewidthPicker">
      <div class="linewidth-preview" id="linewidthPreview" style="height:4px;"></div>
      <div class="dropdown-arrow"></div>
      <div class="linewidth-palette" id="linewidthPalette">
        <!-- 4 个线宽选项由 JS 动态生成 -->
      </div>
    </div>

    <div class="toolbar-divider"></div>

    <!-- 撤销/重做 -->
    <button class="undo-redo-btn disabled" id="undoBtn" data-tooltip="撤销 Ctrl+Z">
      <svg viewBox="0 0 16 16"><path d="M4 7 L1 4 L4 1"/><path d="M1 4 H10 A4 4 0 0 1 10 12 H6"/></svg>
    </button>
    <button class="undo-redo-btn disabled" id="redoBtn" data-tooltip="重做 Ctrl+Y">
      <svg viewBox="0 0 16 16"><path d="M12 7 L15 4 L12 1"/><path d="M15 4 H6 A4 4 0 0 0 6 12 H10"/></svg>
    </button>

    <div class="toolbar-divider"></div>

    <!-- 确认/取消 -->
    <button class="toolbar-confirm-btn" id="confirmEditBtn" data-tooltip="完成">&#10003;</button>
    <button class="toolbar-cancel-btn" id="cancelEditBtn" data-tooltip="取消">&#10005;</button>
  </div>

  <!-- 操作按钮栏 -->
  <div class="action-bar" id="actionBar" style="display:none;">
    <button class="action-btn primary" id="copyAction">
      <span class="action-icon">&#128203;</span> 复制
    </button>
    <button class="action-btn" id="saveAction">
      <span class="action-icon">&#128190;</span> 保存
    </button>
    <button class="action-btn" id="pinAction">
      <span class="action-icon">&#128204;</span> 贴图
    </button>
    <button class="action-btn" id="aiAction">
      <span class="action-icon">&#129302;</span> AI分析
    </button>
    <button class="action-btn close-action" id="closeAction">
      <span class="action-icon">&#10005;</span>
    </button>
  </div>

  <!-- 放大镜 -->
  <div class="magnifier" id="magnifier"><canvas></canvas></div>
  <div class="magnifier-info" id="magnifierInfo"></div>

  <!-- 窗口高亮框 -->
  <div class="window-highlight" id="windowHighlight" style="display:none;"></div>

  <!-- 加载状态 -->
  <div class="screenshot-loading" id="screenshotLoading">
    <div class="loading-card">
      <div class="loading-spinner"></div>
      <div class="loading-text" id="loadingText">处理中...</div>
    </div>
  </div>

  <!-- AI 分析结果面板 -->
  <div class="analysis-panel" id="analysisPanel" style="display:none;">
    <div class="analysis-header">
      <span class="analysis-title">AI 分析结果</span>
      <button class="analysis-close-btn" id="analysisCloseBtn">&#10005;</button>
    </div>
    <div class="analysis-content" id="analysisContent"></div>
    <div class="analysis-footer">
      <button class="analysis-copy-btn" id="analysisCopyBtn">复制结果</button>
    </div>
  </div>

  <script>
    /* 截图逻辑 JS */
  </script>
</body>
</html>
```

### 14.2 pin-window.html 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>贴图</title>
  <script src="../src/theme-manager.js"></script>
  <style>
    /* 贴图窗口 CSS（第六节） */
  </style>
</head>
<body>
  <div class="pin-container" id="pinContainer">
    <img class="pin-image" id="pinImage" />
    <div class="pin-controls">
      <button class="pin-ctrl-btn" id="pinCopy">复制</button>
      <button class="pin-ctrl-btn" id="pinSave">保存</button>
      <button class="pin-ctrl-btn" id="pinClose">关闭</button>
    </div>
    <div class="pin-opacity-indicator" id="opacityIndicator">100%</div>
  </div>
  <script>
    /* 贴图逻辑 JS */
  </script>
</body>
</html>
```

---

## 十五、设计 checklist

- [x] 所有颜色使用 CSS 变量，支持两套主题自动切换
- [x] 引入 theme-manager.js，通过 storage 事件实时同步主题
- [x] 组件风格与 chat/settings/history 窗口一致（header、close-btn、btn、scrollbar）
- [x] 选区边框使用主题主色（霓虹青/琥珀橙）
- [x] 工具栏使用深色半透明背景 + 模糊效果，在任何桌面背景上可读
- [x] 所有交互有 hover/active 视觉反馈
- [x] 选中工具有高亮状态（active class）
- [x] 调色板和线宽面板有弹出动画
- [x] Toast 通知有入场/退场动画
- [x] 支持 prefers-reduced-motion 无障碍
- [x] 支持 prefers-contrast: high 高对比度
- [x] 高 DPI 下手柄尺寸适配
- [x] 光标样式随操作状态正确变化
- [x] SVG 图标统一使用 currentColor，随主题色变化
- [x] 贴图窗口有悬停显示/隐藏的控制栏
