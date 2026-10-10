import { createRateLimiter, readJson, sendError, sendJson, setSessionCookie, clearSessionCookie, clientIp, parseCookies } from '../lib/http.js';
import { createSession, destroySession, hashPassword, publicUser, SESSION_COOKIE, verifyPassword } from '../lib/auth.js';
import { quotaFor } from '../lib/gating.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

const DUMMY_PASSWORD_HASH = hashPassword('quotemint-dummy-timing-equalizer');

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function signup(req, res, ctx) {
  if (!authLimiter.check(clientIp(req))) {
    sendError(res, 429, 'rate_limited', 'Too many requests');
    return;
  }
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    sendError(res, 400, 'invalid_email', 'Enter a valid email address');
    return;
  }
  const password = body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    sendError(res, 400, 'invalid_password', 'Password must be 8-200 characters');
    return;
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 80) {
    sendError(res, 400, 'invalid_name', 'Name must be 1-80 characters');
    return;
  }
  const existing = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    sendError(res, 409, 'email_taken', 'An account with this email already exists');
    return;
  }
  const now = new Date().toISOString();
  let info;
  try {
    info = ctx.db
      .prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)')
      .run(email, hashPassword(password), name, now);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      sendError(res, 409, 'email_taken', 'An account with this email already exists');
      return;
    }
    throw err;
  }
  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  const token = createSession(ctx.db, user.id);
  setSessionCookie(res, token, ctx.baseUrl);
  sendJson(res, 201, { ok: true, data: { user: publicUser(user) } });
}

export async function login(req, res, ctx) {
  if (!authLimiter.check(clientIp(req))) {
    sendError(res, 429, 'rate_limited', 'Too many requests');
    return;
  }
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const user = email ? ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  const password = typeof body.password === 'string' ? body.password : '';
  // Unknown email still burns one scrypt verify so login timing does not enumerate accounts.
  const valid = user
    ? verifyPassword(password, user.password_hash)
    : (verifyPassword(password, DUMMY_PASSWORD_HASH), false);
  if (!valid) {
    sendError(res, 401, 'invalid_credentials', 'Incorrect email or password');
    return;
  }
  const token = createSession(ctx.db, user.id);
  setSessionCookie(res, token, ctx.baseUrl);
  sendJson(res, 200, { ok: true, data: { user: publicUser(user) } });
}

export async function logout(req, res, ctx) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) destroySession(ctx.db, token);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

export async function me(req, res, ctx) {
  if (!ctx.user) {
    sendError(res, 401, 'not_authenticated', 'Log in to continue');
    return;
  }
  sendJson(res, 200, { ok: true, data: { user: publicUser(ctx.user), quota: quotaFor(ctx.db, ctx.user) } });
}

export async function updateProfile(req, res, ctx) {
  if (!ctx.user) {
    sendError(res, 401, 'not_authenticated', 'Log in to continue');
    return;
  }
  const body = await readJson(req);
  const updates = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 80) {
      sendError(res, 400, 'invalid_name', 'Name must be 1-80 characters');
      return;
    }
    updates.name = name;
  }

  const brandingTouched = body.company !== undefined || body.brand_color !== undefined || body.logo_text !== undefined;
  if (brandingTouched && ctx.user.plan !== 'pro') {
    sendError(res, 403, 'pro_required', 'Custom branding requires the Pro plan');
    return;
  }
  if (body.company !== undefined) {
    const company = typeof body.company === 'string' ? body.company.trim() : '';
    if (company.length > 80) {
      sendError(res, 400, 'invalid_company', 'Company must be at most 80 characters');
      return;
    }
    updates.company = company;
  }
  if (body.brand_color !== undefined) {
    if (typeof body.brand_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.brand_color)) {
      sendError(res, 400, 'invalid_brand_color', 'brand_color must be a hex color like #4F46E5');
      return;
    }
    updates.brand_color = body.brand_color;
  }
  if (body.logo_text !== undefined) {
    const logoText = typeof body.logo_text === 'string' ? body.logo_text.trim() : '';
    if (logoText.length > 40) {
      sendError(res, 400, 'invalid_logo_text', 'Logo text must be at most 40 characters');
      return;
    }
    updates.logo_text = logoText;
  }

  const keys = Object.keys(updates);
  if (keys.length > 0) {
    const setClause = keys.map((key) => `${key} = ?`).join(', ');
    ctx.db
      .prepare(`UPDATE users SET ${setClause} WHERE id = ?`)
      .run(...keys.map((key) => updates[key]), ctx.user.id);
  }
  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  sendJson(res, 200, { ok: true, data: { user: publicUser(user) } });
}
