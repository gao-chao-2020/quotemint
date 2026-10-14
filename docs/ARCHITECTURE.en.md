# QuoteMint Website Architecture

> [中文](ARCHITECTURE.md) | English

> This document describes QuoteMint's **complete architecture in live operation**: from a user opening a browser to data landing in the database, and how email and payments flow. It is written for the founder to read, and can also serve as a quick onboarding guide for technical people who take over in the future. Interface details (fields / status codes / table schemas) are governed by the frozen [API-CONTRACT](API-CONTRACT.md); for the selection process and pitfalls hit, see [PLAYBOOK](PLAYBOOK.en.md).

## 1. Architecture in One Sentence

A **zero-dependency, single-codebase Node.js application**: in development it runs on your own machine (SQLite); in production it runs on Netlify's functions platform (Node 22 on AWS Lambda) + Neon cloud Postgres. Users reach it through the branded domain; support email goes through Tencent business email with auto-forwarding; payments go through an Alipay payment QR code + manual activation. **Monthly fixed cost: ¥0.**

## 2. The Full Picture

```
User browser (PC / mobile, Chinese & English)
        │  HTTPS
        ▼
quotemint.dpdns.org ── DNS at DigitalPlat:
        │                @ A 75.2.60.5 (Netlify entry point)
        │                www CNAME → quotemint.netlify.app. (301 to the main domain)
        ▼
Netlify (free tier, global CDN + automatic HTTPS)
   ├── Static assets public/* (styles.css, per-page scripts, icons, Alipay payment QR code image) → served straight from CDN
   └── All other paths 200-rewritten → Netlify Function "server" (Lambda, Node 22)
            │
            ▼
       netlify/functions/server.mjs          ← thin entry point (wrapping only)
            │
       src/lib/serverless-adapter.js         ← the key adapter layer:
            │                                    Lambda event ⇄ node:http req/res bridge
            │                                    (multiple Set-Cookie via multiValueHeaders)
            ▼
       src/server.js                          ← the application itself (HTTP server)
            ├── src/routes/*      routes: auth / quotes / public / billing / pages
            ├── src/templates/*   server-rendered HTML (bilingual i18n, everything escaped)
            └── src/lib/*         business libraries: db / auth / money / gating / quotes /
                                  http / billing / stripe / creem / paths
            │
            ▼
       src/lib/db.js                          ← dual-driver database (auto-selected by environment)
            ├── With DATABASE_URL → pg driver → Neon Postgres (US East, encrypted connection, connection pool)
            └── Without DATABASE_URL → node:sqlite → local data/app.db (for development / self-hosting)
            (same SQL either way: placeholders auto-translated ? → $n)

Side systems (independent of the website):
   Email: customer → support@quotemint.dpdns.org (Tencent WeCom Mail)
         → alias delivers straight into the operator's primary mailbox → auto-forwards to the operator's QQ mailbox
   Payments: customer scans the "Alipay payment QR code" (static image in public/) → the operator runs scripts/grant.js
         → connects directly to Neon to upgrade that user to Pro
   Deploy: local git push → GitHub (public repository) → Netlify builds automatically (esbuild bundles the function)
         → live worldwide (about 12–20 seconds)
```

## 3. Lifecycle of a Single Request (Example: "Customer Opens a Quote")

1. The customer opens the link `https://quotemint.dpdns.org/q/<token>`.
2. DNS resolves to Netlify's load balancing; static files are served straight from the CDN first, while `/q/<token>` is a dynamic path → 200-rewritten to the function.
3. The Lambda receives the event (cold start or reuse of a warm instance) → the adapter layer wraps the event into a standard `node:http` request → `src/server.js` routes to the public page handler.
4. The handler queries Neon: validates the token, reads the quote, and records one "open event" (deduplicated for the same visitor within 60 seconds).
5. The customer page is server-rendered (Chinese/English based on the browser language, all content escaped) → HTML is returned.
6. The customer enters their name, ticks the agreement box and accepts → POST to the public API → the status is updated to accepted within a transaction → the page displays the acceptor and the timestamp.

## 4. Tech Stack and Rationale

| Layer | Choice | Rationale |
|---|---|---|
| Language / runtime | Node.js (pinned to 22 in production, 24 locally) | Flag-free `node:sqlite` needs ≥22.13; the built-in modules suffice, near-zero dependencies |
| Web framework | No framework: `node:http` + server-rendered HTML + vanilla JS | No build step, minimal cold start, decade-level stability |
| Database | Local SQLite / Neon Postgres in production (dual driver) | Zero configuration locally; free in the cloud, maintenance-free, automatic backup history |
| Hosting | Netlify free tier + Functions v1 adapter layer | Free, commercial use allowed, global CDN, automatic HTTPS |
| Business email | Tencent WeCom Mail (alias + auto-forwarding) | Free, usable from mainland China, managed by scanning a QR code in WeChat |
| Payments | Alipay payment QR code + manual activation; Creem/Stripe adapters pre-wired for the USD market (dormant, env-gated) | Works for an individual with no card; a balance between compliance and automation |
| Domain / DNS | DigitalPlat free domain + hosted DNS | Zero cost, free renewal every year |

## 5. Code Map (Which Part Does What)

```
src/
  server.js                        Entry: route table, security headers, cookies, static files, rate-limit mounting
  lib/
    serverless-adapter.js          Production-critical: Lambda event ⇄ node:http bridge (production only)
    paths.js                       Bundler-compatible path resolution (a production hotfix artifact, don't touch lightly)
    db.js                          Dual-driver database (lazy-loaded sqlite / pg, SQL placeholder translation)
    auth.js                        Salted scrypt passwords, database-backed session tokens, cookie policy
    quotes.js                      Quote CRUD and state machine: draft → sent → viewed → accepted
    money.js                       Money math (stored in "cents", discount/tax/multi-currency display)
    gating.js                      Plan limits: Free = 3 per month; Pro auto-downgrades at expiry
    http.js                        Request parsing, CSRF/Origin validation, IP rate limiting
    billing.js / stripe.js / creem.js   Billing orchestration and the two provider adapters (dormant, standby)
  routes/
    auth.js / quotes.js / public.js / billing.js / pages.js   Routes split by domain
  templates/
    layout / landing / auth / dashboard / editor / billing /  Server-side rendering of every page
    publicquote / legal / …; i18n.js + dict-*.js              Chinese/English dictionaries and switching
netlify/
  functions/server.mjs             Production function entry (thin wrapper)
netlify.toml                       Platform config: publish=public, rewrite to the function, NODE_VERSION=22
public/                            Static assets (styles, page scripts, favicon, Alipay payment QR code)
scripts/seed.js                    Local demo data; scripts/grant.js = manual Pro activation (connects to the production DB)
test/                              148 unit + integration tests (npm test)
```

## 6. Where the Data Lives ("Where Is My Data")

| Data | Where it lives | Notes |
|---|---|---|
| Users, quotes, acceptances, open records | **Neon Postgres** (cloud, TLS connection) | The only data source in production; viewable in the Neon console |
| Local development data | Local `data/app.db` (SQLite) | Fully isolated from production |
| Page images and other static assets | The code repository `public/` (public on GitHub) | No user-upload feature yet |
| Email | Tencent business mailbox servers + the auto-forwarded copy (the operator's QQ mailbox) | The original stays in the mailbox |
| Payment records | Alipay statements (matched by hand); the in-system Pro status is written to Neon by the activation command | No separate payments table |

## 7. Security Design (Boundaries and Mechanisms)

- **Entry boundary**: every request first passes through the security headers and routing in `src/server.js`; production secrets exist only in platform environment variables (Netlify) and never land in code.
- Passwords are salted with scrypt; sessions are SHA-256 tokens stored in the database; cookies are HttpOnly + SameSite=Lax + Secure in production.
- All SQL is parameterized; all user content is HTML-escaped (server-side `esc()`, client-side `textContent`) — guards against injection/XSS.
- Mutating requests validate `X-Requested-With` + Origin (CSRF protection); login/sign-up/public acceptance have IP rate limiting (behind the reverse proxy, `TRUST_PROXY=1` is used to obtain the real IP).
- Stripe/Creem webhooks use HMAC signature verification (±5 minutes tolerance); the demo upgrade endpoint exists only under `DEMO_MODE` and is forcibly disabled in production.
- Domain single point: DNS is hosted under the DigitalPlat account — protect that account well (see the credentials file in the private repository).

## 8. Availability and Fault Tolerance

- Netlify handles the CDN, HTTPS, and function scaling (no server operations); Neon handles database high availability and backup history.
- Function cold start: the first request may take a few hundred milliseconds longer; afterwards warm instances are reused.
- Single-point risk: an outage at Netlify or Neon takes the site down (the free tier's SLA is limited); external health probes (`/healthz`) are the answer for monitoring; the migration path is ready (the `deploy/` runbook + dual-driver database), so a quick switch to a self-hosted server or a paid tier is possible.

## 9. Architecture Evolution Path (What to Do When It Grows Up)

1. **Traffic growth**: Netlify's free 300 credits/month are not enough → upgrade to a paid tier, or migrate back to a self-hosted server following the `deploy/` runbook (zero code changes).
2. **Database growth**: upgrade Neon straight to a paid tier (zero code changes).
3. **Payment automation**: apply for a Creem merchant account → configuring 3 environment variables enables it (the adapter is already built in).
4. **Team expansion**: add email aliases; move passwords into a password manager before sharing them.

## 10. Relationship to Other Documents

| What you want to know | Which one to read |
|---|---|
| Interface details: routes, fields, status codes, table schemas | [API-CONTRACT.md](API-CONTRACT.md) (frozen) |
| Why the choices were made, which pitfalls were hit | [PLAYBOOK.en.md](PLAYBOOK.en.md) |
| Deployment acceptance and routine operations checklists | [LAUNCH.en.md](LAUNCH.en.md) |
| What to do every day (non-technical edition) | [OPERATIONS.en.md](OPERATIONS.en.md) |
