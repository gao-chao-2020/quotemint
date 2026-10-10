# QuoteMint

> 面向自由职业者与小型工作室的报价单 SaaS：**发出报价 → 客户打开（你能看到）→ 在线签收**。
> Send quotes your clients actually sign.

一个可以直接部署上线的完整产品：营销页、注册登录、报价编辑器、客户签收页、订阅计费（Stripe）全部包含。

## 商业模式

| 版本 | 价格 | 包含 |
|---|---|---|
| Free | $0 | 每月 3 份报价、客户在线签收、打印/PDF、带 "Powered by QuoteMint" 标识 |
| Pro | $9/月 或 $90/年 | 无限报价、移除标识、自定义品牌（公司名/Logo 文字/主色）、查看动态分析 |

竞品对照：PandaDoc $19/人/月、Proposify $19–29/人/月、Bidsketch $15/月起——均为按坐席计费。QuoteMint 平价、不按人头、专注于"报价被签收"这一件事。

## 技术栈（刻意选择）

- **Node.js ≥ 22.5（本机 24.x），零外部运行时依赖**：`node:http` + `node:sqlite` + `node:crypto` + `node:test`。
- 前端为服务器端渲染 HTML + 原生 JS/CSS，无构建步骤、无 CDN 依赖、无 npm 安装。
- 单进程 + 单 SQLite 文件 = 可以在任何 $5/月 VPS 或免费容器平台上运行。

## 快速开始

```bash
cp .env.example .env        # Windows: copy .env.example .env
# 本地演示：在 .env 中设 DEMO_MODE=true
npm run seed                # 可选：写入演示数据（仅本地；生产环境会被脚本拒绝执行）
npm start                   # http://localhost:3000
```

演示账号（seed 后）：`demo@quotemint.dev / demo1234!`（Free 版）、`pro@quotemint.dev / demo1234!`（Pro 版）。

## 测试

```bash
npm run test:unit           # 单元测试（金额计算/认证/限额/Stripe 签名）
npm run test:integration    # 集成测试（真实起服务的端到端 API 流程）
npm test                    # 全部
```

## 部署（三种方式任选）

### 1. Docker（推荐 VPS）

```bash
docker build -t quotemint .
docker run -d --name quotemint -p 3000:3000 \
  -v quotemint-data:/data \
  -e BASE_URL=https://your-domain.com \
  -e DEMO_MODE=false \
  -e STRIPE_SECRET_KEY=sk_live_... \
  -e STRIPE_PRICE_ID=price_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  quotemint
```

数据持久化在 `/data` 卷。前置 Caddy/Nginx 处理 HTTPS 即可。

### 2. 任意支持 Node 的平台（Render / Railway / Fly.io）

- Build：无需构建命令；Start：`npm start`
- 环境变量同上；挂载持久磁盘到 `DATA_DIR`。

### 3. systemd（裸 VPS）

```ini
[Unit]
Description=QuoteMint
After=network.target
[Service]
WorkingDirectory=/opt/quotemint
ExecStart=/usr/bin/node --no-warnings src/server.js
EnvironmentFile=/opt/quotemint/.env
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `BASE_URL` | `http://localhost:3000` | 对外地址，用于生成客户链接与 Stripe 回调。**生产环境必须设为 https 真实域名**（否则 Cookie 不会带 Secure，启动时会打印警告） |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `DEMO_MODE` | `false` | `true` 时显示演示升级按钮并允许 seed；生产环境（`NODE_ENV=production`）下强制关闭，否则拒绝启动 |
| `TRUST_PROXY` | 空 | 反向代理（Caddy/Nginx）后面部署时设为 `1`，限流才会取用 `X-Forwarded-For` 真实客户端 IP |
| `STRIPE_SECRET_KEY` | — | Stripe 密钥；为空时计费功能自动禁用 |
| `STRIPE_PRICE_ID` | — | Pro 订阅价格 ID |
| `STRIPE_WEBHOOK_SECRET` | — | Webhook 签名密钥 |

## 开通收款（Stripe，15 分钟）

1. 注册 Stripe 账号 → Dashboard → 创建 Product "QuoteMint Pro"。
2. 添加两个 Price：$9/月（recurring monthly）、$90/年（recurring yearly）；把月付 Price ID 填入 `STRIPE_PRICE_ID`（年付可作为后续迭代）。
3. Developers → API keys → 复制 Secret key 到 `STRIPE_SECRET_KEY`。
4. Developers → Webhooks → Add endpoint：`https://your-domain.com/webhooks/stripe`，事件选 `checkout.session.completed` 和 `customer.subscription.deleted` → 复制签名密钥到 `STRIPE_WEBHOOK_SECRET`。
5. 测试卡 `4242 4242 4242 4242` 走一遍升级流程，验收后切 Live 密钥。

## 目录结构

```
src/
  server.js          # HTTP 服务器、路由、静态文件、安全头
  lib/               # db / auth / money / gating / quotes / stripe / http 工具
  routes/            # auth / quotes / public / billing / pages 路由
  templates/         # 服务器端渲染页面（landing/auth/dashboard/editor/billing/quote）
public/              # 静态资源（styles.css、各页面 JS、favicon）
test/                # unit + integration
scripts/seed.js      # 演示数据
marketing/           # 上线作战手册（渠道、文案、冷启动计划）
docs/
  API-CONTRACT.md    # 冻结的接口契约
  LAUNCH.md          # 上线检查清单
```

## 上线检查清单（精简版）

完整版见 [docs/LAUNCH.md](docs/LAUNCH.md)：

- [ ] 域名注册 + DNS 指向服务器，`BASE_URL` 改为 https 域名（Cookie 自动启用 Secure）
- [ ] `.env` 中 `DEMO_MODE=false`、`NODE_ENV=production`
- [ ] Stripe Live 密钥 + Webhook 配置完成，真实小额支付验证一次
- [ ] 备份策略：`DATA_DIR/app.db` 每日快照（SQLite 单文件拷贝即可）
- [ ] 按 marketing/LAUNCH.md 执行首发渠道计划

## 安全设计

- 密码 scrypt 加盐哈希；会话为数据库存储的 SHA-256 令牌；Cookie HttpOnly + SameSite=Lax + 生产环境 Secure。
- 所有 SQL 均为参数化查询；全部用户内容 HTML 转义（服务端 `esc()`、客户端 `textContent`）。
- 变更类请求校验 `X-Requested-With` + Origin；登录/注册与公开签收接口有 IP 限流。
- Stripe Webhook 使用 HMAC 签名校验（±5 分钟容差）。
- 演示升级接口仅在 `DEMO_MODE` 下存在，生产环境强制关闭。
