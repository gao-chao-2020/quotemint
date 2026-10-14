# QuoteMint New-Computer Migration Checklist (switch machines / operate without Claude)

> [中文](MIGRATION.md) | English

> Goal: after switching to a new computer (or even using only a phone), you can still **fully operate** QuoteMint — without the old computer, and without Claude. All day-to-day operations run in the browser, with zero installs.

## 0. Before switching computers — two things to do on the old machine

1. Confirm that `账号信息.md` has been synced to the private repository quotemint-ops (just have Claude sync it once; or run `git add -A && git commit && git push` yourself inside the `ops-repo` directory).
2. Confirm you remember how to sign in to your GitHub account (it is the starting point for recovering everything; you can reset the password via the linked email).

## 1. First stop: GitHub — get back the "key ring"

On any computer, open https://github.com in the browser → sign in → open the **private repository `quotemint-ops`** → inside is `账号信息.md` (the accounts and passwords for all platforms).

- Suggestion: download `账号信息.md` to the new computer; and note the **admin password** (see that file) in your phone's memo.
- That file is a master list of plaintext passwords; keep it only in the private repository and **do not** forward it to any public location.

## 2. Day-to-day operations (browser only, zero installs)

| What to do | Where to do it |
|---|---|
| Grant/revoke a user's Pro, view statistics | Open **https://quotemint.dpdns.org/admin** in the browser → enter the admin password (it's in `账号信息.md`) |
| Receive customer emails / payment notifications | QQ Mail (phone app or web; sign-in details in `账号信息.md`) |
| Reply to emails as support@ | exmail.qq.com → sign in by scanning the WeChat QR code |
| Verify payments received | Alipay app |

## 3. Platform sign-in quick reference

| Platform | Sign-in method | Purpose |
|---|---|---|
| GitHub | Email recovery / password (account in credentials file) | Code, credentials repository |
| Netlify | GitHub one-click sign-in | View website usage and deploy history |
| Neon | GitHub one-click sign-in | View database usage |
| DigitalPlat | Account + password (see credentials file) | Domain renewal (once a year) |
| Tencent WeCom Mailbox | WeChat QR scan | Mailbox management |
| Alipay | Phone | Payment collection |

## 4. If you need to change code (optional)

1. Install [Node.js](https://nodejs.org) (≥22) + Git on the new computer.
2. `git clone` the public repository (address at the top of the README) → `npm test` should show 150+ tests all green → `npm start` to run locally.
3. When you need AI assistance for development: install Claude Code and continue in the project directory on the new computer (the credentials were recovered in step 1).
   - Note: the local demo requires `npm run seed` (set `DEMO_MODE=true` first).

## 5. Phone-only operation (worst case)

The /admin admin menu, QQ Mail, Alipay, and WeChat QR scan — all four can be done from a phone; website administration does not depend on any computer.

## 6. If you go completely without Claude/AI (self-service boundary)

| Item | Self-service? | Tool |
|---|---|---|
| Grant/revoke Pro, view statistics | ✅ Yes | /admin |
| Send and receive support emails | ✅ Yes | QQ Mail / exmail |
| Payment collection and reconciliation | ✅ Yes | Alipay |
| Domain renewal | ✅ Yes | DigitalPlat panel |
| Check whether the website is working (health probe) | ✅ Yes | Open the website + Netlify status page |
| Change website copy/features, fix broken code | ❌ Requires a developer | Find any developer, or go back to using AI tools (the code and docs are all fully archived in GitHub) |

## 7. Suggested periodic checkup (10 minutes every quarter)

- Sign in to /admin: you can log in and the statistics are normal.
- Send yourself a test email to support@, and confirm QQ Mail can receive it.
- Open the website homepage and /healthz, and confirm they are working.
