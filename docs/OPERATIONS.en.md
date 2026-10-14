# QuoteMint Operations Manual (for the founder)

> [中文](OPERATIONS.md) | English

> This manual is written for a non-technical founder. Day to day, only a few things need you personally; everything else can be handed to Claude. All account passwords are in the local `账号信息.md` (a copy is backed up in the private repository quotemint-ops); this manual contains no passwords.

## 0. One-Minute Overview

- **Website**: https://quotemint.dpdns.org (auto-deploy, automatic HTTPS; monthly fixed cost ¥0)
- **Support email**: support@quotemint.dpdns.org — incoming mail is **auto-forwarded to your everyday QQ mailbox**; normally just check the QQ mailbox
- **Payments**: Alipay payment QR code (shown on the site's billing page) → after receiving payment, run one activation command
- **Keys**: the passwords all live in `账号信息.md` (locally on the computer + backed up in the private repository); don't share them

## 1. Receiving an Alipay Payment (the Most Common Task)

1. You will first see a payment message in your mailbox (or in Alipay/WeChat); it states the payer's **registered email**.
2. Verify: the amount ¥68 and the registered email in the message.
3. **Activate**: open a terminal on your computer and run:

   ```
   cd D:\test\创业公司
   npm run grant <客户的注册邮箱> 12
   ```

   (`12` = activate 12 months. This command connects to the live production database; running it locally is fine.)
4. **Reply to the customer**: open https://exmail.qq.com → log in via WeChat QR scan → compose → switch the "From" to support@quotemint.dpdns.org → tell the customer "it's activated — just refresh the billing page".
5. Don't want to handle it yourself: send the payment screenshot to Claude and say "activate this email" — done.

## 2. Receiving a Customer Inquiry Email

- **Simple reply**: just reply directly in the QQ mailbox (the sender is your QQ address, representing you as an individual).
- **Want it more formal** (replying as support@): go to https://exmail.qq.com, log in via WeChat QR scan, then reply; or have Claude draft the content.
- Not sure how to reply: send the email content to Claude, have it draft a version, and you revise it.

## 3. Changing Something on the Website (Copy, Price, Features)

1. Just tell Claude "what to change".
2. After Claude edits and pushes, it goes live automatically in about 1 minute; you don't need to do anything.
3. After the change, it's recommended to click through it in the browser to confirm.

## 4. Monthly Checkup (About 10 Minutes)

- [ ] Website health probe: open https://quotemint.dpdns.org/healthz in a browser; it shows `ok` when healthy
- [ ] Netlify usage: log in to the Netlify console → Usage (the free tier provides 300 credits per month; normal usage won't run it out)
- [ ] Neon usage: log in to the Neon console and check storage/compute (the free quota is enough for the early stage)
- [ ] Glance at the numbers: signup count, quote count (you can have Claude query them for you directly)

## 5. Annual Tasks

- [ ] **Domain renewal**: `quotemint.dpdns.org` is valid until **2027-10-13**; you can renew for free in the DigitalPlat panel starting 120 days before expiry (Claude will also remind you before expiry)
- [ ] Send a test email to support@ and confirm it reaches the QQ mailbox (verifying that auto-forwarding still works)

## 6. What to Do When Something Goes Wrong

| Problem | First step | If that doesn't work |
|---|---|---|
| Website won't open | Open https://www.netlifystatus.com to see whether Netlify is down | Ask Claude to check the deploy logs |
| Email not arriving | Check the QQ mailbox's spam folder | Ask Claude to check the forwarding settings |
| Forgot a platform password | Look in `账号信息.md` | Recover GitHub with the bound email; Netlify/Neon both use "one-click GitHub login" |
| Strange charges / card-binding requests | **Stop first**, don't click anything | Ask Claude first to confirm whether it's phishing |

## 7. Security Rules (Three)

1. Don't forward or screenshot `账号信息.md` to others; it is already backed up in the private repository (visible only to you).
2. Whenever any platform asks to "transfer money / bind a bank card / pay for a subscription", ask Claude to confirm first.
3. If you later have employees/helpers, migrate the passwords to a password manager (e.g. Bitwarden free tier) before sharing; Claude can help you migrate.

## 8. Glossary

| Term | Plain-language explanation |
|---|---|
| Deploy / go live | The process of publishing new code updates to the website (done automatically after a push, about 1 minute) |
| Netlify / Neon / DigitalPlat | Free service providers for "website server / database / domain" respectively |
| Pro activation (grant) | Upgrading a registered user to the paid version (run one command after receiving payment) |
| Alias mailbox | support@ and your primary mailbox are "one key, two doors": when someone sends to support@, the mail lands in your mailbox |
| Auto-forwarding | After the mailbox receives a message, it automatically sends a copy to your everyday QQ mailbox |
