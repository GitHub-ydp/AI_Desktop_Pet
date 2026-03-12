# AI Desktop Pet 首次使用路径审计

> 日期：2026-03-12
> 目标：梳理“用户第一次打开产品，到第一次完成核心交互”的真实路径，找出阻塞点与需要修改的页面

---

## 1. 当前首次使用路径

基于当前代码，首次使用主路径如下：

1. 用户启动应用，主界面显示桌宠
2. 主进程和记忆系统初始化
3. 前端检查记忆库中是否已有对话记录
4. 如果没有对话记录，则自动弹出初始化窗口
5. 用户需要填写姓名，性别、生日、兴趣为可选
6. 提交后，系统将这段信息写入记忆系统，并生成一条欢迎确认语
7. 用户关闭初始化窗口后，回到桌宠主界面
8. 用户需要再次点击桌宠或打开菜单
9. 用户从菜单进入聊天窗口
10. 用户在聊天窗口输入第一条消息
11. 聊天优先走 Agent 通道，失败后回退到基础聊天
12. 基础聊天依赖 DeepSeek API Key
13. 若没有可用 Key，用户只能收到泛化失败提示

---

## 2. 路径中的核心问题

### 2.1 首次打开先收资料，不先展示价值

当前首次启动时，系统会在没有历史对话时立刻弹出初始化资料窗。

问题：

- 用户还没感受到产品价值，就先被要求填写信息
- 这更像“注册表单”，不像“欢迎体验”
- 用户填写完仍然没有立刻进入核心场景

结论：

首次启动不应该先让用户“配置自己”，而应该先让用户“体验产品”。

### 2.2 首次路径过长，用户要做两次切换

当前路径是：

桌宠主界面 -> 初始化窗 -> 返回主界面 -> 再打开聊天窗 -> 才开始第一次对话

问题：

- 链路太长
- 心智中断明显
- 初始化和聊天被拆成两个阶段，体验不连续

结论：

第一次核心交互应该压缩到单一主路径中，不应该要求用户来回切窗。

### 2.3 聊天成功依赖 API Key，首次体验不稳定

当前基础聊天逻辑在缺少 DeepSeek Key 时会直接失败，最后只返回泛化错误文案。

问题：

- 用户看不到明确原因
- 用户不知道怎么解决
- 用户第一次发消息就可能失败

结论：

当前首次体验仍然被 API Key 卡死，这是最高优先级问题之一。

### 2.4 入口太多，主线不清晰

当前产品存在多个入口：

- 主界面桌宠点击
- 菜单窗口
- 聊天窗口
- 设置窗口
- 历史窗口
- 技术面板
- 任务和健康入口

问题：

- 对新用户来说，重要入口和高级入口没有明显区分
- “技能面板”这类高级能力过早暴露
- 首次用户不知道先点哪里

结论：

首次体验阶段必须只保留少数主能力入口。

### 2.5 资料初始化内容过重

当前初始化窗口要求至少填写名字，并展示多项资料字段。

问题：

- 输入成本偏高
- 用户在不了解产品前不一定愿意填
- 这会放大“像注册”的感受

结论：

初始化资料收集必须降级为轻量欢迎流程，或延后到用户完成第一次对话之后。

---

## 3. 代码层证据

以下文件已确认直接影响首次使用路径：

### 主界面初始化与首次弹窗

- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):241
- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):266
- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):286

作用：

- 判断是否为首次使用
- 弹出初始化窗口
- 将初始化资料写入记忆系统

### 聊天窗口打开路径

- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):764
- [windows/menu-window.js](C:\Users\Zhangdongxu\Desktop\jizhang\windows\menu-window.js):8
- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):603

作用：

- 从主界面快捷键或菜单打开聊天窗

### 首次聊天发送路径

- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js):806
- [windows/chat-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\chat-window.html):1095
- [windows/chat-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\chat-window.html):1147

作用：

- 聊天优先尝试 Agent 通道
- 失败后部分情况回退到基础聊天

### API Key 依赖点

- [src/api.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\api.js):4
- [src/api.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\api.js):6
- [windows/settings-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\settings-window.html):188

作用：

- 基础聊天直接依赖 DeepSeek Key
- 设置页暴露较完整的模型和密钥配置

### 首次资料收集页面

- [windows/init-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\init-window.html)

作用：

- 首次启动时展示用户资料填写表单

---

## 4. 当前首次体验中的真实卡点排序

按优先级排序，当前卡点如下：

### P0

1. 首次打开先弹资料窗，而不是先展示核心价值
2. 聊天首次成功依赖 API Key
3. 首次主路径过长，用户要切换多个窗口

### P1

1. 主界面和菜单入口过多
2. 高级能力暴露过早
3. 初始化文案更像注册，不像欢迎体验

### P2

1. 视觉反馈还不够聚焦在“第一次成功体验”
2. 首次成功后没有明显的下一步引导

---

## 5. 建议的新首次使用路径

建议将首次使用路径重构为：

1. 用户启动应用
2. 主界面直接展示一句话价值说明
3. 同时展示 3 个可立即尝试的入口
- 和我聊一句
- 截图问我
- 设一个提醒
4. 用户先完成第一次实际体验
5. 体验成功后，再轻量引导填写昵称或偏好
6. 系统在第一次真实交互后开始建立记忆

这个路径的原则是：

- 先体验，后收资料
- 先成功，后引导
- 先突出主能力，后展示高级能力

---

## 6. 建议的页面改动范围

第一轮需要改动的页面和文件如下：

### 必改

- [src/app-vanilla.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\app-vanilla.js)
- [index.html](C:\Users\Zhangdongxu\Desktop\jizhang\index.html)
- [windows/init-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\init-window.html)
- [windows/chat-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\chat-window.html)
- [windows/menu-window.js](C:\Users\Zhangdongxu\Desktop\jizhang\windows\menu-window.js)
- [src/api.js](C:\Users\Zhangdongxu\Desktop\jizhang\src\api.js)

### 可能需要同步修改

- [windows/settings-window.html](C:\Users\Zhangdongxu\Desktop\jizhang\windows\settings-window.html)
- [README.md](C:\Users\Zhangdongxu\Desktop\jizhang\README.md)
- [web/src/App.vue](C:\Users\Zhangdongxu\Desktop\jizhang\web\src\App.vue)

---

## 7. 第一轮改造建议

第一轮只做最关键的收敛，不做大重构。

建议改造顺序：

1. 暂停首次自动弹出重资料初始化窗
2. 在主界面增加首次引导层或欢迎气泡
3. 给新用户直接提供 3 个可点击示例操作
4. 将初始化资料改成“轻量昵称 + 稍后补充”
5. 把高级入口从首轮体验里弱化

---

## 8. 本轮输出结论

本次审计确认：

- 当前首次使用路径不适合做产品放量
- 当前最大问题不是功能不够，而是首次体验顺序错误
- 下一步应该优先做“首屏 3 个价值点 + 首次引导方案”，而不是继续加功能

后续执行顺序建议为：

1. 定义首屏 3 个价值点
2. 设计首次引导文案
3. 确定要隐藏的入口
4. 再进入具体 UI 和交互改造
