---
name: code-reviewer
description: "自动代码审查工具。检查代码风格、安全漏洞、性能问题、最佳实践违规。提供详细的审查报告和改进建议。支持多种编程语言和审查标准。"
license: MIT
version: 1.0.0
---

# 代码审查器

自动化代码审查，发现潜在问题，提升代码质量。

## 功能特性

### 审查维度

#### 1. 代码风格 (Code Style)
- 命名规范
- 缩进和格式
- 注释规范
- 文件组织

#### 2. 代码质量 (Code Quality)
- 复杂度分析
- 重复代码检测
- 死代码识别
- 代码坏味道

#### 3. 安全问题 (Security)
- SQL 注入风险
- XSS 跨站脚本
- 敏感信息泄露
- 不安全的依赖

#### 4. 性能问题 (Performance)
- 低效算法
- 内存泄漏
- 不必要的计算
- 资源未释放

#### 5. 最佳实践 (Best Practices)
- SOLID 原则
- 设计模式使用
- 错误处理
- 测试覆盖率

## 审查清单

### Python 代码审查

**命名规范**:
```python
# ❌ 不推荐
def calcTotalPrice(itemList):
    pass

# ✅ 推荐
def calculate_total_price(items):
    pass
```

**异常处理**:
```python
# ❌ 不推荐 - 捕获所有异常
try:
    risky_operation()
except:
    pass

# ✅ 推荐 - 具体异常类型
try:
    risky_operation()
except ValueError as e:
    logger.error(f"Invalid value: {e}")
    raise
```

**资源管理**:
```python
# ❌ 不推荐
file = open('data.txt', 'r')
data = file.read()
file.close()

# ✅ 推荐 - 使用上下文管理器
with open('data.txt', 'r') as file:
    data = file.read()
```

**类型提示**:
```python
# ❌ 不推荐
def process_data(data):
    return data * 2

# ✅ 推荐
def process_data(data: List[int]) -> List[int]:
    return [x * 2 for x in data]
```

### JavaScript/TypeScript 审查

**变量声明**:
```javascript
// ❌ 不推荐
var count = 0;

// ✅ 推荐
const count = 0;  // 不会改变
let index = 0;    // 会改变
```

**等值比较**:
```javascript
// ❌ 不推荐
if (value == null) { }

// ✅ 推荐
if (value === null) { }
```

**Promise 处理**:
```javascript
// ❌ 不推荐
fetchData()
  .then(data => processData(data))
  .catch(err => console.log(err));

// ✅ 推荐
async function handleData() {
  try {
    const data = await fetchData();
    await processData(data);
  } catch (error) {
    logger.error('Data processing failed:', error);
    throw error;
  }
}
```

### SQL 审查

**SQL 注入防护**:
```python
# ❌ 危险 - SQL 注入风险
query = f"SELECT * FROM users WHERE id = {user_id}"

# ✅ 安全 - 参数化查询
query = "SELECT * FROM users WHERE id = ?"
cursor.execute(query, (user_id,))
```

**性能优化**:
```sql
-- ❌ 不推荐 - 使用 SELECT *
SELECT * FROM large_table WHERE status = 'active';

-- ✅ 推荐 - 只选择需要的列
SELECT id, name, email FROM large_table WHERE status = 'active';
```

## 安全审查重点

### 1. 输入验证
```python
# ❌ 不推荐 - 无验证
def create_user(username, email):
    user = User(username=username, email=email)
    db.save(user)

# ✅ 推荐 - 有验证
def create_user(username: str, email: str):
    if not username or len(username) < 3:
        raise ValueError("Username too short")
    if not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', email):
        raise ValueError("Invalid email")
    
    user = User(username=username, email=email)
    db.save(user)
```

### 2. 敏感信息
```python
# ❌ 危险 - 硬编码密钥
API_KEY = "sk-1234567890abcdef"
DB_PASSWORD = "admin123"

# ✅ 推荐 - 使用环境变量
import os
API_KEY = os.getenv('API_KEY')
DB_PASSWORD = os.getenv('DB_PASSWORD')
```

### 3. 认证和授权
```python
# ❌ 不推荐 - 无权限检查
@app.route('/api/delete_user/<int:user_id>')
def delete_user(user_id):
    User.query.filter_by(id=user_id).delete()
    return jsonify({'success': True})

# ✅ 推荐 - 有权限检查
@app.route('/api/delete_user/<int:user_id>')
@require_admin
def delete_user(user_id):
    if not current_user.can_delete_user(user_id):
        abort(403)
    User.query.filter_by(id=user_id).delete()
    return jsonify({'success': True})
```

## 性能审查重点

### 1. 算法复杂度
```python
# ❌ O(n²) - 低效
def find_duplicates(items):
    duplicates = []
    for i, item in enumerate(items):
        for j, other in enumerate(items):
            if i != j and item == other:
                duplicates.append(item)
    return list(set(duplicates))

# ✅ O(n) - 高效
def find_duplicates(items):
    seen = set()
    duplicates = set()
    for item in items:
        if item in seen:
            duplicates.add(item)
        seen.add(item)
    return list(duplicates)
```

### 2. 数据库查询
```python
# ❌ N+1 查询问题
for user in users:
    print(user.profile.bio)  # 每次循环都查询数据库

# ✅ 使用连接查询
users_with_profiles = User.query.join(Profile).all()
for user in users_with_profiles:
    print(user.profile.bio)  # 只查询一次
```

### 3. 缓存使用
```python
# ❌ 不推荐 - 重复计算
def get_expensive_data(user_id):
    # 昂贵的计算或查询
    return complex_calculation(user_id)

# ✅ 推荐 - 使用缓存
from functools import lru_cache

@lru_cache(maxsize=128)
def get_expensive_data(user_id):
    return complex_calculation(user_id)
```

## 使用方法

### 基础用法

**全面审查**:
```
"审查这段代码"
"检查代码质量"
"Code review 这个 PR"
```

**针对性审查**:
```
"检查安全问题"
"分析性能瓶颈"
"检查代码风格"
```

### 高级用法

**项目级审查**:
```
"审查整个项目"
"生成代码审查报告"
```

**对比审查**:
```
"比较重构前后的代码质量"
"审查这次提交的改动"
```

## 审查级别

### 🔴 严重 (Critical)
- 安全漏洞
- 数据丢失风险
- 系统崩溃可能
- **必须修复**

### 🟠 重要 (Major)
- 性能问题
- 资源泄漏
- 逻辑错误
- **强烈建议修复**

### 🟡 一般 (Minor)
- 代码风格
- 命名不规范
- 注释缺失
- **建议改进**

### 🟢 提示 (Info)
- 最佳实践建议
- 优化机会
- 可选改进
- **参考建议**

## 审查报告

### 报告结构
```
1. 概述
   - 审查范围
   - 代码行数
   - 发现问题数量

2. 问题详情
   - 严重级别
   - 问题描述
   - 代码位置
   - 修复建议

3. 质量指标
   - 代码复杂度
   - 测试覆盖率
   - 重复代码比例

4. 改进建议
   - 优先级排序
   - 估算工作量
```

### 示例报告
```markdown
# 代码审查报告

## 概述
- 文件: user_service.py
- 代码行数: 256 行
- 发现问题: 8 个

## 问题清单

### 🔴 严重 (1)
1. **SQL 注入风险** (第 45 行)
   - 使用字符串拼接构造 SQL
   - 建议: 使用参数化查询

### 🟠 重要 (3)
2. **异常处理不当** (第 78 行)
   - 捕获所有异常但未处理
   - 建议: 捕获具体异常类型

3. **资源未释放** (第 102 行)
   - 文件打开后未关闭
   - 建议: 使用 with 语句

4. **N+1 查询** (第 134 行)
   - 循环中执行数据库查询
   - 建议: 使用 JOIN 优化

### 🟡 一般 (4)
5. **命名不规范** (第 23 行)
6. **方法过长** (第 67-98 行)
7. **重复代码** (第 156 和 189 行)
8. **缺少类型提示** (第 12 行)

## 质量指标
- 圈复杂度: 平均 8.5 (可接受)
- 测试覆盖率: 65% (需提高)
- 重复代码: 12% (需改进)

## 改进建议
1. 【高】修复 SQL 注入漏洞
2. 【中】改进异常处理
3. 【中】修复资源泄漏
4. 【中】优化数据库查询
5. 【低】规范命名和格式
```

## 审查原则

### Code Review 黄金法则
1. **要友好** - 建设性反馈
2. **要具体** - 指出具体问题
3. **要教育** - 解释为什么
4. **要倾听** - 考虑不同观点
5. **要及时** - 快速反馈

### 审查重点
- 功能正确性
- 代码可读性
- 测试完整性
- 性能影响
- 安全风险

## 最佳实践

### DO（推荐）
✅ 使用自动化工具
✅ 关注关键逻辑
✅ 检查测试代码
✅ 提供建设性建议
✅ 记录审查结果

### DON'T（避免）
❌ 过于挑剔
❌ 忽视小问题
❌ 只看代码不运行
❌ 攻击性评论
❌ 延迟审查

## 工具集成

### Python
- pylint
- flake8
- mypy
- bandit (安全)
- radon (复杂度)

### JavaScript/TypeScript
- ESLint
- TSLint
- SonarJS
- JSHint

### 多语言
- SonarQube
- CodeClimate
- Codacy
- DeepSource

## 输出内容

审查报告包含：
1. 📊 **问题统计** - 按级别分类
2. 📝 **详细问题** - 位置、描述、建议
3. 💡 **修复建议** - 具体改进方案
4. 📈 **质量指标** - 复杂度、覆盖率等
5. ⚡ **优先级** - 按重要性排序
6. 🔍 **代码示例** - 问题和修复对比

