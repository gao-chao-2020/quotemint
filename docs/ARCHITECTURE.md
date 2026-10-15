# QuoteMint 网站架构说明

> [English](ARCHITECTURE.en.md) | 中文

> 本文说明 QuoteMint **线上运行的完整架构**：从用户打开浏览器到数据落库、邮件与收款如何走。面向创始人阅读，也可供将来接手的技术人员快速上手。接口细节（字段/状态码/表结构）以冻结的 [API-CONTRACT](API-CONTRACT.zh-CN.md) 为准；选型过程与踩坑见 [PLAYBOOK](PLAYBOOK.md)。

## 1. 一句话架构

一个**零依赖的 Node.js 单代码库应用**：开发时跑在本机（SQLite），生产跑在 Netlify 的函数平台（AWS Lambda 上的 Node 22）+ Neon 云 Postgres。用户通过品牌域名访问；客服邮件走腾讯企业邮箱自动转发；收款走支付宝收款码 + 人工开通。**月固定成本 ¥0。**

## 2. 全景图

```
用户浏览器（PC / 手机，中英文）
        │  HTTPS
        ▼
quotemint.dpdns.org ── DNS 在 DigitalPlat：
        │                @ A 75.2.60.5（Netlify 入口）
        │                www CNAME → quotemint.netlify.app.（301 到主域）
        ▼
Netlify（免费版，全球 CDN + 自动 HTTPS）
   ├── 静态资源 public/*（styles.css、各页脚本、图标、支付宝收款码图片）→ CDN 直出
   └── 其余全部路径 200 改写 → Netlify Function「server」（Lambda，Node 22）
            │
            ▼
       netlify/functions/server.mjs          ← 薄入口（只做包装）
            │
       src/lib/serverless-adapter.js         ← 关键适配层：
            │                                    Lambda event ⇄ node:http req/res 桥接
            │                                    （多 Set-Cookie 走 multiValueHeaders）
            ▼
       src/server.js                          ← 应用本体（HTTP 服务器）
            ├── src/routes/*      路由：auth / quotes / public / billing / pages
            ├── src/templates/*   服务端渲染 HTML（中英双语 i18n、全部转义）
            └── src/lib/*         业务库：db / auth / money / gating / quotes /
                                  http / billing / stripe / creem / paths
            │
            ▼
       src/lib/db.js                          ← 双驱动数据库（按环境自动选择）
            ├── 有 DATABASE_URL → pg 驱动 → Neon Postgres（美东，加密连接、连接池）
            └── 无 DATABASE_URL → node:sqlite → 本机 data/app.db（开发/自建用）
            （同一套 SQL：占位符自动翻译 ? → $n）

旁路系统（与网站独立）：
   邮件：客户 → support@quotemint.dpdns.org（腾讯企业微信邮箱）
         → 别名直入运营者主邮箱 → 自动转发到运营者QQ邮箱
   收款：客户扫「支付宝收款码」（public/ 静态图）→ 运营方运行 scripts/grant.js
         → 直连 Neon 把该用户升级 Pro
   部署：本机 git push → GitHub（公开仓库）→ Netlify 自动构建（esbuild 打包函数）
         → 全球生效（约 12–20 秒）
```

## 3. 一次请求的生命周期（以「客户打开报价」为例）

1. 客户点开链接 `https://quotemint.dpdns.org/q/<令牌>`。
2. DNS 解析到 Netlify 负载均衡；静态文件优先由 CDN 直出，`/q/<令牌>` 属动态路径 → 200 改写到函数。
3. Lambda 接收事件（冷启动或复用热实例）→ 适配层把事件包装成标准 `node:http` 请求 → `src/server.js` 路由到公开页面处理器。
4. 处理器查 Neon：校验令牌、读取报价、记录一次「打开事件」（同一访客 60 秒内去重）。
5. 服务端渲染客户页面（按浏览器语言出中/英文、全部内容转义）→ 返回 HTML。
6. 客户输入姓名、勾选同意并签收 → POST 到公开 API → 事务内更新状态为已签收 → 页面显示签收人与时间。

## 4. 技术栈与选择理由

| 层 | 选择 | 理由 |
|---|---|---|
| 语言 / 运行时 | Node.js（生产钉 22，本地 24） | `node:sqlite` 免 flag 需 ≥22.13；内置模块足够，几乎零依赖 |
| Web 框架 | 无框架：`node:http` + 服务端渲染 HTML + 原生 JS | 无构建步骤、冷启动极小、十年级稳定 |
| 数据库 | 本地 SQLite / 生产 Neon Postgres（双驱动） | 本地零配置；云端免费、免运维、自动备份历史 |
| 托管 | Netlify 免费版 + Functions v1 适配层 | 免费、允许商用、全球 CDN、自动 HTTPS |
| 企业邮箱 | 腾讯企业微信邮箱（别名 + 自动转发） | 免费、国内可用、微信扫码即可管理 |
| 收款 | 支付宝收款码 + 人工开通；美元市场预埋 Creem/Stripe 适配器（env 门控休眠） | 个人无卡可用；合规与自动化之间取平衡 |
| 域名 / DNS | DigitalPlat 免费域名 + 托管 DNS | 零成本，每年免费续期 |

## 5. 代码地图（哪块负责什么）

```
src/
  server.js                        入口：路由表、安全头、Cookie、静态文件、限流挂载
  lib/
    serverless-adapter.js          生产关键：Lambda 事件 ⇄ node:http 桥接（仅生产用）
    paths.js                       兼容打包器的路径解析（生产热修产物，勿轻动）
    db.js                          双驱动数据库（sqlite / pg 懒加载、SQL 占位符翻译）
    auth.js                        scrypt 加盐密码、数据库会话令牌、Cookie 策略
    quotes.js                      报价 CRUD 与状态机：draft → sent → viewed → accepted
    money.js                       金额计算（以「分」存储，折扣/税/多币种展示）
    gating.js                      套餐限制：Free 每月 3 份；Pro 到期自动降级
    http.js                        请求解析、CSRF/Origin 校验、IP 限流
    billing.js / stripe.js / creem.js   计费调度与两个提供商适配器（休眠备用）
    mailer.js                           零依赖 SMTP 邮件客户端（邮件能力地基）
    notify.js                           事件通知（签收邮件等，即发即弃）
  routes/
    auth.js / quotes.js / public.js / billing.js / pages.js   按域拆分的路由
    admin.js                                                管理端路由（/admin，默认对外 404，见 §7）
  templates/
    layout / landing / auth / dashboard / editor / billing /  全部页面的服务端渲染
    publicquote / legal / …；i18n.js + dict-*.js              中英词典与切换
netlify/
  functions/server.mjs             生产函数入口（薄包装）
netlify.toml                       平台配置：publish=public、改写到函数、NODE_VERSION=22
public/                            静态资源（样式、页面脚本、favicon、支付宝收款码）
scripts/seed.js                    本地演示数据；scripts/grant.js 人工开通 Pro（连生产库）
test/                              150 项单元 + 集成测试（npm test）
```

## 6. 数据放在哪里（"我的数据在哪"）

| 数据 | 存放位置 | 说明 |
|---|---|---|
| 用户、报价、签收、打开记录 | **Neon Postgres**（云端，TLS 连接） | 生产唯一数据源；Neon 控制台可查 |
| 本地开发数据 | 本机 `data/app.db`（SQLite） | 与生产完全隔离 |
| 页面图片等静态资源 | 代码仓库 `public/`（GitHub 公开） | 目前无用户上传功能 |
| 邮件 | 腾讯企业邮箱服务器 + 自动转发的副本（运营者QQ邮箱） | 邮箱内保留原件 |
| 收款记录 | 支付宝账单（人工核对）；系统内 Pro 状态由开通命令写入 Neon | 无独立支付表 |

## 7. 安全设计（边界与手段）

- **入口边界**：全部请求先过 `src/server.js` 的安全头与路由；生产密钥只存在平台环境变量（Netlify），不落代码。
- **管理端**：`/admin` 默认整体 404（未同时配置 `ADMIN_PASSWORD_HASH` + `ADMIN_SESSION_SECRET` 时与不存在无异）；独立管理员密码（scrypt 恒时校验）、HMAC 无状态会话（HttpOnly、`Path=/admin`）、登录限流、全部开通/撤销写入 `admin_events` 审计表（见 API-CONTRACT §18）。
- **密码重置**：单次令牌（sha256 存储、1 小时有效、用后即焚），重置成功后该用户**全部会话强制下线**；请求接口永远返回成功以管理员防枚举（见 API-CONTRACT §19）。
- 密码 scrypt 加盐；会话为数据库存储的 SHA-256 令牌；Cookie HttpOnly + SameSite=Lax + 生产 Secure。
- 所有 SQL 参数化；所有用户内容 HTML 转义（服务端 `esc()`、客户端 `textContent`）——防注入/XSS。
- 变更类请求校验 `X-Requested-With` + Origin（防 CSRF）；登录/注册/公开签收有 IP 限流（反代后靠 `TRUST_PROXY=1` 取真实 IP）。
- Stripe/Creem Webhook 采用 HMAC 签名校验（±5 分钟容差）；演示升级接口仅存在于 `DEMO_MODE`，生产强制关闭。
- 域名单点：DNS 托管在 DigitalPlat 账号下，保护好该账号（见私有仓库凭证文件）。

## 8. 可用性与容错

- Netlify 承担 CDN、HTTPS、函数扩容（无服务器运维）；Neon 承担数据库高可用与备份历史。
- 函数冷启动：首次请求可能慢几百毫秒，之后复用热实例。
- 单点风险：Netlify 或 Neon 故障会导致站点不可用（免费档 SLA 有限）；应对外部探活（`/healthz`）监控；迁移路径已备好（deploy/ 手册 + 双驱动数据库），可快速切换到自建服务器或付费档。

## 9. 架构演进路线（长大了怎么办）

1. **流量增长**：Netlify 免费 300 credits/月不够 → 升付费档，或按 `deploy/` 手册迁回自建服务器（代码零改动）。
2. **数据库增长**：Neon 直接升付费档（代码零改动）。
3. **收款自动化**：申请 Creem 商户 → 配置 3 个环境变量即启用（适配器已内置）。
4. **团队扩张**：邮箱加别名；密码迁入密码管理器后再共享。

## 10. 与其它文档的关系

| 想知道 | 看哪份 |
|---|---|
| 接口细节：路由、字段、状态码、数据表结构 | [API-CONTRACT.zh-CN.md](API-CONTRACT.zh-CN.md)（冻结版） |
| 为什么这样选型、踩过哪些坑 | [PLAYBOOK.md](PLAYBOOK.md) |
| 部署验收、日常运维清单 | [LAUNCH.md](LAUNCH.md) |
| 每天该做什么（非技术版） | [OPERATIONS.md](OPERATIONS.md) |
