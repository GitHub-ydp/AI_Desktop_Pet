# AI Desktop Pet Server

独立的 Express 后端服务，负责：

- 手机号 + 验证码注册/登录
- JWT 鉴权与 refresh
- 套餐限流与每日用量统计
- 代理 DashScope `/chat/completions`
- 支持 SSE 流式透传

## 快速开始

```bash
cd server
npm install
copy .env.example .env
npm start
```

默认启动地址：`http://localhost:3000`

## 环境变量

- `PORT`: 服务端口，默认 `3000`
- `DB_PATH`: SQLite 文件路径，默认 `./data/app.db`
- `DASHSCOPE_API_KEY`: DashScope API Key
- `DASHSCOPE_BASE_URL`: 上游对话地址
- `JWT_SECRET`: Access Token 签名密钥
- `JWT_REFRESH_SECRET`: Refresh Token 签名密钥
- `JWT_EXPIRES_IN`: Access Token 有效期，默认 `7d`
- `JWT_REFRESH_EXPIRES_IN`: Refresh Token 有效期，默认 `30d`
- `VERIFICATION_CODE`: 开发期固定验证码，默认 `1234`

## API

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/chat/completions`
- `GET /api/v1/user/usage`
- `GET /api/v1/user/profile`

## 说明

- 开发期验证码固定为 `1234`
- Daily usage 按本地日期聚合
- `free` 套餐默认每日 30 次
