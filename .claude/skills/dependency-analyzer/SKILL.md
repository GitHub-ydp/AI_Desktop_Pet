---
name: dependency-analyzer
description: "项目依赖分析工具。检测过时依赖、安全漏洞、许可证问题、循环依赖。优化依赖树，减少包大小。支持多种包管理器。"
license: MIT
version: 1.0.0
---

# 依赖分析器

智能分析项目依赖关系，发现潜在问题，优化依赖管理。

## 功能特性

### 依赖检查
- 🔍 **过时依赖检测** - 找出需要更新的包
- 🔒 **安全漏洞扫描** - 识别已知安全问题
- 📜 **许可证分析** - 检查许可证兼容性
- 🔄 **循环依赖** - 发现模块间循环引用
- 📦 **未使用依赖** - 识别冗余包
- ⚖️ **包大小分析** - 评估依赖体积

### 优化建议
- ✅ 依赖更新策略
- ✅ 安全补丁应用
- ✅ 依赖树优化
- ✅ 版本冲突解决
- ✅ 替代方案推荐

## 支持的包管理器

### Python
- **pip** - requirements.txt
- **pipenv** - Pipfile
- **poetry** - pyproject.toml
- **conda** - environment.yml

### JavaScript/TypeScript
- **npm** - package.json
- **yarn** - yarn.lock
- **pnpm** - pnpm-lock.yaml

### 其他
- **Maven** - pom.xml (Java)
- **Gradle** - build.gradle (Java/Kotlin)
- **Cargo** - Cargo.toml (Rust)
- **Go Modules** - go.mod (Go)
- **Composer** - composer.json (PHP)

## 依赖问题类型

### 1. 安全漏洞

**严重性级别**:
```
🔴 Critical   - 立即修复
🟠 High       - 尽快修复
🟡 Medium     - 计划修复
🟢 Low        - 可选修复
```

**示例**:
```
package: lodash
version: 4.17.11
vulnerability: Prototype Pollution
severity: HIGH
fixed_in: 4.17.12
recommendation: 升级到 4.17.21 或更高版本
```

### 2. 过时依赖

**分类**:
```
Major Update   - 主版本更新（破坏性变更）
Minor Update   - 次版本更新（新功能）
Patch Update   - 补丁更新（bug修复）
```

**示例**:
```yaml
# requirements.txt
requests==2.25.1        # 过时 → 最新: 2.31.0
django==3.2.0          # 过时 → 最新: 4.2.0
numpy==1.19.5          # 过时 → 最新: 1.26.0
```

**更新建议**:
```python
# 安全更新（补丁）- 立即更新
requests==2.25.1 → 2.25.2  ✅ 推荐

# 次版本更新 - 测试后更新
django==3.2.0 → 3.2.23     ✅ 推荐

# 主版本更新 - 评估后更新
django==3.2.0 → 4.2.0      ⚠️ 需要迁移
```

### 3. 循环依赖

**检测**:
```
A → B → C → A  (循环依赖)

moduleA.py:
  from moduleB import function_b

moduleB.py:
  from moduleC import function_c

moduleC.py:
  from moduleA import function_a  ❌ 循环!
```

**解决方案**:
```python
# 方案 1: 延迟导入
def some_function():
    from moduleA import function_a  # 在函数内导入
    return function_a()

# 方案 2: 依赖反转
# 将共享功能提取到新模块

# 方案 3: 重构代码结构
# 重新组织模块，消除循环
```

### 4. 版本冲突

**问题**:
```
package-A requires: library==1.0.0
package-B requires: library==2.0.0
→ 冲突! 无法同时满足
```

**解决策略**:
```
1. 检查是否有兼容版本
   library>=1.0.0,<3.0.0

2. 更新依赖包
   升级 package-A 到支持 library 2.0

3. 使用虚拟环境隔离
   为不同部分使用不同依赖

4. Fork 修改依赖包
   最后的手段，维护成本高
```

### 5. 许可证问题

**常见许可证**:
```
✅ 友好许可证:
- MIT
- Apache 2.0
- BSD

⚠️ 限制性许可证:
- GPL (要求开源)
- AGPL (网络使用也要开源)

🔴 专有许可证:
- 商业许可
- 限制使用范围
```

**兼容性检查**:
```python
# 项目使用: MIT
# 依赖检查:
✅ requests (Apache 2.0)  - 兼容
✅ flask (BSD)            - 兼容
⚠️ mysql-connector (GPL)  - 可能有问题
```

### 6. 未使用依赖

**检测方法**:
```bash
# Python
pip-autoremove <package>
pipreqs . --force  # 根据实际导入生成requirements.txt

# JavaScript
npx depcheck
npm prune
```

**清理示例**:
```json
// package.json 中声明但未使用:
{
  "dependencies": {
    "axios": "^1.0.0",     // ✅ 使用中
    "lodash": "^4.17.21",  // ❌ 未使用
    "moment": "^2.29.4"    // ❌ 未使用
  }
}

// 推荐: 移除未使用的包
npm uninstall lodash moment
```

## 依赖优化策略

### 1. 减少依赖数量

**替换大型库**:
```javascript
// ❌ 不推荐 - 为一个函数引入整个库
import _ from 'lodash';
const result = _.chunk(array, 2);

// ✅ 推荐 - 使用原生方法
const chunk = (arr, size) => 
  Array.from({ length: Math.ceil(arr.length / size) }, 
    (v, i) => arr.slice(i * size, i * size + size));
```

**使用轻量级替代**:
```
moment.js (232 KB)     → day.js (2 KB)
lodash (72 KB)         → lodash-es (tree-shakeable)
axios (13 KB)          → native fetch API
```

### 2. Tree Shaking

**启用方式**:
```javascript
// ❌ 不推荐 - 导入整个库
import _ from 'lodash';

// ✅ 推荐 - 只导入需要的
import debounce from 'lodash/debounce';
import throttle from 'lodash/throttle';
```

### 3. Bundle 分析

**工具**:
```bash
# Webpack
npm install --save-dev webpack-bundle-analyzer

# Rollup
npm install --save-dev rollup-plugin-visualizer

# Next.js
npm run build -- --analyze
```

**优化目标**:
```
总包大小:    < 300 KB (gzip)
首次加载:    < 100 KB (gzip)
单个依赖:    < 50 KB (gzip)
```

### 4. 版本锁定

**package-lock.json / yarn.lock**:
```json
// 好处:
- 确保团队使用相同版本
- 防止意外更新
- 可重现的构建

// 最佳实践:
- 提交到版本控制
- CI/CD 使用 lockfile
- 定期更新依赖
```

## 使用方法

### 基础用法

**依赖分析**:
```
"分析项目依赖"
"检查安全漏洞"
"哪些依赖需要更新？"
```

**优化建议**:
```
"优化依赖树"
"减少包大小"
"找出未使用的依赖"
```

### 高级用法

**安全审计**:
```
"安全审计所有依赖"
"检查许可证兼容性"
```

**依赖升级**:
```
"生成依赖更新计划"
"Django 3.2 升级到 4.2 的影响"
```

## 分析报告

### 报告结构

```markdown
# 依赖分析报告

## 概览
- 总依赖数: 156
- 直接依赖: 23
- 间接依赖: 133
- 总大小: 45.2 MB

## 🔴 安全问题 (3)
1. lodash@4.17.11
   - Prototype Pollution (HIGH)
   - 修复版本: 4.17.21
   
2. axios@0.19.0
   - SSRF (MEDIUM)
   - 修复版本: 0.21.1

## 🟡 过时依赖 (12)
1. react@17.0.2 → 18.2.0 (Major)
2. express@4.17.1 → 4.18.2 (Minor)
3. lodash@4.17.20 → 4.17.21 (Patch)

## ⚠️ 许可证问题 (1)
1. mysql-connector
   - 许可证: GPL-2.0
   - 项目许可证: MIT
   - 建议: 使用 mysql2 (MIT)

## 📦 包大小分析
Top 5 最大依赖:
1. moment.js - 232 KB
2. lodash - 72 KB
3. jquery - 89 KB
4. chart.js - 156 KB
5. react-dom - 128 KB

## 💡 优化建议
1. 【高】修复安全漏洞
2. 【中】替换 moment.js 为 day.js
3. 【低】移除未使用的 jquery
4. 【低】更新 minor 版本依赖
```

## 自动化工具

### Python
```bash
# 安全检查
pip-audit
safety check

# 依赖更新
pip list --outdated
pip-review --auto

# 依赖树
pipdeptree
```

### JavaScript
```bash
# 安全检查
npm audit
yarn audit

# 依赖更新
npm outdated
npm update

# 未使用依赖
npx depcheck

# Bundle 分析
npx webpack-bundle-analyzer
```

## 最佳实践

### DO（推荐）
✅ 定期更新依赖（每月）
✅ 使用lockfile固定版本
✅ 监控安全漏洞
✅ 记录依赖变更
✅ 自动化依赖检查

### DON'T（避免）
❌ 盲目更新major版本
❌ 忽视安全警告
❌ 不测试就更新
❌ 添加不必要的依赖
❌ 混合包管理器

## CI/CD 集成

### GitHub Actions
```yaml
name: Dependency Check

on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Security Audit
        run: npm audit
      - name: Check Outdated
        run: npm outdated
```

### 定期检查
```yaml
name: Weekly Dependency Update

on:
  schedule:
    - cron: '0 0 * * 0'  # 每周日

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Check for Updates
        run: npm outdated
      - name: Create PR
        # 自动创建更新PR
```

## 输出内容

分析报告包含：
1. 📊 **依赖统计** - 数量、大小、层级
2. 🔒 **安全报告** - 漏洞列表和修复建议
3. 📋 **过时依赖** - 更新建议和优先级
4. ⚖️ **许可证分析** - 兼容性检查
5. 🔄 **循环依赖** - 依赖图和解决方案
6. 💡 **优化建议** - 具体改进措施

---

**依赖管理座右铭**:
> "好的依赖管理不是追求零依赖，而是保持依赖的精简、安全和可控。"

