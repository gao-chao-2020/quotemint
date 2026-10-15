// Admin panel routes (paths under /admin). server.js keeps every /admin path a
// plain 404 unless ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET are both set, and
// enforces CSRF on mutating admin requests before dispatching here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, clientIp, createRateLimiter, readJson, sendError, sendJson } from '../lib/http.js';
import {
  clearAdminCookie,
  grantPro,
  isAdminAuthed,
  normalizeAdminEmail,
  remindPro,
  revokePro,
  setAdminCookie,
  verifyAdminPassword
} from '../lib/admin.js';
import { assetsDir } from '../lib/paths.js';
import { quoteRowToFull } from '../lib/quotes.js';
import { renderAdminDashboard, renderAdminExpiring, renderAdminLogin, renderAdminQuotes, renderAdminUsers } from '../templates/index.js';
import { resolveLang } from '../lib/lang.js';

const LOGIN_MAX_ATTEMPTS = 10;
const SEARCH_LIMIT = 50;
const DASHBOARD_USER_LIMIT = 10;
const AUDIT_LIMIT = 10;
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRING_LIMIT = 50;

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: LOGIN_MAX_ATTEMPTS });

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function queryParam(req, name) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get(name) || '';
  } catch {
    return '';
  }
}

// Page routes redirect to the login page; JSON routes answer 401.
function requireAdminPage(req, res) {
  if (isAdminAuthed(req)) return true;
  redirect(res, '/admin/login');
  return false;
}

function requireAdminJson(req, res) {
  if (isAdminAuthed(req)) return true;
  sendError(res, 401, 'not_authenticated', 'Admin session required');
  return false;
}

function utcMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function searchUsers(db, q) {
  const columns = 'email, name, plan, plan_renews_at, created_at';
  if (!q) {
    return db.all(`SELECT ${columns} FROM users ORDER BY id DESC LIMIT ?`, SEARCH_LIMIT);
  }
  // Escape LIKE metacharacters; ILIKE keeps Postgres case-insensitive like SQLite.
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const op = db.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
  return db.all(
    `SELECT ${columns} FROM users WHERE email ${op} ? ESCAPE '\\' OR name ${op} ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`,
    like,
    like,
    SEARCH_LIMIT
  );
}

export function clientJs(req, res) {
  // Lives in src/assets (NOT public/): anything in the publish dir is served
  // statically ahead of the function rewrite and would stay reachable while
  // the panel is disabled. Served here, the /admin gate covers it too.
  const js = readFileSync(join(assetsDir(), 'admin.js'));
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(js);
}

export function loginPage(req, res, ctx) {
  if (isAdminAuthed(req)) {
    redirect(res, '/admin');
    return;
  }
  sendHtml(res, 200, renderAdminLogin({ lang: resolveLang(req), path: '/admin/login' }));
}

export async function login(req, res, ctx) {
  if (!loginLimiter.check(clientIp(req))) {
    sendError(res, 429, 'rate_limited', 'Too many requests');
    return;
  }
  const body = await readJson(req);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!verifyAdminPassword(password)) {
    sendError(res, 401, 'bad_password', 'Incorrect password');
    return;
  }
  setAdminCookie(res, ctx.baseUrl);
  sendJson(res, 200, { ok: true });
}

export function logout(req, res) {
  clearAdminCookie(res);
  sendJson(res, 200, { ok: true });
}

export async function dashboardPage(req, res, ctx) {
  if (!requireAdminPage(req, res)) return;
  const monthStart = utcMonthStart();
  const [totalUsers, totalQuotes, newUsers, newQuotes, users, events] = await Promise.all([
    ctx.db.get('SELECT COUNT(*) AS n FROM users'),
    ctx.db.get('SELECT COUNT(*) AS n FROM quotes'),
    ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', monthStart),
    ctx.db.get('SELECT COUNT(*) AS n FROM quotes WHERE created_at >= ?', monthStart),
    ctx.db.all('SELECT email, name, plan, plan_renews_at, created_at FROM users ORDER BY id DESC LIMIT ?', DASHBOARD_USER_LIMIT),
    ctx.db.all('SELECT at, action, target_email, detail FROM admin_events ORDER BY id DESC LIMIT ?', AUDIT_LIMIT)
  ]);
  sendHtml(
    res,
    200,
    renderAdminDashboard({
      lang: resolveLang(req),
      path: '/admin',
      stats: {
        total_users: Number(totalUsers?.n) || 0,
        total_quotes: Number(totalQuotes?.n) || 0,
        users_month: Number(newUsers?.n) || 0,
        quotes_month: Number(newQuotes?.n) || 0
      },
      users,
      events
    })
  );
}

export async function usersPage(req, res, ctx) {
  if (!requireAdminPage(req, res)) return;
  const q = queryParam(req, 'q').trim().slice(0, 254);
  const users = await searchUsers(ctx.db, q);
  sendHtml(res, 200, renderAdminUsers({ lang: resolveLang(req), path: '/admin/users', q, users }));
}

async function searchQuotes(db, q) {
  const columns =
    'q.id, q.title, q.client_name, q.status, q.currency, q.items, q.discount_pct, q.tax_pct, q.public_token, q.created_at, u.email AS owner_email';
  const base = `SELECT ${columns} FROM quotes q JOIN users u ON u.id = q.user_id`;
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const op = db.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
  const rows = q
    ? await db.all(
        `${base} WHERE q.title ${op} ? ESCAPE '\\' OR q.client_name ${op} ? ESCAPE '\\' OR u.email ${op} ? ESCAPE '\\' ORDER BY q.id DESC LIMIT ?`,
        like,
        like,
        like,
        SEARCH_LIMIT
      )
    : await db.all(`${base} ORDER BY q.id DESC LIMIT ?`, SEARCH_LIMIT);
  // total_cents is computed from items/discount/tax — same helper as the user dashboard.
  return rows.map((row) => ({ ...row, total_cents: quoteRowToFull(row).totals.total_cents }));
}

export async function quotesPage(req, res, ctx) {
  if (!requireAdminPage(req, res)) return;
  const q = queryParam(req, 'q').trim().slice(0, 254);
  const quotes = await searchQuotes(ctx.db, q);
  sendHtml(res, 200, renderAdminQuotes({ lang: resolveLang(req), path: '/admin/quotes', q, quotes }));
}

export async function expiringPage(req, res, ctx) {
  if (!requireAdminPage(req, res)) return;
  const now = Date.now();
  // plan_renews_at is a fixed-width ISO-8601 UTC string, so range comparisons
  // are lexicographic and identical on SQLite and Postgres.
  const users = await ctx.db.all(
    `SELECT email, name, plan_renews_at FROM users
     WHERE plan = 'pro' AND plan_renews_at >= ? AND plan_renews_at <= ?
     ORDER BY plan_renews_at ASC LIMIT ?`,
    new Date(now).toISOString(),
    new Date(now + EXPIRING_WINDOW_MS).toISOString(),
    EXPIRING_LIMIT
  );
  sendHtml(res, 200, renderAdminExpiring({ lang: resolveLang(req), path: '/admin/expiring', users }));
}

export async function remind(req, res, ctx) {
  if (!requireAdminJson(req, res)) return;
  const body = await readJson(req);
  const email = normalizeAdminEmail(body.email);
  if (!email) {
    sendError(res, 400, 'invalid_email', 'Provide the account email');
    return;
  }
  try {
    const result = await remindPro(ctx.db, email, ctx.baseUrl);
    sendJson(res, 200, { ok: true, data: { renews_at: result.renews_at } });
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

export async function grant(req, res, ctx) {
  if (!requireAdminJson(req, res)) return;
  const body = await readJson(req);
  const email = normalizeAdminEmail(body.email);
  if (!email) {
    sendError(res, 400, 'invalid_email', 'Provide the account email');
    return;
  }
  const months = body.months === undefined ? 12 : Number(body.months);
  try {
    const result = await grantPro(ctx.db, email, months);
    sendJson(res, 200, { ok: true, data: { renews_at: result.renews_at } });
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

export async function revoke(req, res, ctx) {
  if (!requireAdminJson(req, res)) return;
  const body = await readJson(req);
  const email = normalizeAdminEmail(body.email);
  if (!email) {
    sendError(res, 400, 'invalid_email', 'Provide the account email');
    return;
  }
  try {
    await revokePro(ctx.db, email);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}
