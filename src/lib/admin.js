// Admin panel core: env gate, stateless signed session token, password verify,
// and the shared Pro grant/revoke operations used by both the web panel
// (src/routes/admin.js) and the CLI (scripts/grant.js).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, parseCookies } from './http.js';
import { verifyPassword } from './auth.js';

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

async function recordAdminEvent(db, action, targetEmail, detail) {
  await db.run(
    'INSERT INTO admin_events (at, action, target_email, detail) VALUES (?, ?, ?, ?)',
    new Date().toISOString(),
    action,
    targetEmail,
    detail
  );
}
