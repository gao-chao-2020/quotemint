# QuoteMint Product & Roles Guide (how to use it / who uses it / how it's managed)

> [中文](USAGE.md) | English

> For the founder to grasp the product as a whole, and to help people who join later quickly understand "who uses what, how they use it, and who manages it". Technical details are in [ARCHITECTURE](ARCHITECTURE.en.md); day-to-day operations are in [OPERATIONS](OPERATIONS.en.md); the full platform table is in [PLATFORMS](PLATFORMS.en.md).

## 1. What the product is

- **URL**: https://quotemint.dpdns.org (bilingual Chinese and English, displayed automatically per the browser language, manually switchable in the top-right corner)
- **Core loop**: send a quote → the client opens it (you see the open record) → the client accepts online (typing their name is the e-signature) → print/save as PDF anytime
- **Who it's for**: freelancers and 1–3-person small studios; not aimed at enterprise sales teams

## 2. The four roles at a glance

| Role | Registration required? | What they do | Cost |
|---|---|---|---|
| **User · Free** | Yes (email + password, 1 minute) | 3 quotes a month, online client acceptance, print to PDF | ¥0 |
| **User · Pro** | Same (upgraded from Free) | Unlimited quotes, removes the "Powered by QuoteMint" badge, custom branding (company name / logo text / primary color), full open activity | ¥68/year (Alipay QR code) |
| **Client** (the person receiving the quote) | **No registration at all** | Open the link to view the quote, accept by typing their name (or decline), print and save | ¥0 |
| **Operator (founder)** | — | Take payments and activate Pro, reply to emails, run inspections | — |

> There is **no "admin backend" login role** inside the product (deliberate design: an extremely simple product run by one person). Management entry points = the various platform dashboards + Claude (see §6).

## 3. Free vs Pro

| | Free | Pro (¥68/year; overseas track at $9/month, not yet enabled) |
|---|---|---|
| Number of quotes | 3 per month | Unlimited |
| Site badge | Quote pages carry "Powered by QuoteMint" | No badge |
| Custom branding | — | Company name / logo text / primary color |
| Open activity | Basic status (sent / opened / accepted) | Full timeline (every open is recorded, visible inside the editor) |
| Activation method | — | Scan-and-pay on the billing page → send an email → the operator runs the activation command |

## 4. User journey (freelancer)

1. **Sign up**: open the website → register with email + password (no email verification needed).
2. **Create a quote**: title, client name, line items (description / quantity / unit price), discount, tax, notes & terms, validity period. Amounts are calculated in real time.
3. **Send**: click "Send" to generate a **dedicated link** (of the form `/q/<random token>`) — there is no email-sending feature; the user passes the link to the client themselves via email/WeChat (by design in v1).
4. **Wait for the open**: as soon as the client opens the link, the user can see the open record in the quote's "Activity" panel.
5. **Acceptance**: the client types their name, ticks the agreement box, and clicks accept → the status becomes "Accepted", showing the signer's name and time.
6. **Archive**: print or save as a clean A4 PDF (buttons and navigation are hidden automatically).
7. **Upgrade**: when the Free plan reaches the 4th quote of the month it reports "limit reached" → scan-and-pay ¥68/year on the billing page → email support@ → the operator activates Pro → takes effect immediately.

## 5. Client journey (signer)

- Clicking the link **requires no registration or login** — the quote page is shown directly (draft status displays a DRAFT watermark).
- **Agree**: type a name + tick to agree to the terms → click accept → the page immediately shows "Accepted" and the timestamp.
- **Disagree**: click decline, with an optional reason.
- It can be printed/saved as PDF in any status; repeated opens by the same visitor within 60 seconds are deduplicated, so it won't flood the record.

## 6. Operator (founder) view: how it's managed

| Management task | Where it's done | Frequency |
|---|---|---|
| Receiving payment notices / client emails | **QQ Mail** (support@ auto-forwards here) | A daily glance |
| Replying as support@ | exmail.qq.com, WeChat QR-code login | When there's something to do |
| Activating Pro for a customer | Send the customer's signup email to Claude saying "activate"; or run `npm run grant <email> 12` yourself (note: by default it connects to the local demo database; to activate a production user, `DATABASE_URL` must point to production — handing it to Claude is the safest) | When a payment comes in |
| Verifying payments | Alipay bill | When there's something to do |
| Website / database usage | Netlify and Neon dashboards | Occasionally |
| Domain renewal | DigitalPlat (expires 2027-10-13, free to renew) | Once a year |
| Changing anything on the website | Tell Claude directly → push → auto-deployed in about 1 minute | Anytime |

Day to day there are only two jobs: **read email + have Claude activate**. Detailed steps are in [OPERATIONS](OPERATIONS.en.md).

## 7. Data & security at a glance

- User and quote data is stored in cloud Neon Postgres; local development uses SQLite, and the two do not affect each other.
- Acceptance is a **typed-name e-signature** (v1 does not do certificate-grade signing), recording the name + timestamp as evidence.
- On the client side there is no registration and no tracking pixel; open records only tally "open time and number of opens".
- Passwords are stored encrypted and session tokens are hashed; the public repository contains no credentials (see the security sections of API-CONTRACT and PLAYBOOK for details).

## 8. Related docs

| Want to learn about | Read this |
|---|---|
| Product technical architecture | [ARCHITECTURE.en.md](ARCHITECTURE.en.md) |
| Day-to-day operations | [OPERATIONS.en.md](OPERATIONS.en.md) |
| Full platform-account table | [PLATFORMS.en.md](PLATFORMS.en.md) |
| API and data details | [API-CONTRACT.md](API-CONTRACT.md) |
| Site-building experience and replication | [PLAYBOOK.en.md](PLAYBOOK.en.md) |
