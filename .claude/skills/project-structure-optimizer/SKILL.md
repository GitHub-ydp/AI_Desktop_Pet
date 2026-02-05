---
name: project-structure-optimizer
description: "项目结构分析和优化工具。评估项目组织结构、提供最佳实践建议、生成标准化项目模板。支持多种项目类型和技术栈。"
license: MIT
version: 1.0.0
---

# 项目结构优化器

分析和优化项目目录结构，提升项目可维护性和团队协作效率。

## 功能特性

### 结构分析
- 📁 **目录结构评估** - 分析当前组织方式
- 🔍 **命名规范检查** - 检查文件和目录命名
- 📊 **复杂度分析** - 评估项目复杂度
- ⚠️ **问题识别** - 发现结构问题

### 优化建议
- ✅ 标准化目录结构
- ✅ 合理的模块划分
- ✅ 清晰的层次关系
- ✅ 配置文件组织
- ✅ 文档和测试布局

## 标准项目结构

### Python 项目

#### Web 应用 (Flask/Django/FastAPI)
```
project_name/
├── README.md              # 项目说明
├── requirements.txt       # 依赖列表
├── .env.example          # 环境变量示例
├── .gitignore            # Git 忽略文件
├── setup.py              # 安装配置
├── pyproject.toml        # 项目配置
│
├── app/                  # 应用代码
│   ├── __init__.py
│   ├── main.py          # 入口文件
│   ├── config.py        # 配置
│   │
│   ├── models/          # 数据模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   └── product.py
│   │
│   ├── views/           # 视图/路由
│   │   ├── __init__.py
│   │   ├── api/        # API 端点
│   │   └── web/        # Web 页面
│   │
│   ├── services/        # 业务逻辑
│   │   ├── __init__.py
│   │   ├── user_service.py
│   │   └── payment_service.py
│   │
│   ├── utils/           # 工具函数
│   │   ├── __init__.py
│   │   ├── validators.py
│   │   └── helpers.py
│   │
│   ├── static/          # 静态文件
│   │   ├── css/
│   │   ├── js/
│   │   └── images/
│   │
│   └── templates/       # 模板文件
│       ├── base.html
│       └── index.html
│
├── tests/               # 测试文件
│   ├── __init__.py
│   ├── conftest.py     # pytest 配置
│   ├── unit/           # 单元测试
│   ├── integration/    # 集成测试
│   └── e2e/            # 端到端测试
│
├── docs/                # 文档
│   ├── api.md
│   ├── setup.md
│   └── architecture.md
│
├── scripts/             # 脚本工具
│   ├── deploy.sh
│   └── migrate.py
│
└── migrations/          # 数据库迁移
    └── versions/
```

#### 数据科学项目
```
project_name/
├── README.md
├── requirements.txt
├── setup.py
│
├── data/               # 数据文件
│   ├── raw/           # 原始数据
│   ├── processed/     # 处理后数据
│   └── external/      # 外部数据
│
├── notebooks/          # Jupyter notebooks
│   ├── 01_exploration.ipynb
│   ├── 02_preprocessing.ipynb
│   └── 03_modeling.ipynb
│
├── src/                # 源代码
│   ├── __init__.py
│   ├── data/          # 数据处理
│   ├── features/      # 特征工程
│   ├── models/        # 模型定义
│   └── visualization/ # 可视化
│
├── models/             # 训练好的模型
│   └── model_v1.pkl
│
├── reports/            # 分析报告
│   ├── figures/       # 图表
│   └── final_report.pdf
│
└── tests/
```

### JavaScript/TypeScript 项目

#### React 应用
```
project-name/
├── README.md
├── package.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
│
├── public/             # 公共资源
│   ├── index.html
│   └── favicon.ico
│
├── src/                # 源代码
│   ├── index.tsx      # 入口文件
│   ├── App.tsx        # 根组件
│   │
│   ├── components/    # 组件
│   │   ├── common/   # 通用组件
│   │   │   ├── Button/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Button.test.tsx
│   │   │   │   └── Button.module.css
│   │   │   └── Input/
│   │   │
│   │   └── features/ # 功能组件
│   │       ├── Auth/
│   │       └── Dashboard/
│   │
│   ├── hooks/         # 自定义 Hooks
│   │   ├── useAuth.ts
│   │   └── useFetch.ts
│   │
│   ├── pages/         # 页面组件
│   │   ├── Home/
│   │   ├── About/
│   │   └── NotFound/
│   │
│   ├── services/      # API 服务
│   │   ├── api.ts
│   │   └── auth.ts
│   │
│   ├── store/         # 状态管理
│   │   ├── index.ts
│   │   ├── slices/
│   │   └── actions/
│   │
│   ├── utils/         # 工具函数
│   │   ├── helpers.ts
│   │   └── constants.ts
│   │
│   ├── types/         # TypeScript 类型
│   │   └── index.ts
│   │
│   └── styles/        # 全局样式
│       ├── global.css
│       └── variables.css
│
├── tests/             # 测试
│   ├── unit/
│   ├── integration/
│   └── setup.ts
│
└── docs/              # 文档
```

#### Node.js 后端
```
project-name/
├── README.md
├── package.json
├── tsconfig.json
│
├── src/
│   ├── index.ts       # 入口
│   ├── app.ts         # Express 应用
│   │
│   ├── config/        # 配置
│   │   ├── database.ts
│   │   └── environment.ts
│   │
│   ├── controllers/   # 控制器
│   │   ├── userController.ts
│   │   └── productController.ts
│   │
│   ├── models/        # 数据模型
│   │   ├── User.ts
│   │   └── Product.ts
│   │
│   ├── routes/        # 路由
│   │   ├── index.ts
│   │   ├── userRoutes.ts
│   │   └── productRoutes.ts
│   │
│   ├── services/      # 业务逻辑
│   │   ├── userService.ts
│   │   └── emailService.ts
│   │
│   ├── middlewares/   # 中间件
│   │   ├── auth.ts
│   │   ├── error.ts
│   │   └── validation.ts
│   │
│   ├── utils/         # 工具
│   │   ├── logger.ts
│   │   └── helpers.ts
│   │
│   └── types/         # 类型定义
│       └── index.ts
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── dist/              # 编译输出
```

## 组织原则

### 1. 按功能组织 (Feature-based)
**适用**: 大型应用，功能独立
```
src/
├── users/
│   ├── user.controller.ts
│   ├── user.service.ts
│   ├── user.model.ts
│   └── user.routes.ts
│
└── products/
    ├── product.controller.ts
    ├── product.service.ts
    ├── product.model.ts
    └── product.routes.ts
```

**优点**:
- 功能内聚
- 易于维护
- 清晰的边界

### 2. 按层次组织 (Layer-based)
**适用**: 小型应用，层次清晰
```
src/
├── controllers/
│   ├── user.controller.ts
│   └── product.controller.ts
│
├── services/
│   ├── user.service.ts
│   └── product.service.ts
│
└── models/
    ├── user.model.ts
    └── product.model.ts
```

**优点**:
- 结构简单
- 易于理解
- 适合小项目

### 3. 混合组织
**适用**: 复杂应用
```
src/
├── core/              # 核心功能（按层）
│   ├── config/
│   ├── database/
│   └── middleware/
│
├── shared/            # 共享代码（按层）
│   ├── utils/
│   ├── types/
│   └── constants/
│
└── features/          # 业务功能（按功能）
    ├── auth/
    ├── users/
    └── products/
```

## 优化建议

### 问题识别

#### 🔴 严重问题
1. **循环依赖** - 模块相互依赖
2. **巨型文件** - 单文件超过 500 行
3. **过深嵌套** - 目录层级超过 5 层
4. **混乱命名** - 命名不一致

#### 🟡 一般问题
1. **缺少测试目录**
2. **配置文件散乱**
3. **文档不完整**
4. **没有示例**

### 改进方案

#### 目录命名规范
```
✅ 推荐:
- 小写字母
- 下划线分隔 (Python)
- 短横线分隔 (JS/TS)
- 复数形式表示集合

❌ 避免:
- 大写字母
- 驼峰命名
- 特殊字符
```

#### 文件命名规范
```
✅ 推荐:
- 描述性名称
- 一致的后缀
- user_service.py
- UserService.ts
- user.test.js

❌ 避免:
- temp.py
- test1.js
- new_file_copy.py
```

## 最佳实践

### DO（推荐）
✅ 分离关注点
✅ 保持扁平结构
✅ 使用配置文件
✅ 文档和代码同步
✅ 版本控制所有配置

### DON'T（避免）
❌ 过度嵌套
❌ 混合不同类型文件
❌ 硬编码配置
❌ 忽略测试组织
❌ 没有 README

## 配置文件组织

### 开发环境配置
```
.env.development
.env.production
.env.test
config/
├── development.json
├── production.json
└── test.json
```

### 构建配置
```
webpack.config.js
babel.config.js
tsconfig.json
.eslintrc.js
.prettierrc
jest.config.js
```

## 使用方法

### 基础用法

**分析项目**:
```
"分析这个项目的结构"
"评估目录组织"
"项目结构有什么问题？"
```

**优化建议**:
```
"如何优化项目结构"
"重组这个项目"
"建议最佳的目录结构"
```

### 高级用法

**生成模板**:
```
"生成 React 项目结构"
"创建 Flask 应用模板"
"Django REST API 标准结构"
```

**迁移重构**:
```
"将项目从按层组织改为按功能组织"
"合并这些目录"
```

## 输出内容

分析报告包含：
1. 📊 **当前结构** - 目录树和统计
2. ⚠️ **发现的问题** - 问题列表和严重程度
3. 💡 **优化建议** - 具体改进方案
4. 📁 **推荐结构** - 标准化目录树
5. 🔄 **迁移步骤** - 重构指导
6. 📋 **清单** - 需要添加的文件

---

**结构优化座右铭**:
> "好的项目结构就像一本好书的目录，让人一眼就能找到想要的内容。"

