# QuoteMint 零成本建站技能手册（经验总结与可复用做法）

> [English](PLAYBOOK.en.md) | 中文

> 记录 2026-10 从零到上线的全过程经验：走过的路线、排除的方案、踩过的坑、可复用的做法。既用于复盘本项目，也可作为下一个项目的复刻手册。

## 1. 约束与最终结论

- **约束**：零资金投入；不拿自己的电脑当服务器；面向海外英文市场、同时国内可访问（中国大陆网络）；创始人只在"人类步骤"（短信 / 扫码 / 图形验证码）介入，其余全自动。
- **最终架构（月固定成本 ¥0）**：

| 层 | 采用方案 | 说明 |
|---|---|---|
| 网站托管 | Netlify 免费版 | GitHub 推送自动部署、自动 HTTPS、商用允许 |
| 数据库 | Neon Postgres 免费版 | 云端、免维护；本地开发用 SQLite 双驱动切换 |
| 域名 | DigitalPlat 免费域名 `quotemint.dpdns.org` | 每年免费续期；DNS 托管在 DigitalPlat |
| 企业邮箱 | 腾讯企业微信邮箱 | support@ 为主邮箱别名；来信自动转发到常用邮箱 |
| 收款 | 支付宝个人收款码 + 人工开通 | 无卡、无平台抽成；海外收款（Creem）代码已预埋 |
| 代码托管 | GitHub | 公开主仓库；凭证单独放私有仓库（见 §9） |

- **选型三关（核心判断）**：任何"免费"平台先过三关再投入——① **支付方式**（要不要国际银行卡）；② **网络可达**（境内能否注册与访问）；③ **商用条款**（免费档是否允许商业用途）。三关不过，免费额度再大也不用。

## 2. 选型排除记录（为什么不是它们）

| 平台 / 路线 | 结果 | 原因 |
|---|---|---|
| Render | 排除 | 免费档 2026 起强制绑定国际银行卡（实测被拦） |
| Hugging Face Spaces | 排除 | 主站被墙，无法注册/管理 |
| Koyeb | 排除 | 被收购后控制台冻结，不可用 |
| HelioHost | 排除 | 免费套餐 TOS 明确禁止商用 |
| 云厂商"免费试用"轻量服务器 + Cloudflare 隧道 | 备选未走 | 试用期仅 1–3 个月，到期要迁移；操作手册留档在 `deploy/`，将来可复用 |
| **Netlify + Neon + DigitalPlat** | **✅ 采用** | 零卡、商用允许、境内可达、免费额度对早期绰绰有余 |

## 3. 核心技能配方（可复用）

### 3.1 让"零依赖 node:http 应用"跑上 Netlify Functions

- 方案：写一层 **Functions v1 适配器**（`src/lib/serverless-adapter.js`），把 Lambda event 桥接成 node:http 的 `req`/`res`；**多 Set-Cookie 必须走 `multiValueHeaders`**（v1 是唯一被文档确认的机制）；整体是薄入口（`netlify/functions/server.mjs`）require 应用本体。
- `netlify.toml` 要点：`publish = "public"`；catch-all 用 **200 改写**（`/* -> /.netlify/functions/server`，不要 force，让静态文件优先）。
- 价值：不用改应用代码，就把单进程 node:http 应用免费放上了 serverless。

### 3.2 打包陷阱（首次部署崩溃复盘，最重要的一条教训）

- 症状：部署成功但函数模块加载即崩：`TypeError: Invalid URL`。
- 原因：**esbuild 把 ESM 打成 CJS 后 `import.meta.url` 为空**，而代码在模块顶层用 `new URL(...)` 算路径。
- 解法：路径解析**懒加载 + 守卫**（`src/lib/paths.js`：`import.meta.url` 为空时回退 `process.env.LAMBDA_TASK_ROOT` / `process.cwd()`）。
- 通用教训：**serverless 平台 + 打包器**场景下，所有"模块加载期"对路径/环境的假设都要重新检查。

### 3.3 Netlify 密钥扫描误报

- 症状：部署被拦，提示检测到密钥——其实只是 `NODE_ENV` / `BASE_URL` 的普通值出现在了仓库文件里。
- 解法：设环境变量 `SECRETS_SCAN_OMIT_KEYS=NODE_ENV,BASE_URL`。
- **2026-10-15 升级版（构建直接失败 "Exposed secrets detected"）**：把 `MAIL_FROM` 等勾选为 Secret 后，其值 `support@quotemint.dpdns.org` 本身就在仓库文档里 → 全量扫描命中、**构建失败**。解法：`SECRETS_SCAN_OMIT_KEYS` 追加 `MAIL_FROM,SMTP_HOST,SMTP_PORT,SMTP_SECURE,SMTP_USER`。
- **教训：给环境变量勾"Secret"之前，先 `git grep` 一下该值是否出现在仓库里**——是则要么不勾，要么同时加入 OMIT_KEYS。

### 3.4 双驱动数据库（本地开发 / 云端生产无缝切换）

- `DATABASE_URL` 有值 → 走 Postgres（Neon）；无值 → 走本地 SQLite。同一套代码、同一套测试。
- 细节：SQL 占位符自动翻译（`?` → `$n`）；配额类事务用 advisory lock；驱动**懒加载**（serverless 冷启动少一次 import）。

### 3.5 Git 推送即部署

- `master` 推送到 GitHub → Netlify 自动构建（约 12 秒）→ 上线。文档类提交也会触发一次无害部署。

## 4. 域名与 DNS 技能（DigitalPlat + Netlify）

- 免费域名：DigitalPlat（`dpdns.org` 等后缀），KYC 走 GitHub OAuth；注册流程需要手机号。
- 关键记录：
  - `@ A 75.2.60.5`（Netlify 负载均衡入口）
  - `www CNAME quotemint.netlify.app.` —— **值必须带结尾点！** 否则平台会把区域后缀拼上去（变成 `xxx.quotemint.dpdns.org.`），记录错误且很难自查。
- 面板 API 备忘：变更请求需带 `X-CSRF-Token` 头（= cookie `panel_csrf_token` 的值）；**MX 记录格式**为 value 写成 `"5 mxbiz1.qq.com."` —— 优先级嵌在值里，单独的 `priority` 字段会报 `invalid_record_value`。
- HTTPS：记录生效后 Netlify 自动签发 Let's Encrypt 证书；`www` 自动 301 到主域名。

## 5. 免费企业邮箱技能（腾讯企业微信邮箱）

- 开通路径：注册企业微信（微信扫码）→「邮件」→ 提交域名 → 按指引加 DNS 记录 → 验证通过 → 建邮箱。
- 必需记录：MX `mxbiz1.qq.com`（优先级 5）、`mxbiz2.qq.com`（10）；CNAME `qqmail<编号>` → `mail.qq.com`；建议加 SPF：`v=spf1 include:spf.mail.qq.com ~all`。
- **最大限制：一个微信只能绑定/激活一个企业邮箱账号。** 管理员微信已绑定主邮箱后，独立成员邮箱无法激活。
- **采用的替代方案：邮箱别名。** 把 support@ 设为主邮箱的**别名**——客户来信直接进主邮箱；再开「自动转发」把邮件转到常用邮箱。日常"读 support@"= 什么都不用做。
- 自动转发开启需两个验证：邮箱内**微信扫码** + **目标邮箱点确认链接**（两次都必须真人）。
- 收信验证方法：a) 自环测试（自己给自己发）；b) 让外部邮箱（如QQ）回复一封——外部收发全链路才算验证完。
- 阅读入口备份：`exmail.qq.com` 微信扫码登录（可切换 support@ 别名身份发信）。

## 6. 零卡收款技能（中国大陆）

- 方案：**支付宝个人收款码 + 人工开通**。客户在账单页扫码付款 → 按页面提示发邮件 → 运营方运行 `npm run grant <邮箱> 12`（脚本连生产数据库）→ 用户升级 Pro。
- 为什么这样选：Stripe / LemonSqueezy 对大陆个人不可用；Creem 可个人注册（代码适配器已内置、env 门控休眠，将来有量可申请启用）。
- 合规提醒：个人收款码长期经营收款有被限制风险；上量后应更换「商家码」或启用 Creem。

## 7. 账号注册自动化经验

- 可全自动（浏览器自动化 + 用户真实 Chrome 登录态）：GitHub OAuth 一键注册/登录——Netlify、Neon、DigitalPlat（KYC）都走这条。
- 必须真人介入的"人类步骤"：短信验证码、微信扫码、图像验证码（腾讯/hCaptcha）、滑块。
- 境内不可用：Google 系验证码（注册通道要避开 Google reCAPTCHA）、页面避免依赖 Google 系资源（如 analytics.js）。
- 节奏建议：能 OAuth 的全走 OAuth；用户只在人类步骤出现，其余全部自动化。

## 8. 踩坑清单（症状 → 原因 → 解法）

| 症状 | 原因 | 解法 |
|---|---|---|
| Render 免费档无法开通 | 强制绑国际银行卡 | 换平台（本项目的选型三关之一） |
| 首部署函数崩溃 Invalid URL | 打包后 `import.meta.url` 为空（§3.2） | 懒加载 + LAMBDA_TASK_ROOT 回退 |
| 部署被密钥扫描拦 | NODE_ENV/BASE_URL 字面值误报 | `SECRETS_SCAN_OMIT_KEYS` |
| 构建失败 "Exposed secrets detected" | 勾成 Secret 的值的文本出现在仓库（如 support@… 在文档里） | `SECRETS_SCAN_OMIT_KEYS` 追加该键；勾 Secret 前先 `git grep` 值 |
| www 域名解析错（拼了长尾巴） | CNAME 值没带结尾点 | 值带结尾点重新提交（§4） |
| DNS 面板 API 改动报错/被拒 | 缺 CSRF 头 | 带 `X-CSRF-Token`（= cookie 值） |
| 加 MX 记录被拒 invalid_record_value | 把优先级填进了独立字段 | 优先级嵌进 value：`"5 主机名."` |
| 独立 support 邮箱无法激活 | 一个微信只能绑一个企业邮箱 | 改用**别名**方案（§5） |
| 自动转发一直"等待验证" | 目标邮箱没点确认链接 | 目标邮箱点确认（+邮箱内微信扫码） |
| DigitalPlat 注册被 reset | GitHub OAuth 路径境内偶发 | 重试；或走账号密码注册（需手机号） |
| 表单自动化填不进值 | React/Vue 表单不响应 fill | 逐键输入（pressSequentially）触发事件 |

## 9. 凭证与文档的保管原则

- **公开仓库只放代码与文档，绝不放密码/连接串。** 密码文件（`账号信息.md`）永远 gitignore，副本单独放**私有仓库**（GitHub Private，仅本人可见）。
- 文档全部**中英双语**，配对文件顶部互相链接；"要实际发表的英文文案"在中文版中保留英文原文 + 附中文对照。
- 建议：规模变大后把密码迁入密码管理器（如 Bitwarden 免费版），Claude 可协助迁移。

## 10. 下一次复刻清单（按序执行）

1. **选型**：托管 + 数据库，按"三关"筛选（卡 / 网络 / 商用）。
2. **注册顺序**：GitHub → 托管平台（OAuth）→ 数据库（OAuth）→ 域名（先确认免费档）→ 企业邮箱。
3. **域名 DNS**：A / CNAME（注意结尾点）→ 等证书签发 → www 重定向。
4. **邮箱**：MX + SPF + CNAME → 别名或成员邮箱 → 开启转发 → 双向实测（发+收）。
5. **收款**：先"收款码 + 脚本人工开通"，自动收款适配器预埋。
6. **部署**：push 即上线；首部署盯函数日志（打包陷阱，§3.2）。
7. **验收**：注册 → 建单 → 发送 → 签收 全链路；支付开通一次；邮箱收发各一次。
8. **收尾**：凭证进私有仓库；全部文档双语；把经验写回本手册。

## 11. 本项目关键时间线（存档）

- **2026-10-10**：产品完成（当时 148 项测试全绿；测试套件现已到 204 项，中英双语，安全加固）。
- **2026-10-13**：上线 Netlify + Neon；品牌域名 `quotemint.dpdns.org` 生效（HTTPS 全绿、www 301）；全链路 e2e 实测通过。
- **2026-10-14**：支付宝收款码上线（¥68/年）；support@ 邮箱打通（别名 + QQ 自动转发，收发双向实测）；全部文档双语化；私有运维仓库 `quotemint-ops` 建立。
- **2026-10-15**：隐藏管理端 `/admin` 上线（开通/撤销 Pro、报价单浏览、统计、审计）；邮件能力上线（零依赖 SMTP 客户端 + 忘记密码 + 签收通知 + 续费提醒）并配置腾讯企业邮箱 SMTP（发信实测通过）；UptimeRobot 探活监控（邮件告警）；开发会话权限白名单。
