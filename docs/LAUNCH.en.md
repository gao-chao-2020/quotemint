# QuoteMint Launch Checklist (Ops / Product)

> [中文](LAUNCH.md) | English

> Growth channels and the cold-start plan: [../marketing/LAUNCH.md](../marketing/LAUNCH.md).

> **Status (2026-10-14): the product is LIVE** — https://quotemint.dpdns.org (Netlify + Neon Postgres; payments = Alipay QR ¥68/year; support mailbox support@quotemint.dpdns.org live and auto-forwarding to QQ mail). This checklist was written during the self-hosted-server era: the domain/server/Stripe items in Section A are superseded by the above; Sections B (smoke), C (ops) and D (boundaries) still apply.

## A. Before deployment (one-time)

- [x] Domain: quotemint.dpdns.org is live (DigitalPlat free domain, since 2026-10-13; social-platform handles still to register — see marketing/LAUNCH.md §6)
- [ ] Server/platform ready: any 1 vCPU / 512 MB box is enough; see README for Docker
- [ ] Production `.env` values: `BASE_URL=https://<domain>`, `NODE_ENV=production`, `DEMO_MODE=false`
- [ ] HTTPS certificate (Caddy auto-issuance is easiest: `your-domain.com { reverse_proxy localhost:3000 }`)
- [ ] (Superseded by the Alipay QR flow; run only when Creem/Stripe merchant accounts are enabled later) Stripe Live mode:
  - [ ] Product + two Prices ($9/mo, $90/yr)
  - [ ] `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_PRICE_ID` (monthly Price)
  - [ ] Webhook to `https://<domain>/webhooks/stripe`, subscribing to `checkout.session.completed`, `customer.subscription.deleted`
  - [ ] `STRIPE_WEBHOOK_SECRET` (whsec_…)
- [ ] Data volume mounted and writable (Docker: `-v quotemint-data:/data`)

## B. Acceptance smoke (run on every release)

Smoke path (browser or curl):

1. `GET /healthz` → `ok`
2. Register a new account → cookie set, redirect to `/app`
3. Create a quote (decimal quantity, discount, tax) → totals match manual math
4. Send the quote → copy the client link
5. Open the client link in an incognito window → Free account shows the badge; status becomes `viewed`; wait a minute, refresh → Pro account sees two open events in the editor's Activity panel (60-second dedupe working)
6. Client types a name, ticks consent → status `accepted`, dashboard shows signer and time
7. Re-open the accepted link and accept again → terminated (409 path)
8. Print the quote page → clean A4 document (no nav/buttons/badge)
9. Free account creates a 4th quote → upgrade prompt appears
10. Test card `4242 4242 4242 4242` through Stripe Checkout → back at `?upgraded=1`, plan flips to Pro, badge gone
11. Replay `customer.subscription.deleted` from the Stripe dashboard → downgraded to Free
12. Restart the process → data persists (durability check)

## C. Operations (after launch)

- [ ] Backups: daily snapshot of the database — Postgres in production (Neon built-in history; PITR on paid tiers); SQLite when self-hosted (`sqlite3 /data/app.db ".backup /backup/app-$(date +%F).db"`, keep 14 days, one off-site copy)
- [ ] Monitoring: external ping `GET /healthz` (UptimeRobot free tier is fine); watch logs for 5xx
- [x] Inbox: support@quotemint.dpdns.org is live and auto-forwards to the operator's QQ mailbox (send + receive tested 2026-10-14)
- [ ] Data board (SQL is enough):
  - Signups: `SELECT COUNT(*) FROM users;`
  - Key weekly funnel: signup / first quote created / quote sent / accepted / upgraded
- [ ] Weekly: run the Section B smoke + check Stripe for disputes or failed charges
- [ ] Security: quarterly `npm start` to confirm no warnings; track Node LTS upgrades; keys live only in platform environment variables (Netlify in the current production) — never in the repo

## D. Known boundaries (explicitly out of scope for v1)

- No email sending: "send" = copy the link; you deliver it through your own channels (email / WeChat / WhatsApp) (v1.1 can add SMTP/Resend)
- No invoices, no multi-currency conversion, no certificate-based signatures (typed-name acceptance)
- Single-node database: fine below a few thousand daily actives; migrate upward when volume demands (the data model is already compatible — both SQLite and Postgres drivers exist)
