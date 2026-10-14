# QuoteMint API 契约（v1，中文翻译版）

> [English](API-CONTRACT.md) | 中文 · 本文件为英文原版的参考译文，如遇歧义以英文原版为准。

**已冻结（FROZEN）。** 本文档是所有接口的唯一事实来源。如果你认为某项内容必须修改，请联系团队负责人 — 请勿单方面编辑本文件或偏离本文件。

## 0. 技术栈与约定

- Node >= 22.5，ESM（`"type":"module"`），**零外部运行时依赖**（使用 `node:http`、`node:sqlite`、`node:crypto`、`node:test` 和全局 `fetch`）。永远不要运行 `npm install`。
- 启动命令：`npm start` → `node --no-warnings --env-file-if-exists=.env src/server.js`
- 环境变量：`PORT`（默认 3000）、`BASE_URL`（默认 `http://localhost:3000`）、`DATA_DIR`（默认 `./data`）、`DEMO_MODE`、`STRIPE_SECRET_KEY`、`STRIPE_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`。
- 数据库：SQLite 文件位于 `${DATA_DIR}/app.db`，使用 `node:sqlite` 的 `DatabaseSync`，WAL 模式，启动时运行 `CREATE TABLE IF NOT EXISTS` 迁移。
- 日期：ISO-8601 UTC 字符串（`new Date().toISOString()`）。仅日期字段（`valid_until`）：`YYYY-MM-DD`。
- **金额：以分为单位的整数。所有金额字段名都以 `_cents` 结尾。** 百分比字段（`discount_pct`、`tax_pct`）为 0–100 的数字（可为小数）。
- JSON 响应：
  - 成功：`{ "ok": true, "data": <payload> }` — HTTP 2xx。
  - 错误：`{ "ok": false, "error": { "code": "<snake_code>", "message": "<human readable>" } }` — HTTP 4xx/5xx。
- 所有 JSON 响应：`Content-Type: application/json; charset=utf-8`。

## 1. 数据库 Schema（精确）

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  brand_color TEXT NOT NULL DEFAULT '#4F46E5',
  logo_text TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free',            -- 'free' | 'pro'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_renews_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                           -- sha256 hex of raw token
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  public_token TEXT NOT NULL UNIQUE,             -- 32 hex chars
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  items TEXT NOT NULL,                           -- JSON array
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_pct REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',          -- draft|sent|viewed|accepted|declined
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, declined_at TEXT,
  accepted_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_token ON quotes(public_token);
CREATE TABLE IF NOT EXISTS quote_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  type TEXT NOT NULL,                            -- 'sent'|'view'|'accept'|'decline'
  at TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT ''                  -- optional note (e.g. decline reason)
);
CREATE INDEX IF NOT EXISTS idx_events_quote ON quote_events(quote_id);
```

`quotes.items` JSON：`[{"desc": string, "qty": number, "unit_price_cents": integer}]`

## 2. 合计金额计算（`src/lib/money.js`）

`computeTotals(items, discount_pct, tax_pct)` 返回 `{ subtotal_cents, discount_cents, tax_cents, total_cents }`：

- 每个条目的 `line = Math.round(qty * unit_price_cents)`
- `subtotal_cents = sum(lines)`
- `discount_cents = Math.round(subtotal_cents * discount_pct / 100)`
- `tax_cents = Math.round((subtotal_cents - discount_cents) * tax_pct / 100)`
- `total_cents = subtotal_cents - discount_cents + tax_cents`
- 两个百分比都限制在 `[0,100]` 范围内。无效条目 → 抛出 `Error`。

`formatMoney(cents, currency)` → `Intl.NumberFormat('en-US', {style:'currency', currency})`，货币代码无效时回退为 `USD` 格式。

## 3. 认证

- 密码：使用 `scryptSync`，存储为 `scrypt$<saltHex>$<hashHex>`；用 `timingSafeEqual` 校验。最少 8 个字符，最多 200 个字符。
- 邮箱：去除首尾空白并转小写；≤254 个字符；必须匹配 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`。
- 会话：原始 token = `crypto.randomBytes(32).toString('hex')`；数据库将 `sha256(token)` 的十六进制值存为 `sessions.id`。TTL 为 30 天。
- Cookie：`qm_session=<token>; HttpOnly; SameSite=Lax; Path=/` + `; Secure`（仅当 `BASE_URL` 以 `https` 开头时）。
- 使用未知邮箱和错误密码登录 → 返回完全相同的 `401 invalid_credentials`。

路由：

| 方法与路径 | 请求体 | 成功 | 错误 |
|---|---|---|---|
| `POST /api/auth/signup` | `{email,password,name}`（name 1–80） | `201 {data:{user}}` + Set-Cookie | `400 invalid_email/invalid_password/invalid_name`、`409 email_taken` |
| `POST /api/auth/login` | `{email,password}` | `200 {data:{user}}` + Set-Cookie | `401 invalid_credentials` |
| `POST /api/auth/logout` | — | `200 {ok:true}` 清除 cookie 和 session 记录 | — |
| `GET /api/auth/me` | — | `200 {data:{user, quota}}` | `401 not_authenticated` |
| `PUT /api/auth/profile` | `{name?, company?, brand_color?, logo_text?}` | `200 {data:{user}}` | `401`、`400 invalid_*`、`403 pro_required`（plan=free 时使用品牌定制字段） |

- `name` 始终可更新。`company` ≤80，`logo_text` ≤40，`brand_color` 必须匹配 `/^#[0-9a-fA-F]{6}$/` — 这三个字段要求 `plan==='pro'`。
- `user` 结构：`{id, email, name, company, brand_color, logo_text, plan, plan_renews_at, created_at}` — **绝不**返回 `password_hash` 或 stripe id。
- `quota` 结构：`{used: <int>, max: <int|null>, resets_at: <ISO>}` — pro 的 `max=null`。`used` = 本自然月（UTC）内创建的报价单数量。

## 4. 限流（`src/lib/http.js`）

按 IP 的内存滑动窗口（单进程场景足够）：

- `POST /api/auth/signup`、`POST /api/auth/login`：每 IP 每 15 分钟 20 次请求
- `POST /api/public/quotes/:token/accept`、`.../decline`：每 IP 每 15 分钟 30 次请求

超出限制 → `429 {code:'rate_limited'}`。客户端 IP：**仅当 `TRUST_PROXY=1`** 时取 `x-forwarded-for` 的第一个条目（只在你掌控的反向代理之后才设置）；否则使用 socket 地址。不可信的 XFF 绝不能生成新的限流键。

## 5. CSRF 与 Origin 校验

- `/api/*` 和 `/webhooks/*` 下每个**变更型**请求都要求携带请求头 `X-Requested-With: XMLHttpRequest` → 否则 `403 {code:'csrf'}`。（GET 豁免。）
- 如果存在 `Origin` 请求头，其主机必须与请求的 `Host` 请求头相等 → 否则 `403 {code:'origin'}`。

## 6. 报价单状态机（`src/lib/quotes.js`）

```
draft --send--> sent --first public view--> viewed --accept--> accepted
                                                  \--decline--> declined
```

- **draft（草稿）**：可编辑（`PUT`）、可删除（`DELETE`）、可发送。发送要求：title 非空、client_name 非空、至少 1 个有效条目 → 否则 `400 incomplete`。
- **sent/viewed**：`PUT` → `409 not_draft`；`DELETE` → `409 not_draft`。再次发送 → `200`，返回 URL，**状态不回退**（viewed 保持 viewed）。
- **accepted/declined**（终态）：发送 → `409 already_final`。公开签收/拒绝 → `409 already_final`。
- 公开的 `GET /q/:token` 会记录一条 `view` 事件，并且仅当状态为 `sent` 时升级 `sent → viewed`（设置 `viewed_at`）。草稿渲染时带 DRAFT 缎带，不记录任何内容。
- 记录的事件：`sent`（发送时）、`view`（公开 GET）、`accept`、`decline`（可选 `meta` = 拒绝原因）。

## 7. 套餐限制（`src/lib/gating.js`）

- `FREE_MONTHLY_QUOTES = 3`。计数 = 该用户在当前**自然月（UTC）**内创建的报价单数量（包含所有状态）。
- 一个月内第 4 次创建 → `403 {code:'free_limit_reached'}`。
- Pro 权益：无限报价单；`GET /q/:token` 上不显示 “Powered by QuoteMint” 标识；自定义品牌（company / brand_color / logo_text）；`GET /api/quotes/:id` 中包含 `events`（免费版为 null）。

## 8. 报价单 API（需要会话）

列表条目结构：`{id, title, client_name, status, currency, total_cents, public_token, created_at, sent_at, viewed_at, accepted_at, valid_until, views}` — `views` = `view` 事件的数量。最新的排在最前。

| 方法与路径 | 说明 |
|---|---|
| `GET /api/quotes` | → `200 {data:{quotes:[...], quota}}` |
| `POST /api/quotes` | 请求体见下文 → `201 {data:{quote}}`；`403 free_limit_reached` |
| `GET /api/quotes/:id` | → `200 {data:{quote, totals, events}}` — `events: [{type, at, meta}]` 或 `null`（免费版）。不属于该用户时返回 `404 not_found`。 |
| `PUT /api/quotes/:id` | 请求体与 POST 相同 → `200 {data:{quote}}`；`409 not_draft` |
| `DELETE /api/quotes/:id` | → `200 {ok:true}`；`409 not_draft` |
| `POST /api/quotes/:id/send` | → `200 {data:{quote, public_url}}`；`400 incomplete`；`409 already_final` |

写入请求体校验：

- `title` 1–200；`client_name` 1–120；`client_email` 可选，须为有效邮箱格式且 ≤254；`currency` 取值于 `USD|EUR|GBP|CAD|AUD|CNY`（默认 `USD`）
- `items` 1–50；每项 `{desc: 1–500 字符, qty: number 0 < qty <= 100000, unit_price_cents: integer 0..1e12}`
- `discount_pct`、`tax_pct`：0–100（默认 0）；`notes`、`terms` ≤2000；`valid_until`：`YYYY-MM-DD` 或 null
- 无效 → `400` 并带具体错误码（`invalid_items`、`invalid_title` 等）

`public_url` = `${BASE_URL}/q/${public_token}`。

完整报价单对象（按 id GET）：`quotes` 表的所有列（items 解析为数组）+ 来自 `computeTotals` 的 `totals`。

## 9. 公开 API（无需会话）

| 方法与路径 | 说明 |
|---|---|
| `GET /q/:token` | 服务端渲染的 HTML 报价单页面（任何状态；草稿显示 DRAFT 缎带）。 |
| `POST /api/public/quotes/:token/accept` | 请求体 `{name, agree}` — `name` 1–120，`agree` 必须为 `true`。状态为 `sent|viewed` 时允许 → `200 {data:{status:'accepted', accepted_name, accepted_at}}`。错误：`404`、`409 already_final`、`400 invalid_name/not_agreed`、`429`。 |
| `POST /api/public/quotes/:token/decline` | 请求体 `{reason?}` ≤500。状态规则相同 → `200 {data:{status:'declined'}}`。 |

这两个变更型路由都需要满足 §5 的 CSRF/Origin 规则。

## 10. 计费

- `billingEnabled` = `STRIPE_SECRET_KEY` 与 `STRIPE_PRICE_ID` 均已设置。`demoMode` = `DEMO_MODE === 'true'`。
- **启动守卫**：如果 `NODE_ENV === 'production'` 且 `DEMO_MODE === 'true'` → 记录 fatal 日志并执行 `process.exit(1)`。

| 方法与路径 | 说明 |
|---|---|
| `GET /app/billing` | HTML 页面：`renderBilling({user, billingEnabled, demoMode})` |
| `POST /api/billing/checkout` | 需要会话 → `200 {data:{url}}`。未配置 → `503 billing_disabled`。 |
| `POST /api/billing/demo-upgrade` | 仅在 demoMode 下可用 → `200 {data:{user}}`，设置 `plan='pro'`、`plan_renews_at=+31d`。否则 `403 demo_disabled`。 |
| `POST /webhooks/stripe` | 原始请求体；校验 `Stripe-Signature` `t=...,v1=...`：期望值 = `HMAC_SHA256(STRIPE_WEBHOOK_SECRET, `${t}.${rawBody}`)` 的十六进制值，用 `timingSafeEqual` 比较，若 `|now − t| > 300s` 则拒绝 → `400`。缺少密钥 → `503`。签名有效后始终返回 → `200 {received:true}`。 |

创建 Stripe Checkout Session（通过 `fetch` 调用 REST，**form-encoded** 请求体，`Authorization: Bearer STRIPE_SECRET_KEY`）：

```
POST https://api.stripe.com/v1/checkout/sessions
mode=subscription
line_items[0][price]=<STRIPE_PRICE_ID>
line_items[0][quantity]=1
success_url=<BASE_URL>/app/billing?upgraded=1
cancel_url=<BASE_URL>/app/billing
customer_email=<user.email>
client_reference_id=<user.id>
metadata[user_id]=<user.id>
allow_promotion_codes=true
```

处理的 Webhook 事件：

- `checkout.session.completed` → 按 `metadata.user_id` 查找用户（回退 `client_reference_id`）→ `plan='pro'`，保存 `stripe_customer_id=session.customer`、`stripe_subscription_id=session.subscription`、`plan_renews_at = now + 31d`。
- `customer.subscription.deleted` → 按 `stripe_subscription_id` 匹配 → `plan='free'`，清空 subscription id。
- 其他：忽略。

## 11. 页面（服务端渲染 HTML）

| 路由 | 模板 | 认证 |
|---|---|---|
| `GET /` | `renderLanding({})` | 公开 |
| `GET /login`、`GET /signup` | `renderAuth({mode})` | 公开；已登录 → `302 /app` |
| `GET /app` | `renderDashboard({user, quotes, quota})` | 需要会话；否则 `302 /login` |
| `GET /app/quotes/new` | `renderEditor({user, quote:null, quota})` | 需要会话 |
| `GET /app/quotes/:id/edit` | `renderEditor({user, quote, quota})` | 需要会话；不属于该用户 → 404 页面 |
| `GET /app/billing` | `renderBilling({user, billingEnabled, demoMode})` | 需要会话 |
| `GET /q/:token` | `renderPublicQuote({quote, totals, branding, showBadge})` | 公开 |
| 任何未匹配的路径 | `renderError({status:404, ...})` | 公开 |

- `branding` = 报价单所有者的 `{company, brand_color, logo_text}`。
- `showBadge` = 所有者套餐为 `free`。
- 传给模板的 `quote` 中 `items` 已解析，并在需要处附带 `totals`。

## 12. 模板（前端负责维护，后端消费使用）

全部从 `src/templates/index.js`（barrel 汇总导出）导出。共享辅助函数位于 `src/templates/layout.js`：

```js
renderLanding({})
renderAuth({mode})                       // 'login' | 'signup'
renderDashboard({user, quotes, quota})
renderEditor({user, quote, quota})       // quote may be null
renderBilling({user, billingEnabled, demoMode})
renderPublicQuote({quote, totals, branding, showBadge})
renderError({status, message})
```

- 每个用户可控的值都必须通过 `layout.js` 的 `esc()` 转义（HTML 转义 `& < > " '`）。
- 客户端 JS 处理用户数据时必须使用 `textContent` / `createElement` — **绝不**使用 `innerHTML` 插入用户数据。
- 页面以 `/styles.css`、`/app.js` 等路径引用静态资源（由 `public/` 提供）。

## 13. 运维

- `GET /healthz` → `200`、`text/plain`，响应体 `ok`。
- 静态资源：`public/` 下的所有文件在 `/` 下提供（例如 `/styles.css`）。内容类型：html、css、js、mjs、svg、ico、png、jpg、webp、woff2、json、txt、xml。有路径穿越防护（解析后的路径必须位于 public/ 内）。`index.html` **不会**在 `/` 下自动提供。
- 每个响应都带安全头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`。
- 无 CORS 头（仅同源）。JSON 请求体限制 1MB → `413 payload_too_large`。
- 未处理的路由/错误 → `/api/*` 返回 JSON 错误，其他情况返回 `renderError` 页面。不向客户端暴露堆栈跟踪；在服务端记录日志。

## 14. 文件归属（不要编辑不属于你的文件 — 请通知文件负责人）

| 负责人 | 文件 |
|---|---|
| backend | `src/server.js`, `src/lib/*`, `src/routes/*`, `test/unit/*`, `scripts/seed.js` |
| frontend | `src/templates/*`, `public/*` |
| qa | `test/integration/*`, `artifacts/*` |
| brand | `marketing/*` |
| lead | `package.json`, `Dockerfile`, `README.md`, `docs/*`, `.env.example`, `.gitignore` |

## 15. 实现决议（经团队负责人批准，2026-10-10）

以下决议澄清了歧义；除此之外，上文已冻结的各节仍按原文执行：

1. `/webhooks/stripe` 豁免 §5 的 `X-Requested-With` 要求（Stripe 无法发送该请求头；HMAC 签名即该路由的认证方式）。当存在 Origin 请求头时，Origin 校验仍然适用。
2. 对 `draft` 报价单执行 `accept`/`decline` → `404 not_found`（公开 API 上只有 `sent|viewed` 是可操作状态；草稿不会作为可签收对象暴露）。
3. 按 §10，Webhook 成功响应体是字面量 `{"received":true}`，而不是 `ok`/`data` 信封结构。
4. `customer.subscription.deleted` 除降级为 `free` 外，还会清空 `plan_renews_at`（将其置为 NULL）。
5. 打开数据分析（产品决策，2026-10-10）：当状态不是 `draft` 时，**每次**公开报价单页面 GET 都会记录一条 `view` 事件，并按报价单去重为每 60 秒最多一条（防刷新刷量保护）。状态升级 `sent → viewed` 仍只发生在首次查看时。编辑器页面会收到 `events`（Pro：`listEvents` 数组；Free：`null`），并渲染活动面板。

## 16. i18n — EN + ZH（迭代 2，2026-10-10 冻结）

- 语言：`en`（默认）和 `zh`（简体中文）。Cookie：`lang=zh` — `Path=/; Max-Age=31536000; SameSite=Lax`，非 HttpOnly，仅当 BASE_URL 为 https 时加 `Secure`。
- 解析顺序（服务端）：若 `lang` cookie 恰为 `en`|`zh` 则采用 → 否则使用 `Accept-Language` 请求头（任何 `zh*` 标签 → `zh`，否则 `en`）→ 兜底 `en`。适用于包括 `/q/:token` 在内的每个页面（客户报价单页面跟随查看者的语言）。
- 后端（负责人：backend）：`src/lib/lang.js` 导出 `resolveLang(req)`。路由 `GET /lang/:code`（code 必须为 `en`|`zh`）：设置 cookie，然后 302 到 `next` 查询参数 — `next` 必须以 `/` 开头，且不能以 `//` 开头，也不能包含 `\`（防开放重定向），否则重定向到 `/`。全部七个 `render*()` 页面调用都传入 `lang`；`<html lang="...">` 反映该值。
- 前端（负责人：frontend）：`src/templates/i18n.js` 导出 `t(lang, key, vars?)` 和 `LANGS`；包含完整的 EN/ZH 词典；未知 key 必须返回 EN 字符串（或 key 本身）— 绝不抛错。所有模板字符串都必须经过 `t()`。客户端 JS：layout 通过现有的 bootScript 转义嵌入 `window.__I18N__ = {lang, t:{...clientKeys}}`；public/*.js 读取它，并以 EN 字面量作为回退。切换器：服务端渲染的导航链接 `EN | 中文`，非当前语言的链接指向 `/lang/<other>?next=<current path>`（必须在无 JS 时也能工作）。
- API JSON 错误的 `message` 保持英文（作为回退）；每个用户可见的错误码还必须在客户端额外映射到本地化文案。
- 翻译标准：地道的、营销级中文 — 不是字面机翻。品牌团队随后审计 zh 文案。
- 归属补充（§14）：`src/lib/lang.js` → backend；`src/templates/i18n.js` → frontend。
- QA 测试（§5 负责人）：`/lang/zh?next=/app` 设置 cookie 并 302 到 /app；`/lang/en?next=https://evil.com` 和 `?next=//evil.com` → 302 到 `/`；zh 探针：带 `lang=zh` cookie 的落地页包含已知中文字符串；无 cookie 但 Accept-Language 为 `zh-CN` 时渲染 zh；导航中存在切换器链接。

## 17. 计费提供商：Creem（迭代 3，2026-10-10 冻结）

中国大陆个体工商户限制：Stripe 和 LemonSqueezy 不可用；Creem（MoR）是主要提供商，Paddle 保留为有文档记录的备选。

- 提供商选择（自动）：设置了 `CREEM_API_KEY` → 提供商为 `creem`；否则若 `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` 已设置 → `stripe`（保留，仍完全支持）；否则 `none`（`billingEnabled=false`）。`isConfigured()`/`isDemoMode()` 签名不变。
- 后端（负责人：backend）：`src/lib/creem.js`，沿用现有 stripe.js 的接口形态 — `isConfigured()`、`createCheckoutSession(db, user)`（Creem API v1：POST `/v1/checkouts`，携带 product id + `success_url=<BASE_URL>/app/billing?upgraded=1`，`request_id`/metadata 携带 `user_id` 和客户邮箱；返回 `{url}`）、`verifyWebhook(rawBody, signatureHeader)`（按 `creem-signature` 请求头做 HMAC-SHA256 十六进制校验 — 严格遵循 Creem 当前文档；实现期间查阅 docs.creem.io）、`handleWebhookEvent(db, event)`。
- 新增环境变量（`src/lib/billing.js` 分发 + README + .env.example，由 lead 负责）：`CREEM_API_KEY`、`CREEM_PRODUCT_ID`、`CREEM_WEBHOOK_SECRET`。测试密钥（`creem_test_*`）走同一条代码路径。
- Webhook 路由：`POST /webhooks/creem` — 原始请求体，校验签名，豁免 CSRF（理由同 §15.1），快速返回 200。事件 → 套餐：`checkout.completed`（以及按 Creem 文档的订阅 active/paid 等等价事件）→ `plan='pro'` + 将 customer/subscription id 存入现有的 stripe_* 列（复用为通用提供商 id）；订阅 canceled/expired/unpaid → `plan='free'`，清空续费时间。未知事件确认接收（acked），不做处理。
- `GET /app/billing` 和 `renderBilling` 新增 `providerName`（'creem' | 'stripe' | null），用于页脚信任文案（“Payments are securely handled by <name>”）。免费套餐升级按钮的行为不变（无提供商时 503；demo-upgrade 不变）。
- 法律页面（Creem 审核所需）：`GET /privacy` 和 `GET /terms` — 公开页面，通过 §16 词典实现双语，从网站页脚链接（两个页面外壳 + 公开报价单页脚，若改动不大）。前端负责模板 + 词典；后端在 pages.js 中接线路由。内容：诚实的标准 SaaS 隐私政策（账号邮箱、报价单数据、由 MoR 处理的支付、cookie：qm_session + lang）和服务条款（服务描述、可接受使用、通过提供商进行计费/退款、责任限制、管辖法律占位）。不得作出法律意见类声明；包含联系行 `support@quotemint.dpdns.org`。
- 页脚/支持：每个页面外壳的页脚都显示 `support@quotemint.dpdns.org` 作为联系地址。
- QA：creem 签名校验（有效/无效/容差）和事件映射的单元测试；集成测试：`POST /webhooks/creem` 坏签名 400，好签名的 checkout.completed 将已创建的用户升级，订阅取消则降级；提供商选择矩阵（creem / stripe / none）；`/privacy` 和 `/terms` 在两种语言下均渲染 200 且无原始用户输入（静态）。全量测试套件复跑通过（green）。
