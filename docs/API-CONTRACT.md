# QuoteMint API Contract (v1)

**FROZEN.** This document is the single source of truth for all interfaces. If you believe something must change, message the team lead — do NOT unilaterally edit this file or deviate from it.

## 0. Stack & Conventions

- Node >= 22.5, ESM (`"type":"module"`), **zero external runtime dependencies** (use `node:http`, `node:sqlite`, `node:crypto`, `node:test`, global `fetch`). Never run `npm install`.
- Start command: `npm start` → `node --no-warnings --env-file-if-exists=.env src/server.js`
- Env: `PORT` (default 3000), `BASE_URL` (default `http://localhost:3000`), `DATA_DIR` (default `./data`), `DEMO_MODE`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
- DB: SQLite file at `${DATA_DIR}/app.db`, `node:sqlite` `DatabaseSync`, WAL mode, `CREATE TABLE IF NOT EXISTS` migrations run at boot.
- Dates: ISO-8601 UTC strings (`new Date().toISOString()`). Date-only fields (`valid_until`): `YYYY-MM-DD`.
- **Money: integers in cents. All money field names end in `_cents`.** Percent fields (`discount_pct`, `tax_pct`) are numbers 0–100 (may be fractional).
- JSON responses:
  - Success: `{ "ok": true, "data": <payload> }` — HTTP 2xx.
  - Error: `{ "ok": false, "error": { "code": "<snake_code>", "message": "<human readable>" } }` — HTTP 4xx/5xx.
- All JSON responses: `Content-Type: application/json; charset=utf-8`.

## 1. Database Schema (exact)

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

`quotes.items` JSON: `[{"desc": string, "qty": number, "unit_price_cents": integer}]`

## 2. Totals Math (`src/lib/money.js`)

`computeTotals(items, discount_pct, tax_pct)` returns `{ subtotal_cents, discount_cents, tax_cents, total_cents }`:

- `line = Math.round(qty * unit_price_cents)` per item
- `subtotal_cents = sum(lines)`
- `discount_cents = Math.round(subtotal_cents * discount_pct / 100)`
- `tax_cents = Math.round((subtotal_cents - discount_cents) * tax_pct / 100)`
- `total_cents = subtotal_cents - discount_cents + tax_cents`
- Clamp both pcts to `[0,100]`. Invalid item → throw `Error`.

`formatMoney(cents, currency)` → `Intl.NumberFormat('en-US', {style:'currency', currency})`, fallback to `USD` formatting on invalid currency code.

## 3. Auth

- Password: `scryptSync`, stored as `scrypt$<saltHex>$<hashHex>`; verify with `timingSafeEqual`. Min 8 chars, max 200.
- Email: trim + lowercase; ≤254 chars; must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Session: raw token = `crypto.randomBytes(32).toString('hex')`; DB stores `sha256(token)` hex as `sessions.id`. TTL 30 days.
- Cookie: `qm_session=<token>; HttpOnly; SameSite=Lax; Path=/` + `; Secure` iff `BASE_URL` starts with `https`.
- Login with unknown email and wrong password → identical `401 invalid_credentials`.

Routes:

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{email,password,name}` (name 1–80) | `201 {data:{user}}` + Set-Cookie | `400 invalid_email/invalid_password/invalid_name`, `409 email_taken` |
| `POST /api/auth/login` | `{email,password}` | `200 {data:{user}}` + Set-Cookie | `401 invalid_credentials` |
| `POST /api/auth/logout` | — | `200 {ok:true}` clears cookie + session row | — |
| `GET /api/auth/me` | — | `200 {data:{user, quota}}` | `401 not_authenticated` |
| `PUT /api/auth/profile` | `{name?, company?, brand_color?, logo_text?}` | `200 {data:{user}}` | `401`, `400 invalid_*`, `403 pro_required` (branding fields with plan=free) |

- `name` always updatable. `company` ≤80, `logo_text` ≤40, `brand_color` must match `/^#[0-9a-fA-F]{6}$/` — these three require `plan==='pro'`.
- `user` shape: `{id, email, name, company, brand_color, logo_text, plan, plan_renews_at, created_at}` — **never** return `password_hash` or stripe ids.
- `quota` shape: `{used: <int>, max: <int|null>, resets_at: <ISO>}` — `max=null` for pro. `used` = quotes created this calendar month UTC.

## 4. Rate Limiting (`src/lib/http.js`)

In-memory sliding window per IP (fine for single process):

- `POST /api/auth/signup`, `POST /api/auth/login`: 20 req / 15 min / IP
- `POST /api/public/quotes/:token/accept`, `.../decline`: 30 req / 15 min / IP

Exceeded → `429 {code:'rate_limited'}`. Client IP: first `x-forwarded-for` entry, else socket address.

## 5. CSRF & Origin Check

- Every **mutating** request under `/api/*` and `/webhooks/*` requires header `X-Requested-With: XMLHttpRequest` → else `403 {code:'csrf'}`. (GET exempt.)
- If an `Origin` header is present, its host must equal the request `Host` header → else `403 {code:'origin'}`.

## 6. Quote Status Machine (`src/lib/quotes.js`)

```
draft --send--> sent --first public view--> viewed --accept--> accepted
                                                  \--decline--> declined
```

- **draft**: editable (`PUT`), deletable (`DELETE`), sendable. Send requires: title non-empty, client_name non-empty, ≥1 valid item → else `400 incomplete`.
- **sent/viewed**: `PUT` → `409 not_draft`; `DELETE` → `409 not_draft`. Send again → `200`, returns URL, **no status regression** (viewed stays viewed).
- **accepted/declined** (terminal): send → `409 already_final`. Public accept/decline → `409 already_final`.
- Public `GET /q/:token` records a `view` event and upgrades `sent → viewed` (sets `viewed_at`) only when status is `sent`. Drafts render with a DRAFT ribbon and record nothing.
- Events recorded: `sent` (on send), `view` (public GET), `accept`, `decline` (with optional `meta` = decline reason).

## 7. Plan Gating (`src/lib/gating.js`)

- `FREE_MONTHLY_QUOTES = 3`. Count = quotes created in current **calendar month UTC** by the user (all statuses).
- 4th creation in a month → `403 {code:'free_limit_reached'}`.
- Pro benefits: unlimited quotes; no "Powered by QuoteMint" badge on `GET /q/:token`; custom branding (company / brand_color / logo_text); `events` included in `GET /api/quotes/:id` (null for free).

## 8. Quotes API (session required)

List item shape: `{id, title, client_name, status, currency, total_cents, public_token, created_at, sent_at, viewed_at, accepted_at, valid_until, views}` — `views` = count of `view` events. Newest first.

| Method & path | Notes |
|---|---|
| `GET /api/quotes` | → `200 {data:{quotes:[...], quota}}` |
| `POST /api/quotes` | body below → `201 {data:{quote}}`; `403 free_limit_reached` |
| `GET /api/quotes/:id` | → `200 {data:{quote, totals, events}}` — `events: [{type, at, meta}]` or `null` (free). `404 not_found` if not owned. |
| `PUT /api/quotes/:id` | same body as POST → `200 {data:{quote}}`; `409 not_draft` |
| `DELETE /api/quotes/:id` | → `200 {ok:true}`; `409 not_draft` |
| `POST /api/quotes/:id/send` | → `200 {data:{quote, public_url}}`; `400 incomplete`; `409 already_final` |

Write body validation:

- `title` 1–200; `client_name` 1–120; `client_email` optional, valid email format ≤254; `currency` in `USD|EUR|GBP|CAD|AUD|CNY` (default `USD`)
- `items` 1–50; each `{desc: 1–500 chars, qty: number 0 < qty <= 100000, unit_price_cents: integer 0..1e12}`
- `discount_pct`, `tax_pct`: 0–100 (default 0); `notes`, `terms` ≤2000; `valid_until`: `YYYY-MM-DD` or null
- Invalid → `400` with specific code (`invalid_items`, `invalid_title`, etc.)

`public_url` = `${BASE_URL}/q/${public_token}`.

Full quote object (GET by id): all `quotes` columns (items parsed to array) + `totals` from `computeTotals`.

## 9. Public API (no session)

| Method & path | Notes |
|---|---|
| `GET /q/:token` | Server-rendered HTML quote page (any status; draft ribbon for drafts). |
| `POST /api/public/quotes/:token/accept` | body `{name, agree}` — `name` 1–120, `agree` must be `true`. Allowed when status `sent|viewed` → `200 {data:{status:'accepted', accepted_name, accepted_at}}`. Errors: `404`, `409 already_final`, `400 invalid_name/not_agreed`, `429`. |
| `POST /api/public/quotes/:token/decline` | body `{reason?}` ≤500. Same state rules → `200 {data:{status:'declined'}}`. |

Both mutating routes require the CSRF/origin rules from §5.

## 10. Billing

- `billingEnabled` = `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` both set. `demoMode` = `DEMO_MODE === 'true'`.
- **Boot guard**: if `NODE_ENV === 'production'` and `DEMO_MODE === 'true'` → log fatal and `process.exit(1)`.

| Method & path | Notes |
|---|---|
| `GET /app/billing` | HTML page: `renderBilling({user, billingEnabled, demoMode})` |
| `POST /api/billing/checkout` | session required → `200 {data:{url}}`. Not configured → `503 billing_disabled`. |
| `POST /api/billing/demo-upgrade` | only when demoMode → `200 {data:{user}}`, sets `plan='pro'`, `plan_renews_at=+31d`. Else `403 demo_disabled`. |
| `POST /webhooks/stripe` | raw body; verify `Stripe-Signature` `t=...,v1=...`: expected = `HMAC_SHA256(STRIPE_WEBHOOK_SECRET, `${t}.${rawBody}`)` hex, `timingSafeEqual`, reject if `|now − t| > 300s` → `400`. Missing secret → `503`. Always → `200 {received:true}` after valid signature. |

Stripe Checkout Session creation (REST via `fetch`, **form-encoded** body, `Authorization: Bearer STRIPE_SECRET_KEY`):

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

Webhook events handled:

- `checkout.session.completed` → find user by `metadata.user_id` (fallback `client_reference_id`) → `plan='pro'`, store `stripe_customer_id=session.customer`, `stripe_subscription_id=session.subscription`, `plan_renews_at = now + 31d`.
- `customer.subscription.deleted` → match by `stripe_subscription_id` → `plan='free'`, clear subscription id.
- Others: ignore.

## 11. Pages (server-rendered HTML)

| Route | Template | Auth |
|---|---|---|
| `GET /` | `renderLanding({})` | public |
| `GET /login`, `GET /signup` | `renderAuth({mode})` | public; logged-in → `302 /app` |
| `GET /app` | `renderDashboard({user, quotes, quota})` | session; else `302 /login` |
| `GET /app/quotes/new` | `renderEditor({user, quote:null, quota})` | session |
| `GET /app/quotes/:id/edit` | `renderEditor({user, quote, quota})` | session; not owned → 404 page |
| `GET /app/billing` | `renderBilling({user, billingEnabled, demoMode})` | session |
| `GET /q/:token` | `renderPublicQuote({quote, totals, branding, showBadge})` | public |
| anything unmatched | `renderError({status:404, ...})` | public |

- `branding` = `{company, brand_color, logo_text}` of quote owner.
- `showBadge` = owner plan is `free`.
- `quote` passed to templates has `items` parsed + `totals` attached where needed.

## 12. Templates (owned by frontend, consumed by backend)

All exported from `src/templates/index.js` (barrel). Shared helpers in `src/templates/layout.js`:

```js
renderLanding({})
renderAuth({mode})                       // 'login' | 'signup'
renderDashboard({user, quotes, quota})
renderEditor({user, quote, quota})       // quote may be null
renderBilling({user, billingEnabled, demoMode})
renderPublicQuote({quote, totals, branding, showBadge})
renderError({status, message})
```

- Every user-controlled value MUST be escaped via `esc()` from `layout.js` (HTML-escape `& < > " '`).
- Client-side JS must use `textContent` / `createElement` for user data — **never** `innerHTML` with user data.
- Pages reference static assets as `/styles.css`, `/app.js`, etc. (served from `public/`).

## 13. Ops

- `GET /healthz` → `200`, `text/plain`, body `ok`.
- Static: all files under `public/` served at `/` (e.g. `/styles.css`). Content types: html, css, js, mjs, svg, ico, png, jpg, webp, woff2, json, txt, xml. Path traversal guarded (resolved path must stay inside public/). `index.html` is NOT auto-served at `/`.
- Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- No CORS headers (same-origin only). JSON body limit 1MB → `413 payload_too_large`.
- Unhandled route/error → JSON error for `/api/*`, `renderError` page otherwise. No stack traces to clients; log server-side.

## 14. File Ownership (do not edit files you don't own — message the owner)

| Owner | Files |
|---|---|
| backend | `src/server.js`, `src/lib/*`, `src/routes/*`, `test/unit/*`, `scripts/seed.js` |
| frontend | `src/templates/*`, `public/*` |
| qa | `test/integration/*`, `artifacts/*` |
| brand | `marketing/*` |
| lead | `package.json`, `Dockerfile`, `README.md`, `docs/*`, `.env.example`, `.gitignore` |

## 15. Implementation Resolutions (approved by team lead, 2026-10-10)

These refine ambiguities; the frozen sections above otherwise stand as written:

1. `/webhooks/stripe` is exempt from the §5 `X-Requested-With` requirement (Stripe cannot send it; HMAC signature is the authentication for this route). Origin check still applies when an Origin header is present.
2. `accept`/`decline` on a `draft` quote → `404 not_found` (only `sent|viewed` are actionable states on the public API; drafts are not exposed as acceptable).
3. Webhook success body is the literal `{"received":true}` per §10, not the `ok`/`data` envelope.
4. `customer.subscription.deleted` also clears `plan_renews_at` (sets it to NULL) in addition to downgrading to `free`.
