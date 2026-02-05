---
name: code-refactoring
description: "智能代码重构助手。识别代码坏味道、提供重构建议、自动重构代码。支持提取方法、重命名、消除重复代码、简化复杂逻辑等多种重构模式。适用于提升代码质量和可维护性。"
license: MIT
version: 1.0.0
---

# 代码重构助手

智能识别代码问题并提供专业的重构建议和自动重构方案。

## 功能特性

### 代码坏味道检测
- 🔍 **长方法** (Long Method) - 方法过长，难以理解
- 🔍 **大类** (Large Class) - 类承担过多职责
- 🔍 **重复代码** (Duplicated Code) - 相同或相似的代码片段
- 🔍 **过长参数列表** (Long Parameter List) - 参数过多
- 🔍 **发散式变化** (Divergent Change) - 一个类频繁被修改
- 🔍 **霰弹式修改** (Shotgun Surgery) - 一处改动需要修改多处
- 🔍 **特性依恋** (Feature Envy) - 方法过度依赖其他类
- 🔍 **数据泥团** (Data Clumps) - 总是一起出现的数据
- 🔍 **基本类型偏执** (Primitive Obsession) - 过度使用基本类型
- 🔍 **switch 语句** (Switch Statements) - 复杂的条件分支
- 🔍 **冗余类** (Lazy Class) - 几乎不做事的类
- 🔍 **纯数据类** (Data Class) - 只有数据没有行为
- 🔍 **被拒绝的遗赠** (Refused Bequest) - 子类不需要父类的方法
- 🔍 **注释** (Comments) - 过多注释通常意味着代码不够清晰

### 重构模式

#### 1. 提取方法 (Extract Method)
将代码片段提取为独立方法
```python
# Before
def calculate_total_price(items):
    total = 0
    for item in items:
        total += item['price'] * item['quantity']
        if item['quantity'] > 10:
            total *= 0.9  # 10% discount
    return total

# After
def calculate_total_price(items):
    total = sum(calculate_item_price(item) for item in items)
    return total

def calculate_item_price(item):
    price = item['price'] * item['quantity']
    return apply_bulk_discount(price, item['quantity'])

def apply_bulk_discount(price, quantity):
    return price * 0.9 if quantity > 10 else price
```

#### 2. 内联方法 (Inline Method)
将简单方法内联到调用处
```python
# Before
def get_rating(driver):
    return more_than_five_late_deliveries(driver) ? 2 : 1

def more_than_five_late_deliveries(driver):
    return driver.late_deliveries > 5

# After
def get_rating(driver):
    return 2 if driver.late_deliveries > 5 else 1
```

#### 3. 提取变量 (Extract Variable)
将复杂表达式提取为有意义的变量
```python
# Before
if (platform.upper() == "MAC" and browser.upper() == "IE" 
    and was_initialized() and resize > 0):
    # do something

# After
is_mac_ie = platform.upper() == "MAC" and browser.upper() == "IE"
was_resized = was_initialized() and resize > 0
if is_mac_ie and was_resized:
    # do something
```

#### 4. 重命名 (Rename)
为变量、方法、类使用更有意义的名称
```python
# Before
def calc(a, b, c):
    return (a * b) + c

# After
def calculate_total_with_tax(price, quantity, tax_rate):
    return (price * quantity) * (1 + tax_rate)
```

#### 5. 移动方法 (Move Method)
将方法移动到更合适的类中
```python
# Before
class Account:
    def overdraft_charge(self):
        if self.type.is_premium():
            return 10
        else:
            return 20

# After
class AccountType:
    def overdraft_charge(self):
        if self.is_premium():
            return 10
        else:
            return 20

class Account:
    def overdraft_charge(self):
        return self.type.overdraft_charge()
```

#### 6. 提取类 (Extract Class)
将大类拆分为多个职责单一的小类
```python
# Before
class Person:
    def __init__(self, name, office_code, office_number):
        self.name = name
        self.office_code = office_code
        self.office_number = office_number
    
    def get_telephone_number(self):
        return f"{self.office_code}-{self.office_number}"

# After
class TelephoneNumber:
    def __init__(self, area_code, number):
        self.area_code = area_code
        self.number = number
    
    def get_telephone_number(self):
        return f"{self.area_code}-{self.number}"

class Person:
    def __init__(self, name, telephone):
        self.name = name
        self.telephone = telephone  # TelephoneNumber object
```

#### 7. 引入参数对象 (Introduce Parameter Object)
将多个参数封装为对象
```python
# Before
def amount_invoiced(start_date, end_date):
    pass

def amount_received(start_date, end_date):
    pass

# After
class DateRange:
    def __init__(self, start, end):
        self.start = start
        self.end = end

def amount_invoiced(date_range):
    pass

def amount_received(date_range):
    pass
```

#### 8. 替换算法 (Substitute Algorithm)
用更清晰的算法替换复杂算法
```python
# Before
def found_person(people):
    for person in people:
        if person == "Don":
            return "Don"
        if person == "John":
            return "John"
        if person == "Kent":
            return "Kent"
    return ""

# After
def found_person(people):
    candidates = ["Don", "John", "Kent"]
    for person in people:
        if person in candidates:
            return person
    return ""
```

#### 9. 以多态替换条件表达式 (Replace Conditional with Polymorphism)
```python
# Before
class Bird:
    def get_speed(self):
        if self.type == "EUROPEAN":
            return self.base_speed
        elif self.type == "AFRICAN":
            return self.base_speed - self.load_factor
        elif self.type == "NORWEGIAN_BLUE":
            return 0 if self.is_nailed else self.base_speed * self.voltage

# After
class Bird:
    def get_speed(self):
        return self.base_speed

class EuropeanBird(Bird):
    pass

class AfricanBird(Bird):
    def get_speed(self):
        return self.base_speed - self.load_factor

class NorwegianBlueBird(Bird):
    def get_speed(self):
        return 0 if self.is_nailed else self.base_speed * self.voltage
```

## 使用方法

### 基础用法

**请求重构建议**：
```
"分析这段代码，提供重构建议"
"这个方法太长了，帮我重构"
"检测代码坏味道"
```

**具体重构操作**：
```
"提取这段代码为一个独立方法"
"重命名这个变量为更有意义的名称"
"消除这些重复代码"
"简化这个复杂的 if-else 逻辑"
```

### 高级用法

**全项目重构**：
```
"分析整个项目，找出需要重构的地方"
"生成项目重构计划"
```

**特定模式重构**：
```
"将这个大类拆分为多个小类"
"用多态替换这些 switch 语句"
"将这些参数封装为对象"
```

## 重构原则

### SOLID 原则
1. **单一职责原则** (Single Responsibility Principle)
   - 一个类只负责一件事

2. **开闭原则** (Open/Closed Principle)
   - 对扩展开放，对修改关闭

3. **里氏替换原则** (Liskov Substitution Principle)
   - 子类可以替换父类

4. **接口隔离原则** (Interface Segregation Principle)
   - 客户端不应依赖它不需要的接口

5. **依赖倒置原则** (Dependency Inversion Principle)
   - 依赖抽象而不是具体实现

### 代码质量指标

**圈复杂度** (Cyclomatic Complexity)
- 1-10: 简单，低风险
- 11-20: 中等复杂
- 21-50: 复杂，高风险
- >50: 非常复杂，需要重构

**方法长度**
- <20 行: 理想
- 20-50 行: 可接受
- >50 行: 考虑拆分

**类长度**
- <200 行: 理想
- 200-500 行: 可接受
- >500 行: 考虑拆分

## 重构流程

```
1. 识别问题
   ↓
   - 代码坏味道检测
   - 质量指标分析
   - 手动审查

2. 制定计划
   ↓
   - 确定重构目标
   - 选择重构模式
   - 评估风险和收益

3. 编写测试
   ↓
   - 确保有足够的测试覆盖
   - 为重构部分添加单元测试

4. 小步重构
   ↓
   - 每次只做一个小改动
   - 频繁运行测试
   - 保持代码可运行状态

5. 验证结果
   ↓
   - 运行所有测试
   - 代码审查
   - 性能测试（如需要）

6. 提交代码
   ↓
   - 清晰的提交信息
   - 说明重构目的和变更
```

## 最佳实践

### DO（推荐）
✅ 重构前先写测试
✅ 小步重构，频繁测试
✅ 使用有意义的命名
✅ 保持方法简短
✅ 遵循 SOLID 原则
✅ 提交前进行代码审查

### DON'T（避免）
❌ 没有测试就重构
❌ 同时重构和添加功能
❌ 过度重构
❌ 改变外部行为
❌ 重构遗留代码时不小心
❌ 忽视性能影响

## 工具和技术

### Python 工具
- **pylint** - 代码静态分析
- **radon** - 圈复杂度计算
- **rope** - 自动重构工具
- **black** - 代码格式化

### JavaScript/TypeScript 工具
- **ESLint** - 代码检查
- **Prettier** - 代码格式化
- **TSLint** - TypeScript 检查

### 通用工具
- **SonarQube** - 代码质量平台
- **Code Climate** - 代码分析
- **Codacy** - 自动代码审查

## 输出内容

重构分析报告包含：
1. 🔍 **代码坏味道清单** - 发现的问题列表
2. 📊 **质量指标** - 复杂度、方法长度等
3. 💡 **重构建议** - 具体的改进方案
4. 📝 **重构代码** - 改进后的代码示例
5. ⚠️ **风险评估** - 重构可能的影响
6. ✅ **验证方案** - 如何验证重构效果

## 常见重构场景

1. **方法过长** → 提取方法
2. **重复代码** → 提取方法/提取类
3. **复杂条件** → 提取方法/策略模式
4. **大类** → 提取类/提取接口
5. **长参数列表** → 引入参数对象
6. **数据泥团** → 提取类
7. **过度使用基本类型** → 引入值对象
8. **Switch 语句** → 多态/策略模式

## 支持的语言

- Python
- JavaScript/TypeScript
- Java
- C#
- Go
- Ruby
- PHP
- C/C++

---

**重构座右铭**: 
> "任何傻瓜都能写出计算机能理解的代码。好的程序员能写出人能理解的代码。" 
> — Martin Fowler

