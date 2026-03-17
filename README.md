# AI Desktop Pet 🐱

一个基于 Electron 的 AI 驱动桌面宠物应用，可以在桌面上陪伴你、与你对话，还能帮你执行任务。

## 特性

- 🤖 **AI 对话** - 基于 DeepSeek API 的智能对话，支持多种性格
- 🎭 **四种性格** - 治愈 / 搞笑 / 高冷 / 助手，切换即时生效
- 💕 **心情系统** - 宠物会根据互动产生情绪变化，无交互时自动衰减
- 🧠 **记忆系统** - SQLite 持久记忆，支持向量语义搜索，重启后仍能记住你
- ⏰ **提醒功能** - 自然语言设置提醒，支持模糊时间学习用户习惯
- 🛠️ **Agent 技能** - 文件操作、网页搜索、截图 OCR 等 12 个内置技能
- 📸 **截图工具** - 区域截图、标注编辑、贴图到桌面、AI 分析
- 🎨 **主题系统** - 赛博朋克 / 懒猫橘 / 经典三套主题
- 🐾 **多皮肤** - 猫咪（Lottie 动画）/ 狗狗 / 兔子 / 狐狸 / 熊
- 📱 **桌面体验** - 透明窗口、始终置顶、可拖拽、系统托盘

## 快速开始

### 安装依赖

```bash
npm install
npx @electron/rebuild   # 编译原生模块（better-sqlite3）
```

### 开发模式

```bash
npm start        # 普通启动
npm run dev      # 带 DevTools 启动
```

### 打包应用

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## 配置 API Key

首次运行后，在应用设置面板的「API Key 管理」中填入你的 DeepSeek API Key。

也可以在项目根目录创建 `.env` 文件：

```
DEEPSEEK_API_KEY=your-key-here
```

获取 API Key：https://platform.deepseek.com/

## 项目结构

```
jizhang/
├── main.js                  # Electron 主进程
├── preload.js               # IPC 桥接（contextBridge）
├── index.html               # 主窗口
├── src/
│   ├── app-vanilla.js       # 主应用逻辑（活跃文件）
│   ├── api.js               # DeepSeek API 客户端 + 工具调用
│   ├── storage.js           # LocalStorage 封装
│   ├── prompts.js           # 性格提示词
│   ├── skin-registry.js     # 多皮肤注册中心
│   ├── animations.js        # 动画状态机
│   ├── lottie-controller.js # Lottie 动画播放器
│   └── reminder-extractor.js # 提醒时间解析
├── main-process/
│   ├── memory.js            # 记忆系统协调器
│   ├── search.js            # 混合搜索（BM25 + 向量）
│   ├── embedding.js         # 本地 ONNX 向量嵌入
│   ├── fact-extractor.js    # LLM 事实提取
│   ├── reminder.js          # 提醒调度器
│   ├── skill-registry.js    # 技能注册中心
│   └── skill-executor.js    # 技能执行器
├── windows/                 # 各子窗口 HTML
├── skills/                  # 内置 Agent 技能（SKILL.md 声明式）
├── python-tools/            # Python 工具层
├── lottie/                  # Lottie 动画资源
└── docs/                    # 架构文档
```

## 技术栈

- **Electron** - 桌面应用框架
- **原生 JavaScript** - 无前端框架
- **DeepSeek API** - AI 对话 + 事实提取
- **SQLite** (`better-sqlite3`) - 记忆持久化
- **ONNX** (`@huggingface/transformers`) - 本地向量嵌入（bge-small-zh-v1.5）
- **Python** - 工作流工具层

## 数据存储位置

```
Windows: C:\Users\<用户名>\AppData\Roaming\ai-desktop-pet\
  ├── pet-memory.db    # 对话记忆、事实、提醒
  └── api-keys.json    # API Key 本地存储
```

## 文档

- [记忆系统设计](docs/memory-system-design.md)
- [技能系统架构](docs/skills-architecture.md)
- [工作流架构](docs/workflow-architecture.md)
- [动画系统说明](docs/animation-system.md)
- [服务器运维](docs/server-operations.md)

## 许可证

MIT License
