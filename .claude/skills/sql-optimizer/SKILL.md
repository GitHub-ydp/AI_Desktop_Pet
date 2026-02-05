---
name: sql-optimizer
description: "分析和优化 SQL 查询性能。检测慢查询、提供索引建议、重写低效查询、生成执行计划分析。支持 MySQL、PostgreSQL、SQL Server、Oracle 等主流数据库。"
license: MIT
version: 1.0.0
---

# SQL 查询优化器

智能分析和优化 SQL 查询，提升数据库性能。

## 功能特性

### 查询分析
- 🔍 **性能瓶颈检测** - 识别慢查询和性能问题
- 📊 **执行计划分析** - 解读 EXPLAIN 结果
- ⚡ **查询重写** - 自动优化查询语句
- 🎯 **索引建议** - 推荐最佳索引策略

### 优化建议
- ✅ JOIN 优化（选择合适的 JOIN 类型）
- ✅ 子查询优化（转换为 JOIN）
- ✅ WHERE 条件优化（索引利用）
- ✅ GROUP BY 和 ORDER BY 优化
- ✅ DISTINCT 和 UNION 优化
- ✅ 临时表和派生表优化

### 支持的数据库
- MySQL / MariaDB
- PostgreSQL
- SQL Server
- Oracle
- SQLite

## 使用方法

### 基础用法

**分析查询**：
```
"分析这个 SQL 查询的性能"
"这个查询为什么这么慢？"
"帮我优化这个 SELECT 语句"
```

**获取建议**：
```
"应该给这个表加什么索引？"
"如何改进这个 JOIN 查询？"
"这个子查询可以优化吗？"
```

### 高级用法

**执行计划分析**：
```
"解释这个 EXPLAIN 结果"
"分析执行计划中的性能问题"
```

**查询重写**：
```
"重写这个查询以提高性能"
"将这个子查询转换为 JOIN"
```

## 优化策略

### 1. 索引优化

**何时创建索引**：
- WHERE 子句中的列
- JOIN 条件中的列
- ORDER BY 和 GROUP BY 的列
- 频繁查询的列

**索引类型选择**：
- **B-Tree 索引** - 范围查询、排序
- **Hash 索引** - 等值查询
- **全文索引** - 文本搜索
- **复合索引** - 多列查询

### 2. JOIN 优化

**优化技巧**：
```sql
-- ❌ 避免：笛卡尔积
SELECT * FROM t1, t2 WHERE t1.id > 100;

-- ✅ 推荐：明确 JOIN 条件
SELECT * FROM t1 
INNER JOIN t2 ON t1.id = t2.t1_id 
WHERE t1.id > 100;
```

**JOIN 顺序**：
- 小表驱动大表
- 过滤条件前置
- 合理使用 JOIN 类型

### 3. WHERE 条件优化

**索引失效场景**：
```sql
-- ❌ 函数操作导致索引失效
WHERE YEAR(create_time) = 2024

-- ✅ 改写为范围查询
WHERE create_time >= '2024-01-01' 
  AND create_time < '2025-01-01'

-- ❌ 隐式类型转换
WHERE user_id = '123'  -- user_id 是 INT

-- ✅ 使用正确类型
WHERE user_id = 123
```

### 4. 子查询优化

**转换为 JOIN**：
```sql
-- ❌ 子查询（可能慢）
SELECT * FROM orders 
WHERE user_id IN (
    SELECT id FROM users WHERE city = 'Beijing'
);

-- ✅ JOIN（通常更快）
SELECT o.* FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE u.city = 'Beijing';
```

### 5. 分页优化

**深度分页优化**：
```sql
-- ❌ 深度分页慢
SELECT * FROM products 
ORDER BY id 
LIMIT 100000, 20;

-- ✅ 使用主键范围
SELECT * FROM products 
WHERE id > 100000 
ORDER BY id 
LIMIT 20;
```

## 常见问题诊断

### 慢查询原因
1. **缺少索引** - 全表扫描
2. **索引失效** - 函数、类型转换
3. **数据量大** - 需要分页或限制
4. **JOIN 太多** - 表关联过多
5. **锁等待** - 并发冲突
6. **统计信息过期** - 执行计划不准确

### 性能指标

**关注指标**：
- 扫描行数 (rows examined)
- 返回行数 (rows returned)
- 查询时间 (execution time)
- 索引使用情况 (key used)
- JOIN 类型 (join type)

**理想比例**：
```
扫描行数 ≈ 返回行数  （索引精准）
扫描行数 >> 返回行数  （需要优化）
```

## 分析流程

1. **收集查询信息**
   - SQL 语句
   - 表结构和索引
   - 数据量统计

2. **执行计划分析**
   - 查看 EXPLAIN 结果
   - 识别性能瓶颈
   - 评估索引使用

3. **提供优化建议**
   - 索引优化方案
   - 查询重写建议
   - 表结构调整建议

4. **验证优化效果**
   - 对比优化前后性能
   - 确认执行计划改进

## 工具命令

### MySQL
```sql
-- 查看慢查询
SHOW FULL PROCESSLIST;

-- 分析查询
EXPLAIN SELECT ...;
EXPLAIN FORMAT=JSON SELECT ...;

-- 查看索引使用情况
SHOW INDEX FROM table_name;

-- 分析表
ANALYZE TABLE table_name;
```

### PostgreSQL
```sql
-- 分析查询
EXPLAIN ANALYZE SELECT ...;

-- 查看执行计划
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;

-- 查看索引
\d table_name

-- 更新统计信息
ANALYZE table_name;
```

## 最佳实践

### DO（推荐做法）
✅ 为 WHERE、JOIN 条件列创建索引
✅ 使用 LIMIT 限制返回行数
✅ 避免 SELECT *，只选择需要的列
✅ 使用合适的数据类型
✅ 定期更新统计信息
✅ 监控慢查询日志

### DON'T（避免做法）
❌ 在索引列上使用函数
❌ 使用 LIKE '%xxx%'
❌ 使用 NOT IN、<>
❌ JOIN 太多表（>5个）
❌ 在大表上使用 DISTINCT
❌ 频繁使用子查询

## 性能基准

### 查询响应时间目标
- **极快** - < 10ms
- **快** - 10-100ms
- **可接受** - 100ms-1s
- **慢** - 1-10s
- **非常慢** - > 10s（需要优化）

## 输出内容

分析报告包含：
1. 📊 性能评估
2. 🔍 问题诊断
3. 💡 优化建议
4. 📝 重写后的查询（如适用）
5. 🎯 索引建议（具体的 CREATE INDEX 语句）
6. ⚡ 预期性能提升

