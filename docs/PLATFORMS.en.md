# QuoteMint Platform Inventory (every platform we use, explained)

> [中文](PLATFORMS.md) | English

> A one-by-one list of every platform this project uses: what it's for, why we chose it, free quota, gotchas, and what you (the founder) need to do with it. **Passwords and specific account details are in the local `账号信息.md`** (a copy is backed up in the private repo quotemint-ops); this file contains no passwords.

## Summary table

| # | Platform | Purpose | Status | Cost | What you usually do |
|---|---|---|---|---|---|
| 1 | GitHub | Code repo + private credential repo | In use (core) | Free | Usually nothing; code changes are pushed by Claude |
| 2 | Netlify | Website hosting (production) | In use (core) | Free tier | Occasionally glance at usage |
| 3 | Neon | Production database | In use (core) | Free tier | Occasionally glance at usage |
| 4 | DigitalPlat | Domain + DNS | In use (core) | Permanently free | Renew the domain once a year |
| 5 | Tencent WeCom Mail | Customer support mailbox support@ | In use | Free tier | Reply to customer emails (exmail.qq.com WeChat QR scan) |
| 6 | WeChat | Identity verification hub | In use | Free | Scan whenever a QR code is requested |
| 7 | QQ Mail | Daily inbox (receives forwarded support emails) | In use | Free | Check email every day |
| 8 | Alipay | Payments | In use | Personal QR code, 0 fees | After receiving payment, have Claude enable Pro |
| 9 | Creem | Overseas automatic payments | Dormant/standby | Not enabled | Nothing to do for now |
| 10 | Stripe | Overseas payments backup | Dormant/standby | Not enabled | Same as above |
| 11 | Render | Hosting platform we once tried | Parked | — | Ignore it |
| 12 | Cloudflare | Tunnel backup route | Parked (handbook archived) | Free | Ignore it |
| 13 | Hugging Face / Koyeb / HelioHost | Ruled out in selection | Ruled out | — | Ignore it |

## How the platforms relate to each other

```
WeChat (identity hub: sign-up / sign-in / verification)
   ├→ Tencent WeCom Mail support@ ──auto-forward──→ QQ Mail (what you check daily)
   ├→ DigitalPlat domain panel (sign-up and renewal require QR scan / verification)
   └→ (at activation) WeCom registration

Local dev machine ──git push──→ GitHub ──auto build & deploy──→ Netlify ──read/write data──→ Neon
                                      │
                               private repo quotemint-ops (credential backup, visible only to you)

Customer ──scan QR to pay──→ Alipay (you verify manually) ──→ grant command scripts/grant ──writes──→ Neon (upgrade to Pro)
```

## Platforms in use (one by one)

### 1. GitHub — code hosting + deployment source
- URL https://github.com | account name in the private credentials doc
- Two repos: **public** `quotemint` (all code and docs); **private** `quotemint-ops` (account credential backup, visible only to you)
- After you push code, Netlify goes live automatically — it is the starting point of the whole deployment chain
- Free unlimited private/public repos; SSH key already configured on this machine (passwordless push)

### 2. Netlify — website hosting (production)
- URL https://app.netlify.com | **one-click sign-in via GitHub**
- Responsibility: host the live website + run backend functions + automatic HTTPS; all secrets live in its "environment variables"
- Free tier: 300 credits per month (normal usage comes nowhere near using it up); backup address `quotemint.netlify.app`
- Note: a plain value in a repo file that shares a name with a secret triggers a "secret scan" false block (exemption already set, do not delete it)

### 3. Neon — production database
- URL https://console.neon.tech | **one-click sign-in via GitHub**
- Responsibility: stores all production data (users, quotes, sign-offs, open records)
- Free tier: quota is enough for the early stage; cloud-hosted, zero ops, has historical backups; can upgrade to a paid tier later (zero code changes)

### 4. DigitalPlat — free domain and DNS
- URL https://dashboard.digitalplat.org
- Domain `quotemint.dpdns.org`: permanently free, **expires 2027-10-13, free renewal available up to 120 days before expiry**
- DNS is hosted here: the A record points to Netlify, www redirects, and the mail MX/SPF records are also maintained here
- Note: CNAME values must have a **trailing dot** (otherwise the suffix gets auto-appended incorrectly); panel API changes need a CSRF header (Claude handles it)

### 5. Tencent WeCom Mail — customer support mailbox
- Admin https://work.weixin.qq.com | read/reply https://exmail.qq.com (WeChat QR sign-in)
- `support@quotemint.dpdns.org` = primary mailbox **alias** + **auto-forward** to your QQ Mail
- Note: **one WeChat can only bind one enterprise mailbox** — this is exactly why we switched to the "alias approach"

### 6. WeChat — identity verification hub
- It is not a website component itself, but sign-up/sign-in/verification use its QR scan everywhere (WeCom, exmail, DigitalPlat)
- **Protect your phone and WeChat**: it is the master key to multiple platforms

### 7. QQ Mail — your daily inbox
- Customer emails and payment notifications are all **auto-forwarded** here; day to day, just check QQ Mail
- You only need to go to exmail.qq.com and scan when replying officially as support@

### 8. Alipay — payments
- The payment QR code is displayed on the website billing page (the image lives in the code repo under public/)
- Personal payment QR code: 0 fees; note: collecting business payments long-term carries compliance risk — once volume picks up, switch to a **merchant QR code** or enable Creem

## Standby / dormant platforms (code ready, not enabled yet)

### 9. Creem — overseas automatic payments (preferred standby)
- $9/month subscription billing for overseas customers; the code adapter is already built in
- How to enable: later, once you apply for a merchant account, just configure 3 environment variables (no code changes needed)

### 10. Stripe — overseas payments backup
- The code supports it as well; mainland individuals have no compliant entity, so for now we only keep compatibility and perform no operations

## Parked / ruled out (archived for reference, to avoid dead ends)

### 11. Render — parked
- We once planned to host with it; from 2026 the free tier **mandates linking an international bank card** → abandoned (config archived in `render.yaml`)

### 12. Cloudflare — parked
- The handbook for the "trial server + Cloudflare Tunnel" backup route is archived in `deploy/CLOUDFLARE-TUNNEL.md`; current production does not need it

### 13. The three ruled-out platforms (recorded in PLAYBOOK)
- **Hugging Face Spaces**: main site is blocked
- **Koyeb**: service frozen after acquisition
- **HelioHost**: free tier forbids commercial use

## Platforms you may need to sign in to (by frequency)

| Frequency | Platform | What to do |
|---|---|---|
| Daily | QQ Mail | Check customer emails and payment notifications |
| When needed | exmail.qq.com (QR scan) / Alipay | Reply as support@ / verify payments |
| Once or twice a year | DigitalPlat | Renew the domain |
| Occasionally | Netlify / Neon console | Check usage |
| Everything else | Leave it to Claude | — |
