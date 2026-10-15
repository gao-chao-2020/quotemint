// Admin panel core: env gate, stateless signed session token, password verify,
// and the shared Pro grant/revoke operations used by both the web panel
// (src/routes/admin.js) and the CLI (scripts/grant.js).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, parseCookies } from './http.js';
import { verifyPassword } from './auth.js';
import { sendMail } from './mailer.js';

export const ADMIN_COOKIE = 'qm_admin';
const TOKEN_VERSION = 'v1';
const ADMIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Both env vars must be set; anything less keeps every /admin path a plain 404.
export function adminEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH) && Boolean(process.env.ADMIN_SESSION_SECRET);
}

export function normalizeAdminEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function adminSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || '');
}

// Stateless token: <expMs>.<hmacSha256Hex(secret, 'v1:'+expMs)>. Read env at
// call time so tests and long-lived processes pick up late-set variables.
export function signAdminToken(expMs) {
  const exp = String(expMs);
  const signature = createHmac('sha256', adminSecret()).update(`${TOKEN_VERSION}:${exp}`).digest('hex');
  return `${exp}.${signature}`;
}

export function verifyAdminToken(token) {
  const secret = adminSecret();
  // Fail closed: empty-key HMACs would otherwise validate tokens signed with the same empty key.
  if (!secret) return false;
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  if (!/^[0-9]{1,16}$/.test(exp)) return false;
  if (Number(exp) <= Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`${TOKEN_VERSION}:${exp}`).digest('hex');
  const given = Buffer.from(token.slice(dot + 1), 'hex');
  const want = Buffer.from(expected, 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}

export function setAdminCookie(res, baseUrl) {
  const secure =
    String(baseUrl || '').startsWith('https') || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const token = signAdminToken(Date.now() + ADMIN_TTL_MS);
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${Math.floor(ADMIN_TTL_MS / 1000)}${secure}`
  );
}

export function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`);
}

export function isAdminAuthed(req) {
  return verifyAdminToken(parseCookies(req)[ADMIN_COOKIE]);
}

export function verifyAdminPassword(password) {
  return verifyPassword(String(password ?? ''), String(process.env.ADMIN_PASSWORD_HASH || ''));
}

// Grants Pro; months added to the active renewal date when one is in the
// future, otherwise from now (identical to the original CLI semantics).
export async function grantPro(db, email, months) {
  const target = normalizeAdminEmail(email);
  const user = await db.get('SELECT id, plan_renews_at FROM users WHERE email = ?', target);
  if (!user) throw new HttpError(404, 'user_not_found', 'No account found for this email');
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new HttpError(400, 'invalid_months', 'months must be a whole number between 1 and 120');
  }
  const now = Date.now();
  const current = user.plan_renews_at ? Date.parse(user.plan_renews_at) : NaN;
  const active = Number.isFinite(current) && current > now;
  const base = new Date(active ? current : now);
  base.setUTCMonth(base.getUTCMonth() + months);
  const renewsAt = base.toISOString();
  await db.transaction(async () => {
    await db.run(`UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE id = ?`, renewsAt, user.id);
    await recordAdminEvent(db, 'grant', target, String(months));
  });
  return { renews_at: renewsAt, extended: active, previous_renews_at: user.plan_renews_at || null };
}

export async function revokePro(db, email) {
  const target = normalizeAdminEmail(email);
  const user = await db.get('SELECT id FROM users WHERE email = ?', target);
  if (!user) throw new HttpError(404, 'user_not_found', 'No account found for this email');
  await db.transaction(async () => {
    await db.run(`UPDATE users SET plan = 'free', plan_renews_at = NULL WHERE id = ?`, user.id);
    await recordAdminEvent(db, 'revoke', target, '');
  });
}

const SUPPORT_EMAIL = 'support@quotemint.dpdns.org';

// Same bilingual plain-text shape as the password-reset mail (routes/auth.js):
// EN section first, ZH section second.
function renewalReminderText({ renewsDate, billingUrl }) {
  return [
    'Your QuoteMint Pro plan is due for renewal.',
    '你的 QuoteMint 专业版即将到期，请及时续费。',
    '',
    `Renewal date (UTC): ${renewsDate}`,
    `到期日期（UTC）：${renewsDate}`,
    '',
    'Renew before that date to keep unlimited quotes, custom branding, and full analytics.',
    '在到期日前完成续费，即可继续享受不限量报价单、自定义品牌和完整的打开分析。',
    '',
    'How to renew:',
    '续费方式：',
    'Alipay (China): scan the payment QR code on the billing page and pay ¥68/year.',
    '支付宝（中国）：在订阅页扫码支付 ¥68/年。',
    `Outside China or need help: email ${SUPPORT_EMAIL} with your account email address.`,
    `其他地区或需要协助：发送邮件至 ${SUPPORT_EMAIL}，注明你的注册邮箱。`,
    '',
    'Open the billing page:',
    '打开订阅页面：',
    '',
    billingUrl,
    '',
    'You are receiving this email because your QuoteMint account is on the Pro plan.',
    '你收到此邮件是因为你的 QuoteMint 账户正在使用专业版。'
  ].join('\n');
}

// Emails the Pro renewal reminder and records the audit row. Mail failures
// surface as MailError (an HttpError subclass); callers map it unchanged.
export async function remindPro(db, email, baseUrl) {
  const target = normalizeAdminEmail(email);
  const user = await db.get('SELECT id, email, plan, plan_renews_at FROM users WHERE email = ?', target);
  if (!user) throw new HttpError(404, 'user_not_found', 'No account found for this email');
  if (user.plan !== 'pro') throw new HttpError(400, 'not_pro', 'That account is not on the Pro plan');
  const renewsAt = String(user.plan_renews_at || '');
  await sendMail({
    to: user.email,
    subject: 'Renew your QuoteMint Pro plan / 专业版续费提醒',
    text: renewalReminderText({ renewsDate: renewsAt.slice(0, 10), billingUrl: `${baseUrl}/app/billing` })
  });
  await recordAdminEvent(db, 'remind', target, renewsAt);
  return { renews_at: renewsAt };
}

async function recordAdminEvent(db, action, targetEmail, detail) {
  await db.run(
    'INSERT INTO admin_events (at, action, target_email, detail) VALUES (?, ?, ?, ?)',
    new Date().toISOString(),
    action,
    targetEmail,
    detail
  );
}
