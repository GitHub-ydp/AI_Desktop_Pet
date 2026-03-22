# 论文 Prompt 工程模式提取报告

> 来源：Reflexion (NeurIPS 2023) / Voyager (Microsoft) / EvoSkill (Sentient AGI)
> 提取日期：2026-03-22
> 用途：指导类人思考协议和自学习进化系统的实现

## 核心发现

三个项目共同证明：**外部记忆 + 结构化反思 prompt** 可以在不微调模型的情况下，让 LLM Agent 实现类似学习的效果。记忆的格式比记忆的量更重要。

## 关键 Prompt 模式

### 1. Reflexion 的自我反思闭环
- 失败后生成语言反思（语义梯度），存入情节记忆
- 重试时叠加所有历史反思，LLM 看到完整的"失败→反思→改进"链
- HumanEval 基准：91% pass@1（GPT-4 仅 80%）

### 2. Voyager 的技能库三件套
- Curriculum Agent（决定学什么）+ Action Agent（执行）+ Critic Agent（验证）
- 技能存储为可执行代码 + 一句话描述，通过向量检索
- Explain → Plan → Code 响应格式

### 3. EvoSkill 的失败驱动进化
- 从失败轨迹中提议 create（新技能）或 edit（改进旧技能）
- Pareto 前沿选择，只保留真正提升性能的技能
- 反模式警告：防重叠、防窄化

## 可直接使用的 Prompt 模板

详见技术顾问完整报告：
C:\Users\ZHANGD~1\AppData\Local\Temp\claude\C--Users-Zhangdongxu-Desktop-jizhang\7eacaeb8-ac42-45ad-9427-7136c97dff77\tasks\af03f74136e11a55b.output

### 经验记忆推荐格式
```json
{
  "task_signature": "将 PDF 转为 Word",
  "status": "success",
  "attempts": [
    {"round": 1, "approach": "...", "result": "error", "reflection": "原因分析..."},
    {"round": 2, "approach": "...", "result": "success", "reflection": null}
  ],
  "final_solution": "PowerShell + Word COM 对象",
  "lessons_learned": "Windows 环境优先使用 COM 对象而非 Python 包",
  "tags": ["file-convert", "pdf", "word", "powershell"]
}
```

### 失败重试注入格式
```xml
<retry_context round="{N}">
  <previous_attempt>工具/参数/结果</previous_attempt>
  <self_reflection>原因分析 + 避免事项 + 改进方向</self_reflection>
  <constraints>不要重复失败方案 + 优先零依赖</constraints>
</retry_context>
```
