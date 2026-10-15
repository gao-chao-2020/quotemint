# QuoteMint Zero-Cost Build & Launch Playbook

> [中文](PLAYBOOK.md) | English

> A record of the full experience of going from zero to launch in 2026-10: the routes taken, the options ruled out, the pitfalls hit, and the reusable practices. It serves both as a retrospective for this project and as a replication manual for the next one.

## 1. Constraints and Final Conclusion

- **Constraints**: zero funding; don't use your own computer as a server; target the overseas English market while also being reachable from mainland China networks; the founder intervenes only at "human steps" (SMS / QR scan / CAPTCHA) — everything else is fully automated.
- **Final architecture (monthly fixed cost ¥0)**:

| Layer | Adopted solution | Notes |
|---|---|---|
| Website hosting | Netlify free tier | Auto-deploy on GitHub push, automatic HTTPS, commercial use allowed |
| Database | Neon Postgres free tier | Cloud-hosted, maintenance-free; local development uses SQLite via a dual driver |
| Domain | DigitalPlat free domain `quotemint.dpdns.org` | Free renewal every year; DNS hosted at DigitalPlat |
| Business email | Tencent WeCom Mail | support@ is an alias of the primary mailbox; incoming mail auto-forwards to the everyday mailbox |
| Payments | Alipay personal payment QR code + manual activation | No card, no platform commission; overseas payment collection (Creem) code is pre-wired |
| Code hosting | GitHub | Public main repository; credentials kept separately in a private repository (see §9) |

- **The three gates of platform selection (core judgment)**: any "free" platform must pass three gates before you commit — ① **payment method** (does it require an international bank card?); ② **network reachability** (can it be registered and accessed from within China?); ③ **commercial terms** (does the free tier allow commercial use?). If it fails any gate, don't use it no matter how large the free quota.

## 2. Selection Rejections (Why Not Them)

| Platform / Route | Outcome | Reason |
|---|---|---|
| Render | Rejected | Free tier requires binding an international bank card starting 2026 (blocked in live testing) |
| Hugging Face Spaces | Rejected | Main site blocked in China; cannot register/manage |
| Koyeb | Rejected | Console frozen after acquisition, unusable |
| HelioHost | Rejected | Free-plan TOS explicitly forbids commercial use |
| Cloud provider "free trial" lightweight server + Cloudflare Tunnel | Backup option, not pursued | Trial period is only 1–3 months and migration is required at expiry; the runbook is archived in `deploy/` for future reuse |
| **Netlify + Neon + DigitalPlat** | **✅ Adopted** | No card, commercial use allowed, reachable from within China, free quota more than enough for the early stage |

## 3. Core Skill Recipes (Reusable)

### 3.1 Getting a "Zero-Dependency node:http App" to Run on Netlify Functions

- Approach: write a thin **Functions v1 adapter** (`src/lib/serverless-adapter.js`) that bridges the Lambda event into node:http's `req`/`res`; **multiple Set-Cookie headers must go through `multiValueHeaders`** (v1 is the only mechanism confirmed by the documentation); the whole thing is a thin entry (`netlify/functions/server.mjs`) that requires the application itself.
- `netlify.toml` key points: `publish = "public"`; the catch-all uses a **200 rewrite** (`/* -> /.netlify/functions/server`, do not force, so static files take priority).
- Value: get a single-process node:http app onto serverless for free without changing any application code.

### 3.2 The Bundling Pitfall (Post-Mortem of the First-Deploy Crash, the Most Important Lesson)

- Symptom: the deployment succeeds, but the function crashes the moment the module loads: `TypeError: Invalid URL`.
- Cause: **after esbuild bundles ESM into CJS, `import.meta.url` is empty**, while the code computes paths at the module top level with `new URL(...)`.
- Fix: make path resolution **lazy + guarded** (`src/lib/paths.js`: when `import.meta.url` is empty, fall back to `process.env.LAMBDA_TASK_ROOT` / `process.cwd()`).
- General lesson: in any **serverless platform + bundler** setting, every "module-load-time" assumption about paths/environment must be re-checked.

### 3.3 Netlify Secret-Scan False Positive

- Symptom: the deployment is blocked with a detected-secret warning — when really it was just ordinary values of `NODE_ENV` / `BASE_URL` that appeared in a repository file.
- Fix: set the environment variable `SECRETS_SCAN_OMIT_KEYS=NODE_ENV,BASE_URL`.

### 3.4 Dual-Driver Database (Seamless Switching Between Local Dev / Cloud Production)

- `DATABASE_URL` set → uses Postgres (Neon); unset → uses local SQLite. One set of code, one set of tests.
- Details: SQL placeholders auto-translated (`?` → `$n`); quota-type transactions use an advisory lock; drivers are **lazy-loaded** (one fewer import on serverless cold start).

### 3.5 Git Push Means Deploy

- Push `master` to GitHub → Netlify auto-builds (~12 seconds) → live. Documentation-only commits also trigger a harmless deploy.

## 4. Domain & DNS Skills (DigitalPlat + Netlify)

- Free domains: DigitalPlat (`dpdns.org` and other suffixes); KYC goes through GitHub OAuth; the registration flow requires a phone number.
- Key records:
  - `@ A 75.2.60.5` (Netlify load-balancer entry)
  - `www CNAME quotemint.netlify.app.` — **the value must keep the trailing dot!** Otherwise the platform appends the zone suffix (turning it into `xxx.quotemint.dpdns.org.`), producing a wrong record that is very hard to self-diagnose.
- Panel API notes: change requests must carry the `X-CSRF-Token` header (= the value of the `panel_csrf_token` cookie); the **MX record format** writes the value as `"5 mxbiz1.qq.com."` — the priority is embedded in the value; a separate `priority` field reports `invalid_record_value`.
- HTTPS: once the records take effect, Netlify automatically issues a Let's Encrypt certificate; `www` auto-301s to the primary domain.

## 5. Free Business Email Skills (Tencent WeCom Mail)

- Setup path: register WeCom (WeChat QR scan) → "Mail" → submit the domain → add the DNS records as instructed → verification passes → create the mailbox.
- Required records: MX `mxbiz1.qq.com` (priority 5), `mxbiz2.qq.com` (10); CNAME `qqmail<number>` → `mail.qq.com`; SPF recommended: `v=spf1 include:spf.mail.qq.com ~all`.
- **Biggest limitation: one WeChat account can bind/activate only one business-mailbox account.** Once the admin's WeChat is bound to the primary mailbox, a standalone member mailbox cannot be activated.
- **Adopted alternative: the mailbox alias.** Set support@ as an **alias** of the primary mailbox — customer mail goes straight into the primary mailbox; then enable "auto-forward" to send the mail on to your everyday mailbox. Day-to-day, "reading support@" = doing nothing.
- Enabling auto-forward requires two verifications: **a WeChat QR scan** inside the mailbox + **clicking the confirmation link in the target mailbox** (both require a real person).
- How to verify inbound mail: a) a loopback test (send to yourself from yourself); b) have an external mailbox (e.g. QQ) reply — only an external send/receive round trip counts as fully verified.
- Backup reading entry: log in to `exmail.qq.com` via WeChat QR scan (you can switch to the support@ alias identity to send mail).

## 6. Zero-Card Payment-Collection Skills (Mainland China)

- Approach: **Alipay personal payment QR code + manual activation**. The customer scans the code on the billing page to pay → emails per the page instructions → the operator runs `npm run grant <邮箱> 12` (the script connects to the production database) → the user is upgraded to Pro.
- Why chosen this way: Stripe / LemonSqueezy are unavailable to mainland-China individuals; Creem permits individual registration (the code adapter is already built in, dormant behind an env gate; apply to enable it once volume grows).
- Compliance reminder: using a personal payment QR code for sustained business collection carries a risk of being restricted; once volume grows, switch to a "merchant code" or enable Creem.

## 7. Account Registration Automation Experience

- Fully automatable (browser automation + the user's real Chrome login session): one-click GitHub OAuth sign-up/sign-in — Netlify, Neon, and DigitalPlat (KYC) all go this way.
- "Human steps" that require a real person: SMS verification codes, WeChat QR scans, image CAPTCHAs (Tencent/hCaptcha), sliders.
- Unusable from within China: Google-family CAPTCHAs (sign-up flows must avoid Google reCAPTCHA); pages should avoid depending on Google-family resources (e.g. analytics.js).
- Pacing advice: route everything that can go through OAuth through OAuth; the user appears only at the human steps, everything else is automated.

## 8. Pitfall Checklist (Symptom → Cause → Fix)

| Symptom | Cause | Fix |
|---|---|---|
| Cannot activate Render free tier | Mandatory international bank card | Switch platforms (one of this project's three selection gates) |
| First-deploy function crash: Invalid URL | `import.meta.url` empty after bundling (§3.2) | Lazy loading + LAMBDA_TASK_ROOT fallback |
| Deploy blocked by secrets scan | False positive on NODE_ENV/BASE_URL literals | `SECRETS_SCAN_OMIT_KEYS` |
| www domain resolves wrong (long tail appended) | CNAME value missing the trailing dot | Resubmit with a trailing dot in the value (§4) |
| DNS panel API change errors/rejected | Missing CSRF header | Include `X-CSRF-Token` (= cookie value) |
| Adding MX record rejected: invalid_record_value | Priority placed in the separate field | Embed the priority in the value: `"5 主机名."` |
| Standalone support mailbox cannot be activated | One WeChat can bind only one business mailbox | Switch to the **alias** approach (§5) |
| Auto-forward stuck at "waiting for verification" | Confirmation link not clicked in the target mailbox | Click confirm in the target mailbox (+ WeChat QR scan in the mailbox) |
| DigitalPlat registration gets reset | Occasional from within China on the GitHub OAuth path | Retry; or register with username + password (requires a phone number) |
| Form automation can't fill values | React/Vue forms don't respond to fill | Type key by key (pressSequentially) to trigger events |

## 9. Principles for Keeping Credentials and Documents

- **The public repository holds code and documents only — never passwords/connection strings.** The password file (`账号信息.md`) is always gitignored, with a copy kept separately in a **private repository** (GitHub Private, visible only to you).
- All documents are **bilingual (Chinese + English)**, with paired files cross-linked at the top; "English copy that will actually be published" keeps the original English in the Chinese version, with a Chinese parallel text alongside.
- Suggestion: once things scale up, migrate the passwords into a password manager (e.g. Bitwarden free tier); Claude can help with the migration.

## 10. Next-Time Replication Checklist (Execute in Order)

1. **Selection**: hosting + database, screened by the "three gates" (card / network / commercial use).
2. **Registration order**: GitHub → hosting platform (OAuth) → database (OAuth) → domain (confirm the free tier first) → business email.
3. **Domain DNS**: A / CNAME (mind the trailing dot) → wait for certificate issuance → www redirect.
4. **Email**: MX + SPF + CNAME → alias or member mailbox → enable forwarding → two-way live test (send + receive).
5. **Payments**: start with "payment QR code + manual activation via script", with the automatic-payment adapter pre-wired.
6. **Deploy**: push means live; on the first deploy, watch the function logs (bundling pitfall, §3.2).
7. **Acceptance test**: the full chain sign-up → create quote → send → acceptance; one payment activation; one email send and one receive.
8. **Wrap-up**: credentials into the private repository; all documents bilingual; write the lessons back into this playbook.

## 11. Key Timeline for This Project (Archived)

- **2026-10-10**: Product complete (all 148 tests green at the time; test suite now at 204 — bilingual Chinese/English, security hardened).
- **2026-10-13**: Launched on Netlify + Neon; branded domain `quotemint.dpdns.org` live (HTTPS all green, www 301); full-chain e2e test passed.
- **2026-10-14**: Alipay payment QR code live (¥68/year); support@ mailbox fully working (alias + QQ auto-forward, two-way send/receive tested); all documents bilingual; private ops repository `quotemint-ops` created.
- **2026-10-15**: Hidden admin panel `/admin` live (Pro grant/revoke, quotes browsing, stats, audit); email capability shipped (zero-dep SMTP client, password reset, accept notifications, renewal reminders) with Tencent Exmail SMTP configured and send verified live; UptimeRobot uptime monitoring with email alerts; dev-session permission allowlist.
