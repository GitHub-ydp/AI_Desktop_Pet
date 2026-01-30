# 快速开始指南 🚀

## 第一步：安装依赖

在项目根目录执行：

```bash
npm install
```

这会安装以下依赖：
- `electron` - 桌面应用框架
- `electron-builder` - 打包工具
- `vue` - 前端框架

## 第二步：配置 API Key

**重要！必须配置才能使用AI对话功能。**

1. 打开文件：`src/api.js`
2. 找到这一行：
   ```javascript
   const API_KEY = 'YOUR_DEEPSEEK_API_KEY_HERE';
   ```
3. 将其替换为你的 DeepSeek API Key

### 获取 DeepSeek API Key

1. 访问：https://platform.deepseek.com/
2. 注册/登录账号
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 复制 Key 并粘贴到 `src/api.js` 中

**注意：**
- 新用户有500万tokens免费额度
- 请勿泄露你的 API Key
- 不要将 API Key 提交到公开仓库

## 第三步：运行应用

开发模式（带开发者工具）：
```bash
npm run dev
```

正常模式：
```bash
npm start
```

## 第四步：打包应用

### Windows
```bash
npm run build:win
```
生成的安装包在 `dist/` 目录

### macOS
```bash
npm run build:mac
```

### Linux
```bash
npm run build:linux
```

## 使用说明

1. **启动应用** - 桌面上会出现一个可爱的宠物
2. **点击对话** - 点击宠物图标，在输入框中输入文字
3. **切换设置** - 点击设置按钮可以：
   - 更换宠物（5种可选）
   - 切换性格（4种可选）
   - 开关主动说话功能
4. **查看历史** - 点击"对话历史"查看所有对话记录

## 功能特点

- ✅ **AI对话** - 基于 DeepSeek AI 的智能对话
- ✅ **四种性格** - 治愈/搞笑/傲娇/助理
- ✅ **心情系统** - 宠物会根据互动产生情绪变化
- ✅ **主动说话** - 宠物会随机主动和你说话
- ✅ **桌面体验** - 透明窗口、置顶、可拖拽
- ✅ **本地存储** - 所有数据保存在本地，隐私安全
- ✅ **免登录** - 打开即用，无需注册

## 常见问题

### Q: 为什么AI不回复？
A: 请检查：
1. 是否正确配置了 DeepSeek API Key
2. 网络连接是否正常
3. API 额度是否用完

### Q: 如何更换图标？
A: 参考 `assets/README.md` 中的说明

### Q: 如何修改宠物性格的prompt？
A: 编辑 `src/prompts.js` 文件中的 `PERSONALITIES` 对象

### Q: 数据保存在哪里？
A: 所有数据保存在浏览器的 LocalStorage 中，位置：
- Windows: `%AppData%\..\Local\[app-name]\Local Storage`
- macOS: `~/Library/Application Support/[app-name]/Local Storage`

### Q: 如何重置所有数据？
A: 在设置面板中点击"重置所有数据"按钮

## 开发建议

### 调试
- 运行 `npm run dev` 打开开发者工具
- 查看 Console 和 Network 标签页

### 修改样式
- 编辑 `src/style.css`
- 修改后按 Ctrl+R (或 Cmd+R) 刷新

### 添加新功能
- 主逻辑在 `src/app.js`
- 可以参考现有代码添加新功能

## 获取帮助

如果遇到问题：
1. 查看 Console 中的错误信息
2. 检查 API Key 是否配置正确
3. 查看 GitHub Issues
4. 阅读设计文档：`docs/plans/2025-01-30-ai-desktop-pet-design.md`

祝你使用愉快！🎉
