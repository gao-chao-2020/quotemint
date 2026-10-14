# QuoteMint

> [English](README.en.md) | 中文

> 面向自由职业者与小型工作室的报价单 SaaS：**发出报价 → 客户打开（你能看到）→ 在线签收**。
> Send quotes your clients actually sign.

一个已经上线运行的完整产品：营销页、注册登录、报价编辑器、客户签收页、订阅计费（Creem/Stripe 适配器 + 支付宝收款码）全部包含。

## 当前线上（2026-10-14）

- **生产地址**：https://quotemint.dpdns.org （品牌域名；备用 https://quotemint.netlify.app ）
- **架构**：Netlify 免费版（Functions 适配层 `src/lib/serverless-adapter.js`）+ Neon Postgres（免费版）+ DigitalPlat 免费域名 dpdns.org —— 零固定成本；全部账号凭证与生产状态见本地 `账号信息.md`（不入 git）
- **收款**：中国客户支付宝收款码 ¥68/年（账单页扫码付款 → 邮件 support@ → 运营者运行 `npm run grant <邮箱> 12` 开通）；海外 $9/月走 Creem/Stripe（适配器就绪、默认休眠，待申请商户后启用）
- **客服邮箱**：support@quotemint.dpdns.org（腾讯企业微信邮箱；收到的邮件自动转发到运营者QQ邮箱）
- **本地开发**：`npm start`（.env 设 `DEMO_MODE=true` 后 `npm run seed` 生成演示账号）；测试 `npm test`（150 项）

> 服务器路线（Docker / systemd / Cloudflare 隧道）的操作手册保留在 `deploy/`，作为将来迁移时的存档参考。

## 文档导航（中文 / English 对照）

| 文档 | 中文 | English |
|---|---|---|
| 项目说明 | README.md（本页） | [README.en.md](README.en.md) |
| 网站架构说明 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) |
| 平台清单（逐一说明） | [docs/PLATFORMS.md](docs/PLATFORMS.md) | [docs/PLATFORMS.en.md](docs/PLATFORMS.en.md) |
| 运营操作手册（非技术向） | [docs/OPERATIONS.md](docs/OPERATIONS.md) | [docs/OPERATIONS.en.md](docs/OPERATIONS.en.md) |
| 建站经验与技能手册 | [docs/PLAYBOOK.md](docs/PLAYBOOK.md) | [docs/PLAYBOOK.en.md](docs/PLAYBOOK.en.md) |
| 上线/运维检查清单 | [docs/LAUNCH.md](docs/LAUNCH.md) | [docs/LAUNCH.en.md](docs/LAUNCH.en.md) |
| 接口契约（冻结） | [docs/API-CONTRACT.zh-CN.md](docs/API-CONTRACT.zh-CN.md) | [docs/API-CONTRACT.md](docs/API-CONTRACT.md) |
| 上市与增长手册 | [marketing/LAUNCH.zh-CN.md](marketing/LAUNCH.zh-CN.md) | [marketing/LAUNCH.md](marketing/LAUNCH.md) |
| 冷启动外联模板 | [marketing/OUTREACH.zh-CN.md](marketing/OUTREACH.zh-CN.md) | [marketing/OUTREACH.md](marketing/OUTREACH.md) |
| 服务器路线存档 | [deploy/CLOUDFLARE-TUNNEL.zh-CN.md](deploy/CLOUDFLARE-TUNNEL.zh-CN.md) | [deploy/CLOUDFLARE-TUNNEL.md](deploy/CLOUDFLARE-TUNNEL.md) |

## 商业模式

| 版本 | 价格 | 包含 |
|---|---|---|
| Free | $0 | 每月 3 份报价、客户在线签收、打印/PDF、带 "Powered by QuoteMint" 标识 |
| Pro | $9/月 或 $90/年 | 无限报价、移除标识、自定义品牌（公司名/Logo 文字/主色）、完整打开动态（每次打开均记录，编辑器内置时间线面板） |

竞品对照：PandaDoc $19/人/月、Proposify $19–29/人/月、Bidsketch $15/月起——均为按坐席计费。QuoteMint 平价、不按人头、专注于"报价被签收"这一件事。

## 技术栈（刻意选择）

- **Node.js ≥ 22.5（本机 24.x），近乎零依赖**：核心全部使用内置模块（`node:http` + `node:sqlite` + `node:crypto` + `node:test`）；唯一的包依赖（`pg`）仅在生产 Postgres 路径需要。
- 前端为服务器端渲染 HTML + 原生 JS/CSS，无构建步骤、无 CDN 依赖。
- 单进程 + 单数据库（本地 SQLite；生产经 `DATABASE_URL` 切到 Postgres）= 可以在任何 $5/月 VPS 或免费容器平台上运行。

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
| `BASE_URL` | `http://localhost:3000` | 对外地址，用于生成客户链接与支付回调。**生产环境必须设为 https 真实域名**（生产环境 Cookie 恒带 Secure） |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `DATABASE_URL` | 空 | 留空使用本地 SQLite；填 Postgres 连接串切换为云端数据库（生产为 Neon） |
| `DEMO_MODE` | `false` | `true` 时显示演示升级按钮并允许 seed；生产环境（`NODE_ENV=production`）下强制关闭，否则拒绝启动 |
| `TRUST_PROXY` | 空 | 反向代理（Caddy/Nginx）后面部署时设为 `1`，限流才会取用 `X-Forwarded-For` 真实客户端 IP |
| `CREEM_API_KEY` | — | Creem 密钥；设置后计费走 Creem（优先） |
| `CREEM_PRODUCT_ID` | — | Creem Pro 订阅产品 ID |
| `CREEM_WEBHOOK_SECRET` | — | Creem Webhook 签名密钥 |
| `CREEM_API_BASE` | 官方地址 | 仅测试用：将 Creem API 指向本地模拟服务 |
| `STRIPE_SECRET_KEY` | — | Stripe 密钥；无 Creem 时生效 |
| `STRIPE_PRICE_ID` | — | Stripe Pro 订阅价格 ID |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe Webhook 签名密钥 |

## 开通收款（Creem 为主，Stripe 可选）

计费提供商按环境变量自动选择：设了 `CREEM_API_KEY` 用 Creem → 否则设了 Stripe 密钥用 Stripe → 都没有则计费关闭。

**Creem（推荐，个人可注册、支持订阅、可提现至支付宝/Wise 中转）**：
1. 在 creem.io 用邮箱注册并完成身份验证（个人身份证件即可）。
2. Dashboard 创建 Product "QuoteMint Pro"（订阅制），复制 Product ID 到 `CREEM_PRODUCT_ID`。
3. 创建 API Key（`creem_...`）到 `CREEM_API_KEY`。
4. Webhooks → Add endpoint `https://<域名>/webhooks/creem`，事件至少含 checkout 完成与订阅取消/过期类 → 复制签名密钥到 `CREEM_WEBHOOK_SECRET`。
5. 用 Creem 测试模式走一遍升级 → 验收后切正式。

> Creem 商户审核要求网站已上线且含隐私政策、服务条款与可联系的客服邮箱——本站已内置 `/privacy`、`/terms` 与 `support@` 联系位，直接提交域名即可。

**Stripe（有海外主体时可选）**：创建 Product + 月付 Price → `STRIPE_PRICE_ID`；Webhook 指向 `/webhooks/stripe`（事件 `checkout.session.completed`、`customer.subscription.deleted`）→ 测试卡 `4242 4242 4242 4242` 验收。

## 目录结构

```
src/
  server.js          # HTTP 服务器、路由、静态文件、安全头
  lib/               # db / auth / money / gating / quotes / stripe / creem / http 工具
  routes/            # auth / quotes / public / billing / pages 路由
  templates/         # 服务器端渲染页面（landing/auth/dashboard/editor/billing/quote）
  lib/serverless-adapter.js  # 生产所用 Netlify Functions（Lambda）适配层
public/              # 静态资源（styles.css、各页面 JS、favicon）
netlify/functions/   # Netlify Functions 入口（适配层的薄包装）
netlify.toml         # Netlify 构建/重定向配置
test/                # unit + integration
scripts/seed.js      # 演示数据
scripts/grant.js     # 人工开通 Pro（支付宝收款后运行）
marketing/           # 上线作战手册（渠道、文案、冷启动计划）
docs/
  API-CONTRACT.md    # 冻结的接口契约
  LAUNCH.md          # 上线检查清单
  ARCHITECTURE.md    # 网站架构说明
  PLATFORMS.md       # 平台清单（逐一说明）
  PLAYBOOK.md        # 零成本建站经验与技能手册
  OPERATIONS.md      # 运营操作说明（非技术向）
```

## 上线检查清单（精简版）

完整版见 [docs/LAUNCH.md](docs/LAUNCH.md)：

- [x] 域名已上线 + DNS 已配置，`BASE_URL` 为 https 域名（生产环境 Cookie 恒带 Secure）
- [x] `.env`/平台：`DEMO_MODE=false`、`NODE_ENV=production`
- [x] 收款：支付宝收款码已上线（¥68/年，人工开通）；Creem/Stripe 待商户申请后启用
- [ ] 备份：数据库每日快照（生产 Postgres 用 Neon 自带历史/付费档 PITR；SQLite 单文件拷贝即可）
- [ ] 按 marketing/LAUNCH.md 执行首发渠道计划

## 安全设计

- 密码 scrypt 加盐哈希；会话为数据库存储的 SHA-256 令牌；Cookie HttpOnly + SameSite=Lax + 生产环境 Secure。
- 所有 SQL 均为参数化查询；全部用户内容 HTML 转义（服务端 `esc()`、客户端 `textContent`）。
- 变更类请求校验 `X-Requested-With` + Origin；登录/注册与公开签收接口有 IP 限流。
- Stripe Webhook 使用 HMAC 签名校验（±5 分钟容差）。
- 演示升级接口仅在 `DEMO_MODE` 下存在，生产环境强制关闭。
