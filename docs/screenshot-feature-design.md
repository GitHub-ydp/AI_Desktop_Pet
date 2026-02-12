# 截图功能完善设计方案

> 版本：v1.0
> 日期：2026-02-12
> 作者：feature-designer

---

## 一、现状分析与问题总结

### 1.1 现有文件清单

| 文件 | 角色 | 状态 |
|------|------|------|
| `src/screenshot-capture.js` | 渲染进程截图捕获（ScreenshotCapture 类） | **冗余/未使用** — main.js 中已有独立实现 |
| `src/screenshot-editor.js` | 渲染进程截图编辑器（ScreenshotEditor 类） | **空壳** — 只有接口，无实际编辑能力 |
| `main-process/screenshot.js` | 主进程截图管理（ScreenshotManager 类） | **基础可用** — 文件存储、DB记录、剪贴板复制 |
| `windows/screenshot-capture.html` | 区域选择覆盖窗口 | **基础可用** — 拖拽选区+尺寸显示 |
| `windows/screenshot-window.html` | 截图预览窗口 | **功能不完整** — 无编辑标注、AI/OCR为空壳 |
| `main.js` (line 770-1010) | 截图流程主控 | **基础可用** — 有多显示器支持尝试 |
| `preload.js` (line 174-226) | PetScreenshot IPC 桥接 | **接口完整** — 但多数 handler 返回 stub |

### 1.2 已发现的关键问题

#### P0 — 安全问题
1. **contextIsolation: false** — `screenshot-capture.html` 的 BrowserWindow 使用 `nodeIntegration: true` + `contextIsolation: false`，直接暴露 Node.js API，存在安全风险
2. **预览窗口同样不安全** — `screenshot-window.html` 的 BrowserWindow 也使用 `nodeIntegration: true`

#### P1 — 功能缺失
3. **无编辑标注能力** — 截图后只能预览和复制，不能画框、箭头、文字、马赛克
4. **AI 分析/OCR/翻译为空壳** — `screenshot:analyze`、`screenshot:ocr`、`screenshot:translate` 的 IPC handler 不返回实际结果
5. **无贴图功能** — 没有"固定到桌面"的贴图模式
6. **无另存为** — 保存按钮只显示已有路径，不能选择新位置

#### P2 — 可靠性问题
7. **DPI 缩放处理不完整** — `handleScreenshotCapture()` 中裁剪坐标未乘以 `scaleFactor`，在高 DPI 显示器上会裁错位置
8. **多显示器不同 DPI** — 虚拟屏幕坐标用 DIP（设备无关像素），但 `desktopCapturer` 返回的 thumbnail 是物理像素，两者转换缺失
9. **IPC 监听器泄漏** — `ipcMain.once('screenshot:selected')` 如果用户取消后又重新截图，旧的 once 可能未清除
10. **ipcMain.once('close-screenshot-window')** — 多次打开预览窗口时，旧监听器可能未释放

#### P3 — 代码质量
11. **src/screenshot-capture.js 冗余** — 与 `main.js` 中的 `startScreenshotCapture()` 逻辑重复，且未被实际使用
12. **主题系统未集成** — 截图预览窗口使用硬编码的浅色主题，与项目统一主题系统不一致
13. **选区无调整手柄** — 选完区域后无法微调边界

---

## 二、功能设计总览

### 2.1 截图完整流程

```
┌──────────────────────────────────────────────────────────┐
│                      触发截图                            │
│  (快捷键 Ctrl+Shift+A / 菜单按钮 / 托盘菜单)            │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│                   Phase 1: 区域选择                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ 全屏截图  │  │ 窗口截图  │  │ 区域截图  │  ← 底部模式栏  │
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                          │
│  - 半透明遮罩覆盖所有显示器                                │
│  - 鼠标拖拽选择区域                                       │
│  - 实时显示选区尺寸（像素 + DIP）                          │
│  - 选区完成后显示 8 个调整手柄                             │
│  - 选区上方/下方显示工具条                                 │
│  - ESC 取消 / Enter 确认                                  │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│                   Phase 2: 编辑标注                       │
│                                                          │
│  截图完成后，在选区上方直接进入编辑模式                      │
│  (不打开新窗口，在全屏覆盖层上直接编辑)                      │
│                                                          │
│  工具栏 (选区下方):                                       │
│  [矩形] [圆形] [箭头] [直线] [画笔] [文字] [马赛克]       │
│  [颜色] [线宽] │ [撤销] [重做] │ [完成✓] [取消✕]         │
│                                                          │
│  - Canvas 叠加层绘制标注                                   │
│  - 所有标注实时预览                                        │
│  - 支持选中已有标注并移动/删除                              │
└──────────────┬───────────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────────┐
│                   Phase 3: 保存/分享                      │
│                                                          │
│  编辑确认后，在选区下方显示操作按钮:                         │
│                                                          │
│  [📋 复制] [💾 保存] [📌 贴图] [🤖 AI分析] [❌ 取消]      │
│                                                          │
│  - 复制: 合成标注后写入剪贴板                               │
│  - 保存: 系统另存为对话框，默认 PNG                         │
│  - 贴图: 创建置顶小窗口，固定显示截图                       │
│  - AI分析: 发送给 AI 宠物分析内容                          │
│  - 关闭后回到桌面，恢复主窗口                               │
└──────────────────────────────────────────────────────────┘
```

### 2.2 模块架构图

```
主进程 (Main Process)
├── main.js
│   ├── startScreenshotCapture()     — 截图流程入口
│   ├── handleScreenshotCapture()    — 捕获+裁剪+保存
│   ├── openScreenshotPreview()      — [移除] 不再需要独立预览窗口
│   ├── createPinWindow()            — [新增] 贴图窗口
│   └── screenshot IPC handlers      — 统一注册，含安全校验
│
├── main-process/screenshot.js       — ScreenshotManager（保留+增强）
│   ├── saveImage()
│   ├── copyToClipboard()
│   ├── saveScreenshotRecord()
│   ├── getHistory()
│   ├── saveWithAnnotations()        — [新增] 保存含标注的合成图
│   └── analyzeWithAI()              — [新增] 调用 DeepSeek 视觉分析
│
└── main-process/screenshot-ocr.js   — [新增] OCR 模块
    └── recognizeText()              — 调用 DeepSeek 视觉 API 进行文字识别

渲染进程 (Renderer - screenshot-capture.html)
├── 区域选择模块（重写）
│   ├── 全屏遮罩 + 截图背景
│   ├── 选区拖拽 + 8 点手柄
│   ├── 模式切换栏（全屏/窗口/区域）
│   └── 尺寸信息 + 放大镜
│
├── 编辑标注模块（新增）
│   ├── Canvas 标注层
│   ├── 工具栏控制器
│   ├── 绘制引擎（Shape/Arrow/Text/Mosaic/Brush）
│   └── 历史栈（撤销/重做）
│
└── 操作按钮模块
    ├── 复制到剪贴板
    ├── 保存到文件
    ├── 贴图到桌面
    └── AI 分析

贴图窗口 (Renderer - pin-window.html) [新增]
└── 独立置顶透明窗口，显示截图
```

---

## 三、详细设计

### 3.1 Phase 1: 区域选择增强

#### 3.1.1 全屏截图背景

当前实现在透明窗口上画遮罩，但用户看到的是实时桌面，在遮罩和实际截图之间存在时间差。改进方案：

```
触发截图
  ↓
1. 隐藏主窗口 + 所有子窗口
  ↓
2. 等待 100ms（确保窗口完全隐藏）
  ↓
3. 调用 desktopCapturer 获取全屏截图
   - 每个显示器分别获取（处理不同 DPI）
   - 拼接为完整的虚拟屏幕图像
  ↓
4. 创建全屏覆盖窗口
   - 将截图作为背景图（非实时桌面）
   - 在背景上叠加半透明遮罩
  ↓
5. 用户在静态截图上选择区域
```

**优势：**
- 选择区域时桌面不会变化（其他窗口弹出不影响）
- 截图时间点固定，所见即所得
- 遮罩效果更稳定

#### 3.1.2 多显示器 + DPI 处理

```javascript
// 正确处理多显示器 DPI 的截图流程
async function captureAllDisplays() {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 } // 先不获取缩略图
  });

  const displayCaptures = [];

  for (const display of displays) {
    // 找到对应的 source
    const source = sources.find(s => {
      // Electron 的 source.display_id 对应 display.id
      return String(s.display_id) === String(display.id);
    }) || sources[0];

    // 以物理像素尺寸获取截图
    const physicalWidth = Math.round(display.bounds.width * display.scaleFactor);
    const physicalHeight = Math.round(display.bounds.height * display.scaleFactor);

    const [highResSources] = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physicalWidth, height: physicalHeight }
    });

    displayCaptures.push({
      display,
      image: highResSources.thumbnail,
      physicalWidth,
      physicalHeight,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds // DIP 坐标
    });
  }

  return displayCaptures;
}
```

#### 3.1.3 选区调整手柄

选区完成后，显示 8 个拖拽手柄，允许精确调整边界：

```
    ┌──[N]──┐
    │       │
   [W]     [E]
    │       │
    └──[S]──┘
  加上四角: NW, NE, SW, SE
```

手柄交互：
- 光标形状随手柄方向变化（`nwse-resize`、`nesw-resize`、`ns-resize`、`ew-resize`）
- 拖动手柄实时更新选区尺寸
- 选区内部拖动 = 移动整个选区
- 最小尺寸限制：20x20 像素

#### 3.1.4 模式切换栏

在选区上方（或屏幕顶部居中）显示模式选择：

```
┌─────────────────────────────────┐
│  [全屏] [窗口] [●区域]  │ ESC取消 │
└─────────────────────────────────┘
```

- **全屏模式**: 点击后直接选中整个当前屏幕
- **窗口模式**: 鼠标悬停时自动高亮窗口边界（通过 `desktopCapturer.getSources({ types: ['window'] })` 获取窗口位置），点击选中该窗口
- **区域模式**: 默认模式，手动拖拽

#### 3.1.5 放大镜（可选增强）

鼠标十字准心旁显示放大镜，放大鼠标附近 ~50x50 像素区域到 200x200 显示，帮助精确定位：

```javascript
// 放大镜实现思路
function drawMagnifier(ctx, mouseX, mouseY, bgCanvas) {
  const zoom = 4;
  const srcSize = 50;
  const destSize = 200;

  // 从背景截图中取出鼠标周围区域
  ctx.drawImage(
    bgCanvas,
    mouseX - srcSize / 2, mouseY - srcSize / 2, srcSize, srcSize,
    magnifierX, magnifierY, destSize, destSize
  );

  // 画十字线
  // 画边框
}
```

### 3.2 Phase 2: 编辑标注系统

#### 3.2.1 设计理念

编辑在选区确认后直接在全屏覆盖层上进行，不打开新窗口。选区外围遮罩保持，选区内为截图内容，Canvas 标注层叠加在截图上方。

这样做的好处：
- 所见即所得，编辑位置和截图位置完全吻合
- 无窗口切换，操作流畅
- 类似微信/QQ截图的体验

#### 3.2.2 Canvas 分层结构

```
┌───────────────────────────────────┐
│           全屏覆盖窗口             │
│                                   │
│  ┌─ 遮罩层 (CSS box-shadow)──┐   │
│  │                           │   │
│  │  ┌─ 截图背景 Canvas ──┐   │   │
│  │  │  (原始截图内容)     │   │   │
│  │  │                     │   │   │
│  │  │  ┌─ 标注 Canvas ─┐ │   │   │
│  │  │  │  (绘制标注)    │ │   │   │
│  │  │  │               │ │   │   │
│  │  │  └───────────────┘ │   │   │
│  │  └─────────────────────┘   │   │
│  │                           │   │
│  └───────────────────────────┘   │
│                                   │
│  ┌─ 工具栏 (HTML/CSS) ─────────┐ │
│  │ [矩形][圆形][箭头]...       │ │
│  └──────────────────────────────┘ │
└───────────────────────────────────┘
```

#### 3.2.3 标注工具详细设计

##### 工具列表

| 工具 | 图标 | 说明 | Canvas 操作 |
|------|------|------|-------------|
| 矩形 | ▭ | 画矩形边框 | `strokeRect()` |
| 圆形 | ○ | 画椭圆边框 | `ellipse()` + `stroke()` |
| 箭头 | → | 带箭头的线段 | `lineTo()` + 三角形箭头 |
| 直线 | / | 普通直线 | `lineTo()` |
| 画笔 | ✏ | 自由绘制 | `quadraticCurveTo()` 平滑曲线 |
| 文字 | A | 点击添加文字 | `fillText()` / HTML input overlay |
| 马赛克 | ▦ | 像素化涂抹 | 降采样+放大（像素化） |
| 序号 | ① | 自动递增的编号标记 | 圆形背景 + 数字文字 |

##### 颜色与线宽

```javascript
// 预设颜色
const ANNOTATION_COLORS = [
  '#ff2d78',  // 品红（默认）
  '#00fff0',  // 霓虹青
  '#ffb347',  // 橙色
  '#4ade80',  // 绿色
  '#60a5fa',  // 蓝色
  '#fbbf24',  // 黄色
  '#ffffff',  // 白色
  '#000000'   // 黑色
];

// 线宽选择
const LINE_WIDTHS = [2, 4, 6, 8];
```

##### 标注数据结构

```javascript
// 每个标注对象
class Annotation {
  constructor(type, options) {
    this.id = generateId();
    this.type = type;           // 'rect' | 'ellipse' | 'arrow' | 'line' | 'brush' | 'text' | 'mosaic' | 'number'
    this.color = options.color;
    this.lineWidth = options.lineWidth;
    this.points = [];           // 绘制路径点
    this.bounds = null;         // { x, y, width, height }
    this.text = '';             // 文字标注内容
    this.fontSize = 16;         // 文字大小
    this.number = 0;            // 序号标注的编号
    this.selected = false;
    this.timestamp = Date.now();
  }
}

// 标注管理器
class AnnotationManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.annotations = [];      // 当前所有标注
    this.undoStack = [];        // 撤销栈
    this.redoStack = [];        // 重做栈
    this.currentTool = 'rect';
    this.currentColor = '#ff2d78';
    this.currentLineWidth = 4;
    this.isDrawing = false;
    this.tempAnnotation = null; // 正在绘制的标注
    this.nextNumber = 1;        // 下一个序号
  }

  // 开始绘制
  startDraw(x, y) { ... }

  // 绘制中
  drawing(x, y) { ... }

  // 结束绘制
  endDraw(x, y) { ... }

  // 撤销
  undo() {
    if (this.annotations.length === 0) return;
    const removed = this.annotations.pop();
    this.undoStack.push(removed);
    this.redoStack.push(removed);
    this.redraw();
  }

  // 重做
  redo() {
    if (this.redoStack.length === 0) return;
    const restored = this.redoStack.pop();
    this.annotations.push(restored);
    this.redraw();
  }

  // 重绘所有标注
  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const ann of this.annotations) {
      this.drawAnnotation(ann);
    }
  }

  // 合成最终图像（截图 + 标注）
  composite(backgroundCanvas) {
    const result = document.createElement('canvas');
    result.width = backgroundCanvas.width;
    result.height = backgroundCanvas.height;
    const ctx = result.getContext('2d');
    ctx.drawImage(backgroundCanvas, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    return result;
  }
}
```

##### 马赛克实现

```javascript
// 马赛克：对指定区域进行像素化处理
function drawMosaic(ctx, points, blockSize = 10, sourceCanvas) {
  // 获取路径覆盖的矩形区域
  const bounds = getBoundsFromPoints(points);

  // 从原图取出该区域的像素数据
  const sourceCtx = sourceCanvas.getContext('2d');
  const imageData = sourceCtx.getImageData(
    bounds.x, bounds.y, bounds.width, bounds.height
  );

  // 按 blockSize 分块，取每个块的平均颜色
  for (let y = 0; y < bounds.height; y += blockSize) {
    for (let x = 0; x < bounds.width; x += blockSize) {
      const avgColor = getAverageColor(imageData, x, y, blockSize);
      ctx.fillStyle = avgColor;
      ctx.fillRect(
        bounds.x + x, bounds.y + y,
        blockSize, blockSize
      );
    }
  }
}
```

##### 箭头绘制

```javascript
// 带箭头的线段
function drawArrow(ctx, fromX, fromY, toX, toY, color, lineWidth) {
  const headLength = lineWidth * 4;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // 画线
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // 画箭头
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}
```

#### 3.2.4 工具栏 UI

工具栏出现在选区下方（若空间不足则出现在上方），分为三组：

```
┌─────────────────────────────────────────────────────────────┐
│ [▭][○][→][/][✏][A][▦][①] │ [🎨▼][━▼] │ [↩][↪] │ [✓][✕] │
│  绘制工具                   颜色 线宽   撤销重做   确认取消  │
└─────────────────────────────────────────────────────────────┘
```

- 工具按钮高亮当前选中工具
- 颜色选择器：点击展开 8 色调色板
- 线宽选择器：点击展开 4 种线宽预览
- 确认按钮：完成编辑，进入保存阶段
- 取消按钮：放弃标注，回到选区状态

### 3.3 Phase 3: 保存与分享

#### 3.3.1 操作按钮栏

编辑确认后（或不需要编辑时），在选区下方显示操作按钮：

```
┌──────────────────────────────────────────────┐
│ [📋 复制] [💾 保存] [📌 贴图] [🤖 AI] [✕]   │
└──────────────────────────────────────────────┘
```

#### 3.3.2 复制到剪贴板

```javascript
// 通过 IPC 调用主进程写入剪贴板
async function copyToClipboard(compositeCanvas) {
  // Canvas → dataURL → 通过 IPC 传给主进程
  const dataURL = compositeCanvas.toDataURL('image/png');
  await ipcRenderer.invoke('screenshot:copy-to-clipboard-data', dataURL);
  // 主进程: nativeImage.createFromDataURL(dataURL) → clipboard.writeImage()
}
```

注意：不再需要先保存文件再从文件读取。直接传 dataURL 给主进程，减少一次磁盘 IO。

#### 3.3.3 保存到文件

```javascript
// 两种保存模式
// 1. 快速保存：自动保存到 userData/screenshots/，显示通知
// 2. 另存为：弹出系统文件选择对话框
async function saveToFile(compositeCanvas, mode = 'quick') {
  const dataURL = compositeCanvas.toDataURL('image/png');

  if (mode === 'quick') {
    // 通过 IPC 调用主进程快速保存
    const result = await ipcRenderer.invoke('screenshot:save-quick', dataURL);
    showNotification(`已保存到 ${result.filePath}`);
  } else {
    // 弹出另存为对话框
    const result = await ipcRenderer.invoke('screenshot:save-as', dataURL);
    if (result.success) {
      showNotification(`已保存到 ${result.filePath}`);
    }
  }
}
```

主进程 IPC handler：

```javascript
ipcMain.handle('screenshot:save-as', async (event, dataURL) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: `screenshot_${Date.now()}.png`,
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }
    ]
  });

  if (result.canceled) return { success: false };

  const image = nativeImage.createFromDataURL(dataURL);
  const ext = path.extname(result.filePath).toLowerCase();
  const buffer = ext === '.jpg' || ext === '.jpeg'
    ? image.toJPEG(90)
    : image.toPNG();

  await fs.writeFile(result.filePath, buffer);
  return { success: true, filePath: result.filePath };
});
```

#### 3.3.4 贴图到桌面

创建一个独立的置顶透明小窗口，显示截图：

```javascript
// 主进程: 创建贴图窗口
function createPinWindow(imageDataURL, bounds) {
  const pinWin = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,           // 允许缩放
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  pinWin.loadFile('windows/pin-window.html');

  pinWin.webContents.on('did-finish-load', () => {
    pinWin.webContents.send('pin:load', imageDataURL);
  });

  // 双击关闭
  // 鼠标滚轮调整透明度
  // 右键菜单: 复制/保存/关闭
}
```

贴图窗口 HTML (`windows/pin-window.html`)：
- 显示截图，可拖动
- 鼠标滚轮调节透明度（30%~100%）
- 双击关闭
- 右键菜单：复制、保存、关闭

#### 3.3.5 AI 分析集成

利用项目已有的 DeepSeek API，将截图发给 AI 进行内容分析：

```javascript
// 主进程: AI 分析截图
async function analyzeScreenshot(imageDataURL, prompt) {
  // 使用 DeepSeek 视觉模型（如果支持图片输入）
  // 或者先保存图片，用 base64 编码发送
  const base64 = imageDataURL.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || '请分析这张截图的内容' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}
```

**注意**：DeepSeek 的模型是否支持视觉输入需要确认。如果不支持，可以：
1. 使用其他支持视觉的 API（如阿里通义千问 VL）
2. 先做 OCR 提取文字，再用文字模型分析
3. 本地 OCR（使用 Tesseract.js）

#### 3.3.6 OCR 文字识别

推荐使用 **Tesseract.js**（纯 JS，无需原生编译，与项目的 `@huggingface/transformers` 策略一致）：

```javascript
// 主进程: OCR 识别
const { createWorker } = require('tesseract.js');

class ScreenshotOCR {
  constructor() {
    this.worker = null;
    this.ready = false;
  }

  async initialize() {
    this.worker = await createWorker('chi_sim+eng');
    this.ready = true;
  }

  async recognize(imageDataURL) {
    if (!this.ready) await this.initialize();
    const { data: { text } } = await this.worker.recognize(imageDataURL);
    return text;
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }
}
```

**依赖**: `tesseract.js`（纯 JS，~2MB core + 语言包按需下载约 10MB）

---

## 四、安全改进

### 4.1 统一使用 contextIsolation: true

所有截图相关窗口改为安全模式：

```javascript
// 截图覆盖窗口
screenshotCaptureWindow = new BrowserWindow({
  // ... 其他配置不变
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js')
  }
});
```

在 `preload.js` 中新增截图专用的 IPC 通道：

```javascript
// preload.js 新增
contextBridge.exposeInMainWorld('ScreenshotBridge', {
  // 区域选择完成
  selectRegion: (bounds) => ipcRenderer.invoke('screenshot:selected', bounds),
  // 取消截图
  cancel: () => ipcRenderer.invoke('screenshot:cancelled'),
  // 复制合成图到剪贴板
  copyDataToClipboard: (dataURL) => ipcRenderer.invoke('screenshot:copy-data', dataURL),
  // 快速保存
  saveQuick: (dataURL) => ipcRenderer.invoke('screenshot:save-quick', dataURL),
  // 另存为
  saveAs: (dataURL) => ipcRenderer.invoke('screenshot:save-as', dataURL),
  // 贴图到桌面
  pinToDesktop: (dataURL, bounds) => ipcRenderer.invoke('screenshot:pin', dataURL, bounds),
  // AI 分析
  analyze: (dataURL, prompt) => ipcRenderer.invoke('screenshot:analyze-image', dataURL, prompt),
  // OCR
  ocr: (dataURL) => ipcRenderer.invoke('screenshot:ocr-image', dataURL),
  // 获取全屏截图背景
  getScreenCapture: () => ipcRenderer.invoke('screenshot:get-screen-capture')
});
```

### 4.2 IPC 监听器管理

使用 `ipcMain.handle` 替代 `ipcMain.once`，避免监听器泄漏：

```javascript
// 旧方式（有泄漏风险）
ipcMain.once('screenshot:selected', handler);

// 新方式（安全）
ipcMain.handle('screenshot:selected', handler);
// 或使用带清理的 once
function setupScreenshotListeners() {
  const cleanup = () => {
    ipcMain.removeHandler('screenshot:selected');
    ipcMain.removeHandler('screenshot:cancelled');
  };

  ipcMain.handleOnce('screenshot:selected', async (event, bounds) => {
    cleanup();
    return handleScreenshotCapture(bounds);
  });

  ipcMain.handleOnce('screenshot:cancelled', async () => {
    cleanup();
    closeScreenshotCapture();
  });
}
```

### 4.3 输入验证

```javascript
// 对所有 IPC 输入进行校验
ipcMain.handle('screenshot:selected', async (event, bounds) => {
  // 验证 bounds 格式
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number'
      || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
    throw new Error('Invalid bounds format');
  }

  // 验证范围合理性
  if (bounds.width < 1 || bounds.height < 1
      || bounds.width > 10000 || bounds.height > 10000) {
    throw new Error('Bounds out of range');
  }

  return handleScreenshotCapture(bounds);
});
```

---

## 五、主题系统集成

### 5.1 截图覆盖窗口主题

截图覆盖窗口（`screenshot-capture.html`）引入 `theme-manager.js`，工具栏和提示文字使用 CSS 变量：

```html
<head>
  <script src="../src/theme-manager.js"></script>
  <style>
    :root {
      /* 默认值，会被 theme-manager.js 覆盖 */
      --bg: #020810;
      --neon-cyan: #00fff0;
      --neon-magenta: #ff2d78;
      --text: #cff0ff;
      --border: rgba(0, 255, 240, 0.3);
    }

    /* 选区边框 */
    #selection {
      border: 2px solid var(--neon-cyan);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    }

    /* 工具栏 */
    .toolbar {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .toolbar-btn {
      color: var(--text);
      border: 1px solid var(--border);
    }

    .toolbar-btn:hover {
      border-color: var(--neon-cyan);
      box-shadow: var(--glow-sm);
    }

    .toolbar-btn.active {
      background: rgba(0, 255, 240, 0.15);
      border-color: var(--neon-cyan);
    }
  </style>
</head>
```

### 5.2 贴图窗口主题

贴图窗口边框和右键菜单也使用主题变量。

---

## 六、代码清理与重构

### 6.1 文件删除

| 文件 | 操作 | 原因 |
|------|------|------|
| `src/screenshot-capture.js` | **删除** | 与 main.js 重复，未被使用 |
| `src/screenshot-editor.js` | **删除** | 空壳类，功能将在 screenshot-capture.html 内实现 |
| `windows/screenshot-window.html` | **删除** | 独立预览窗口被"就地编辑"模式取代 |

### 6.2 文件修改

| 文件 | 修改内容 |
|------|----------|
| `main.js` | 重构截图流程：先捕获全屏→传给覆盖窗口；移除 openScreenshotPreview；新增贴图窗口管理；修复 DPI 处理；IPC 改用 handle |
| `main-process/screenshot.js` | 新增 `saveFromDataURL()`、`analyzeWithAI()`；移除未使用方法 |
| `windows/screenshot-capture.html` | 完整重写：背景图+选区+编辑标注+操作按钮，一站式体验 |
| `preload.js` | 新增 `ScreenshotBridge` 安全 API |
| `src/rotary-menu.js` | 在二级菜单添加"截图"按钮 |

### 6.3 新增文件

| 文件 | 说明 |
|------|------|
| `windows/pin-window.html` | 贴图窗口 |
| `main-process/screenshot-ocr.js` | OCR 模块（Tesseract.js 封装） |

---

## 七、IPC 通道设计

### 7.1 截图流程 IPC

```
渲染进程 (screenshot-capture.html)          主进程 (main.js)
──────────────────────────────────          ──────────────────

                                    ←──── screenshot:init-capture
                                           (发送全屏截图 dataURL + 显示器信息)

screenshot:selected ────────────────────→  handleScreenshotCapture()
  { bounds, displayId }                    裁剪+保存+返回结果

screenshot:cancelled ───────────────────→  closeScreenshotCapture()

screenshot:copy-data ───────────────────→  写入剪贴板
  { dataURL }                              返回 { success }

screenshot:save-quick ──────────────────→  快速保存到 userData/screenshots/
  { dataURL }                              返回 { success, filePath }

screenshot:save-as ─────────────────────→  弹出另存为对话框
  { dataURL }                              返回 { success, filePath }

screenshot:pin ─────────────────────────→  创建贴图窗口
  { dataURL, bounds }                      返回 { success, windowId }

screenshot:analyze-image ───────────────→  调用 AI API 分析
  { dataURL, prompt }                      返回 { success, result }

screenshot:ocr-image ───────────────────→  调用 OCR 引擎
  { dataURL }                              返回 { success, text }
```

### 7.2 贴图窗口 IPC

```
渲染进程 (pin-window.html)                  主进程 (main.js)
──────────────────────────────              ──────────────────

                                    ←──── pin:load
                                           (发送截图 dataURL)

pin:copy ───────────────────────────────→  复制到剪贴板
pin:save ───────────────────────────────→  另存为
pin:close ──────────────────────────────→  关闭贴图窗口
pin:set-opacity ────────────────────────→  设置窗口透明度
```

---

## 八、数据结构

### 8.1 数据库表（已有，不需修改）

`screenshots` 表和 `screenshot_analyses` 表已有，满足需求。

### 8.2 截图元数据

```javascript
// 保存时的截图记录
{
  id: 'screenshot_1707732000000_a1b2c3d4',
  filePath: 'C:/Users/.../screenshots/screenshot_xxx.png',
  fileSize: 125000,
  width: 800,        // 物理像素宽度
  height: 600,       // 物理像素高度
  format: 'png',
  captureMethod: 'region',  // 'region' | 'fullscreen' | 'window'
  metadata: {
    displayId: '12345',
    scaleFactor: 1.25,
    hasAnnotations: true,
    annotationCount: 3
  },
  tags: null,
  ocrText: null,     // OCR 后填充
  isDeleted: 0,
  createdAt: 1707732000000,
  accessedAt: null
}
```

---

## 九、快捷键设计

| 快捷键 | 作用 | 作用域 |
|--------|------|--------|
| `Ctrl+Shift+A` | 启动区域截图 | 全局（已有） |
| `Ctrl+Shift+F` | 全屏截图 | 全局（新增，可选） |
| `ESC` | 取消截图 / 退出编辑 | 截图窗口 |
| `Enter` | 确认选区 / 确认编辑 | 截图窗口 |
| `Ctrl+Z` | 撤销标注 | 编辑模式 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做标注 | 编辑模式 |
| `Ctrl+C` | 复制截图到剪贴板 | 操作阶段 |
| `Ctrl+S` | 保存截图 | 操作阶段 |
| `1-8` | 快速切换工具 | 编辑模式（可选） |

---

## 十、实施计划

### Phase 1: 基础修复（优先级最高）

1. 修复安全问题：所有窗口改用 `contextIsolation: true`
2. 修复 DPI 处理：正确计算物理像素坐标
3. 修复 IPC 泄漏：改用 `handle` + 清理机制
4. 删除冗余代码：移除 `screenshot-capture.js`、`screenshot-editor.js`
5. 集成主题系统

### Phase 2: 区域选择增强

1. 实现全屏截图背景（先截图再选区）
2. 添加选区调整手柄（8 个方向）
3. 添加模式切换栏（全屏/窗口/区域）
4. 优化尺寸提示

### Phase 3: 编辑标注

1. Canvas 分层结构搭建
2. 实现矩形、圆形、箭头、直线绘制
3. 实现画笔工具（平滑曲线）
4. 实现马赛克工具
5. 实现文字标注
6. 撤销/重做系统
7. 颜色/线宽选择器

### Phase 4: 保存与分享

1. 复制到剪贴板（dataURL 模式）
2. 快速保存 + 另存为
3. 贴图窗口实现
4. 操作完成后自动关闭覆盖层

### Phase 5: AI 集成

1. AI 内容分析（对接 DeepSeek 或视觉 API）
2. OCR 文字识别（Tesseract.js）
3. 分析结果显示与交互

---

## 十一、依赖变更

### 新增依赖

| 包名 | 用途 | 大小 |
|------|------|------|
| `tesseract.js` | OCR 文字识别 | ~2MB core + 语言包 |

### 无需新增

- Canvas 2D API 是浏览器原生 API，无需额外依赖
- 标注编辑全部原生 JS + Canvas 实现
- 贴图窗口使用 Electron 原生 BrowserWindow

---

## 十二、注意事项

1. **先截图后选区** — 这是核心体验改进，确保所见即所得
2. **不开新窗口编辑** — 在全屏覆盖层上完成所有操作，减少上下文切换
3. **DPI 处理要全程一致** — 覆盖窗口用 DIP 坐标，Canvas 用物理像素，裁剪时要正确转换
4. **大图传输用 dataURL** — 避免频繁磁盘 IO，截图完成后一次性保存
5. **OCR 语言包懒加载** — 首次使用时下载，不影响启动速度
6. **贴图窗口数量限制** — 最多同时 5 个贴图窗口，防止内存泄漏
7. **保持中文注释** — 遵循项目惯例
