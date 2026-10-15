# QuoteMint

> [中文](README.md) | English

> Quote-to-cash SaaS for freelancers and small studios: **send a quote → see the moment the client opens it → get it accepted online (typed-name e-signature)**.
> Send quotes your clients actually sign.

A complete product that is already live: marketing site, signup/login, quote editor, client acceptance page, and subscription billing (Creem/Stripe adapters + Alipay QR) — all included.

## Live in production (2026-10-14)

- **Production URL**: https://quotemint.dpdns.org (brand domain; mirror: https://quotemint.netlify.app)
- **Stack**: Netlify free tier (Functions adapter in `src/lib/serverless-adapter.js`) + Neon Postgres (free tier) + free domain dpdns.org (DigitalPlat) — zero fixed cost; all account credentials and production state live in the local `账号信息.md` (not committed to git)
- **Payments**: China customers pay ¥68/year via the Alipay QR on the billing page (scan → email support@ → operator runs `npm run grant <email> 12`); overseas $9/month runs through Creem/Stripe (adapters ready, dormant until merchant accounts are approved)
- **Support mailbox**: support@quotemint.dpdns.org (Tencent Exmail; inbound mail auto-forwards to the operator's QQ mailbox)
- **Admin panel**: https://quotemint.dpdns.org/admin (grant/revoke users, browse quotes, stats, audit trail; hidden by default, password-protected; works on any computer or phone)
- **Email (2026-10-15)**: password reset, accept notifications, renewal reminders — sent via Tencent Exmail SMTP; degrades gracefully when unconfigured, never affecting the site
- **Local development**: `npm start` (set `DEMO_MODE=true` in .env, run `npm run seed` for demo accounts); tests via `npm test` (150 tests)

> The self-hosted server playbook (Docker / systemd / Cloudflare Tunnel) is archived under `deploy/` for a future migration.

## Documentation map (中文 / English)

| Doc | 中文 | English |
|---|---|---|
| Project overview | [README.md](README.md) | README.en.md (this page) |
| Product & roles guide | [docs/USAGE.md](docs/USAGE.md) | [docs/USAGE.en.md](docs/USAGE.en.md) |
| New-computer migration checklist | [docs/MIGRATION.md](docs/MIGRATION.md) | [docs/MIGRATION.en.md](docs/MIGRATION.en.md) |
| Website architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) |
| Platform inventory | [docs/PLATFORMS.md](docs/PLATFORMS.md) | [docs/PLATFORMS.en.md](docs/PLATFORMS.en.md) |
| Operations manual (non-technical) | [docs/OPERATIONS.md](docs/OPERATIONS.md) | [docs/OPERATIONS.en.md](docs/OPERATIONS.en.md) |
| Build & launch playbook | [docs/PLAYBOOK.md](docs/PLAYBOOK.md) | [docs/PLAYBOOK.en.md](docs/PLAYBOOK.en.md) |
| Launch / ops checklist | [docs/LAUNCH.md](docs/LAUNCH.md) | [docs/LAUNCH.en.md](docs/LAUNCH.en.md) |
| API contract (frozen) | [docs/API-CONTRACT.zh-CN.md](docs/API-CONTRACT.zh-CN.md) | [docs/API-CONTRACT.md](docs/API-CONTRACT.md) |
| Go-to-market plan | [marketing/LAUNCH.zh-CN.md](marketing/LAUNCH.zh-CN.md) | [marketing/LAUNCH.md](marketing/LAUNCH.md) |
| Outreach templates | [marketing/OUTREACH.zh-CN.md](marketing/OUTREACH.zh-CN.md) | [marketing/OUTREACH.md](marketing/OUTREACH.md) |
| Server-route archive | [deploy/CLOUDFLARE-TUNNEL.zh-CN.md](deploy/CLOUDFLARE-TUNNEL.zh-CN.md) | [deploy/CLOUDFLARE-TUNNEL.md](deploy/CLOUDFLARE-TUNNEL.md) |

## Business model

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | 3 quotes/month, online client acceptance, print/PDF, "Powered by QuoteMint" badge |
| Pro | $9/month or $90/year | Unlimited quotes, badge removal, custom branding (company name / logo text / brand color), full open analytics (every open recorded; timeline panel inside the editor) |

Competitors: PandaDoc $19/user/mo, Proposify $19–29/user/mo, Bidsketch from $15/mo — all priced per seat. QuoteMint is flat-priced, not per-head, focused on one job: getting quotes accepted.

## Tech stack (deliberate choices)

- **Node.js ≥ 22.5 (24.x locally), near-zero dependencies**: the core uses built-in modules only (`node:http` + `node:sqlite` + `node:crypto` + `node:test`); the single package dependency (`pg`) is needed only on the production Postgres path.
- Frontend is server-rendered HTML + vanilla JS/CSS: no build step, no CDN dependency.
- Single process + single database (SQLite locally; Postgres in production via `DATABASE_URL`) = runs on any $5/month VPS or free container platform.

## Quick start

```bash
cp .env.example .env        # Windows: copy .env.example .env
# Local demo: set DEMO_MODE=true in .env
npm run seed                # optional: seed demo data (local only; the script refuses to run in production)
npm start                   # http://localhost:3000
```

Demo accounts (after seed): `demo@quotemint.dev / demo1234!` (Free), `pro@quotemint.dev / demo1234!` (Pro).

## Tests

```bash
npm run test:unit           # unit tests (money math / auth / gating / Stripe signatures)
npm run test:integration    # integration tests (real server, end-to-end API flows)
npm test                    # everything
```

## Deployment (three options)

### 1. Docker (recommended for a VPS)

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

Data persists in the `/data` volume. Put Caddy/Nginx in front for HTTPS.

### 2. Any Node-capable platform (Render / Railway / Fly.io)

- Build: no build command; Start: `npm start`
- Same env vars; mount a persistent disk at `DATA_DIR`.

### 3. systemd (bare VPS)

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

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `BASE_URL` | `http://localhost:3000` | Public base URL; used to build client links and payment callbacks. **In production set the real https domain** (production cookies are always Secure) |
| `DATA_DIR` | `./data` | SQLite data directory |
| `DATABASE_URL` | empty | Leave empty for local SQLite; set a Postgres URL to switch to a cloud database (Neon in production) |
| `DEMO_MODE` | `false` | When `true`, shows the demo upgrade button and allows seeding; forced off under `NODE_ENV=production` (server refuses to boot otherwise) |
| `TRUST_PROXY` | empty | Set to `1` behind a reverse proxy (Caddy/Nginx) so rate limiting uses the real client IP from `X-Forwarded-For` |
| `ADMIN_PASSWORD_HASH` | — | scrypt hash of the admin panel password; combined with the secret below, enables /admin (set in Netlify in production) |
| `ADMIN_SESSION_SECRET` | — | HMAC signing secret for admin session cookies |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | — | Email sending (Tencent Exmail SMTP, port 465 implicit TLS); email features are off when unset |
| `CREEM_API_KEY` | — | Creem key; when set, billing goes through Creem (takes precedence) |
| `CREEM_PRODUCT_ID` | — | Creem Pro subscription product ID |
| `CREEM_WEBHOOK_SECRET` | — | Creem webhook signing secret |
| `CREEM_API_BASE` | official | Testing only: point the Creem API at a local stub |
| `STRIPE_SECRET_KEY` | — | Stripe key; used when Creem is absent |
| `STRIPE_PRICE_ID` | — | Stripe Pro subscription price ID |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |

## Enabling payments (Creem primary, Stripe optional)

The billing provider is auto-selected from env vars: `CREEM_API_KEY` set → Creem; otherwise Stripe keys → Stripe; otherwise billing is off.

**Creem (recommended; individuals can register, supports subscriptions, payouts via Alipay/Wise routing)**:
1. Register at creem.io with email and complete identity verification (personal ID is enough).
2. In the dashboard create a Product "QuoteMint Pro" (subscription) and copy its Product ID to `CREEM_PRODUCT_ID`.
3. Create an API key (`creem_...`) → `CREEM_API_KEY`.
4. Webhooks → Add endpoint `https://<domain>/webhooks/creem` with at least checkout-completed and subscription-cancel/expire events → copy the signing secret to `CREEM_WEBHOOK_SECRET`.
5. Run the upgrade flow once in Creem test mode → then switch to live.

> Creem merchant review requires the site to be live with a privacy policy, terms of service, and a reachable support email — the site ships `/privacy`, `/terms`, and a `support@` contact, so you can submit the domain as-is.

**Stripe (optional when you have a supported entity)**: create Product + monthly Price → `STRIPE_PRICE_ID`; point the webhook at `/webhooks/stripe` (events `checkout.session.completed`, `customer.subscription.deleted`) → verify with test card `4242 4242 4242 4242`.

## Directory structure

```
src/
  server.js          # HTTP server, routing, static files, security headers
  lib/               # db / auth / money / gating / quotes / stripe / creem / http utilities
  routes/            # auth / quotes / public / billing / pages routes
  templates/         # server-rendered pages (landing/auth/dashboard/editor/billing/quote)
  lib/serverless-adapter.js  # Netlify Functions (Lambda) bridge used in production
public/              # static assets (styles.css, page JS, favicon)
netlify/functions/   # Netlify Functions entry (thin wrapper around the adapter)
netlify.toml         # Netlify build/redirect config
test/                # unit + integration
scripts/seed.js      # demo data
scripts/grant.js     # manual Pro activation (after an Alipay payment)
marketing/           # launch playbook (channels, copy, cold-start plan)
docs/
  API-CONTRACT.md    # frozen interface contract
  LAUNCH.md          # launch checklist
  USAGE.md           # product & roles guide
  MIGRATION.md       # new-computer migration checklist
  ARCHITECTURE.md    # website architecture overview
  PLATFORMS.md       # platform inventory (each explained)
  PLAYBOOK.md        # zero-cost build & launch playbook
  OPERATIONS.md      # operations manual (non-technical)
```

## Launch checklist (short)

Full version: [docs/LAUNCH.md](docs/LAUNCH.md):

- [x] Domain live + DNS configured; `BASE_URL` set to the https domain (cookies get Secure automatically)
- [x] `.env`/platform: `DEMO_MODE=false`, `NODE_ENV=production`
- [x] Payments: Alipay QR live (¥68/year, manual activation); Creem/Stripe to be enabled after merchant approval
- [ ] Backups: daily snapshot of the database (Postgres: Neon built-in history/PITR on paid tiers; SQLite: copy the single file)
- [ ] Execute the launch channel plan in marketing/LAUNCH.md

## Security design

- Password hashing: scrypt with per-user salt; sessions are SHA-256-hashed tokens stored in the database; cookies HttpOnly + SameSite=Lax + Secure in production.
- All SQL is parameterized; all user content is HTML-escaped (server `esc()`, client `textContent`).
- Mutating requests verify `X-Requested-With` + Origin; login/signup and public acceptance endpoints are IP rate-limited.
- Stripe webhooks are HMAC-signature verified (±5-minute tolerance).
- The demo-upgrade endpoint exists only under `DEMO_MODE` and is force-disabled in production.
