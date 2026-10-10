# QuoteMint 上线检查清单（运维/产品向）

> 增长渠道与冷启动计划见 [../marketing/LAUNCH.md](../marketing/LAUNCH.md)。

## A. 部署前（一次配置）

- [ ] 注册域名（候选：quotemint.app / quotemint.io / quotemint.com，顺便把 X/GitHub 同名 handle 占掉）
- [ ] 服务器/平台就绪：任意 1 vCPU / 512MB 内存即可；Docker 方式见 README
- [ ] `.env` 生产值：`BASE_URL=https://<域名>`、`NODE_ENV=production`、`DEMO_MODE=false`
- [ ] HTTPS 证书（Caddy 自动签发最省事：`your-domain.com { reverse_proxy localhost:3000 }`）
- [ ] Stripe Live 模式：
  - [ ] Product + 两个 Price（$9/月、$90/年）
  - [ ] `STRIPE_SECRET_KEY`（sk_live_…）、`STRIPE_PRICE_ID`（月付 Price）
  - [ ] Webhook 指向 `https://<域名>/webhooks/stripe`，订阅 `checkout.session.completed`、`customer.subscription.deleted`
  - [ ] `STRIPE_WEBHOOK_SECRET`（whsec_…）
- [ ] 数据卷挂载并确认可写（Docker：`-v quotemint-data:/data`）

## B. 上线验收（每次发版跑一遍）

冒烟路径（浏览器或 curl）：

1. `GET /healthz` → `ok`
2. 注册新账号 → 收到 Cookie，跳转 `/app`
3. 新建报价（含小数数量、折扣、税）→ 总额与手算一致
4. 发送报价 → 复制客户链接
5. 隐身窗口打开客户链接 → Free 账号见 badge；报价状态变 `viewed`；等待 1 分钟后刷新一次 → Pro 账号在编辑器「动态」面板看到两条打开记录（60 秒去重生效）
6. 客户输入姓名勾选同意 → 状态 `accepted`，仪表盘显示签收人与时间
7. 打开已签收链接再点接受 → 提示已终结（409 路径）
8. 打印报价页 → 预览为干净 A4 文档（无导航/按钮/badge）
9. Free 账号建第 4 份报价 → 出现升级引导
10. 测试卡 `4242 4242 4242 4242` 走 Stripe Checkout → 回跳 `?upgraded=1`，状态变 Pro、badge 消失
11. Stripe Dashboard 重放 `customer.subscription.deleted` 事件 → 降回 Free
12. 重启进程 → 数据仍在（SQLite 持久化验证）

## C. 运营（上线后）

- [ ] 备份：cron 每日 `sqlite3 /data/app.db ".backup /backup/app-$(date +%F).db"`，保留 14 天，异地存一份
- [ ] 监控：外部探活 `GET /healthz`（UptimeRobot 免费版即可）；查看进程日志有无 5xx
- [ ] 收件箱：域名邮箱（如 hello@）转发到常用邮箱，用于反馈与 support
- [ ] 数据看板（SQL 直查即可）：
  - 注册数：`SELECT COUNT(*) FROM users;`
  - 关键漏斗（周）：注册 / 建首份报价 / 发出报价 / 被签收 / 升级
- [ ] 每周一次：跑第 B 节冒烟 + 检查 Stripe 是否有争议/失败扣款
- [ ] 安全：每季度 `npm start` 确认版本无告警；关注 Node LTS 升级；密钥只存服务器 `.env`（600 权限）

## D. 已知边界（v1 明确不做）

- 不发邮件：发送 = 复制链接，由用户在自有渠道（邮件/微信/WhatsApp）发出（v1.1 可加 SMTP/Resend）
- 不做发票、不多币种换算、不接签名证书（typed-name 签收）
- 单机 SQLite：日活 < 数千无压力；量级上来后迁移 Postgres（数据模型已兼容）
