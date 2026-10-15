import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, resolveDataDir } from './lib/db.js';
import { publicDir } from './lib/paths.js';
import { SESSION_COOKIE, resolveSession } from './lib/auth.js';
import { adminEnabled } from './lib/admin.js';
import { enforceCsrf, parseCookies, sendError, HttpError } from './lib/http.js';
import * as authRoutes from './routes/auth.js';
import * as adminRoutes from './routes/admin.js';
import * as quoteRoutes from './routes/quotes.js';
import * as publicRoutes from './routes/public.js';
import * as billingRoutes from './routes/billing.js';
import { authPage, billingPage, dashboardPage, editQuotePage, errorPage, forgotPage, landingPage, langRoute, newQuotePage, notFoundPage, privacyPage, publicQuotePage, resetPage, termsPage } from './routes/pages.js';

if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true') {
  console.error('[fatal] DEMO_MODE=true is not allowed when NODE_ENV=production');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
if (process.env.NODE_ENV === 'production' && BASE_URL.startsWith('http://localhost')) {
  console.warn(
    '[warn] NODE_ENV=production but BASE_URL points at localhost. Session cookies will not be Secure and quote links will be unreachable by clients. Set BASE_URL to the public https URL.'
  );
}
const db = openDb(resolveDataDir());

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      keys.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), keys };
}

function route(method, pattern, handler) {
  const { regex, keys } = compile(pattern);
  return { method, regex, keys, handler };
}

const routes = [
  route('GET', '/', landingPage),
  route('GET', '/healthz', health),
  route('GET', '/login', (req, res, ctx) => authPage(req, res, ctx, { mode: 'login' })),
  route('GET', '/signup', (req, res, ctx) => authPage(req, res, ctx, { mode: 'signup' })),
  route('GET', '/forgot', forgotPage),
  route('GET', '/reset', resetPage),
  route('GET', '/app', dashboardPage),
  route('GET', '/app/quotes/new', newQuotePage),
  route('GET', '/app/quotes/:id/edit', editQuotePage),
  route('GET', '/app/billing', billingPage),
  route('GET', '/q/:token', publicQuotePage),
  route('GET', '/lang/:code', langRoute),
  route('GET', '/privacy', privacyPage),
  route('GET', '/terms', termsPage),
  route('POST', '/api/auth/signup', authRoutes.signup),
  route('POST', '/api/auth/login', authRoutes.login),
  route('POST', '/api/auth/forgot', authRoutes.forgotPassword),
  route('POST', '/api/auth/reset', authRoutes.resetPassword),
  route('POST', '/api/auth/logout', authRoutes.logout),
  route('GET', '/api/auth/me', authRoutes.me),
  route('PUT', '/api/auth/profile', authRoutes.updateProfile),
  route('GET', '/api/quotes', quoteRoutes.listQuotes),
  route('POST', '/api/quotes', quoteRoutes.createQuote),
  route('GET', '/api/quotes/:id', quoteRoutes.getQuote),
  route('PUT', '/api/quotes/:id', quoteRoutes.updateQuote),
  route('DELETE', '/api/quotes/:id', quoteRoutes.deleteQuote),
  route('POST', '/api/quotes/:id/send', quoteRoutes.sendQuoteRoute),
  route('POST', '/api/public/quotes/:token/accept', publicRoutes.acceptPublicQuote),
  route('POST', '/api/public/quotes/:token/decline', publicRoutes.declinePublicQuote),
  route('POST', '/api/billing/checkout', billingRoutes.checkout),
  route('POST', '/api/billing/demo-upgrade', billingRoutes.demoUpgrade),
  route('POST', '/webhooks/stripe', billingRoutes.stripeWebhook),
  route('POST', '/webhooks/creem', billingRoutes.creemWebhook),
  route('GET', '/admin', adminRoutes.dashboardPage),
  route('GET', '/admin/admin.js', adminRoutes.clientJs),
  route('GET', '/admin/login', adminRoutes.loginPage),
  route('POST', '/admin/login', adminRoutes.login),
  route('POST', '/admin/logout', adminRoutes.logout),
  route('GET', '/admin/users', adminRoutes.usersPage),
  route('GET', '/admin/quotes', adminRoutes.quotesPage),
  route('POST', '/admin/grant', adminRoutes.grant),
  route('POST', '/admin/revoke', adminRoutes.revoke)
];

function health(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ok');
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const publicRoot = publicDir();
  const resolved = resolve(publicRoot, `.${decoded}`);
  if (resolved !== publicRoot && !resolved.startsWith(publicRoot + sep)) return false;
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(resolved));
  return true;
}

async function resolveUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const userId = await resolveSession(db, token);
  if (!userId) return null;
  return (await db.get('SELECT * FROM users WHERE id = ?', userId)) || null;
}

export async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  let pathname;
  try {
    pathname = new URL(req.url, BASE_URL).pathname;
  } catch {
    pathname = req.url || '/';
  }
  const isApi = pathname.startsWith('/api/');
  // Admin gate: without both env vars every /admin path is indistinguishable
  // from a nonexistent route. Static serving decodes the path too, so encoded
  // variants like /%61dmin.js must hit this same gate.
  let isAdmin = pathname.toLowerCase().startsWith('/admin');
  if (!isAdmin) {
    try {
      const normalized = decodeURIComponent(pathname)
        .split('/')
        .filter((segment) => segment && segment !== '.')
        .join('/')
        .toLowerCase();
      isAdmin = normalized === 'admin' || normalized.startsWith('admin/') || normalized.startsWith('admin.');
    } catch {
      isAdmin = true; // undecodable path: keep it inside the gate (404 either way)
    }
  }

  if (isAdmin && !adminEnabled()) {
    notFoundPage(req, res);
    return;
  }

  try {
    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (mutating && (isApi || isAdmin) && !enforceCsrf(req, res)) return;

    const ctx = {
      db,
      baseUrl: BASE_URL,
      user: await resolveUser(req),
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      creemWebhookSecret: process.env.CREEM_WEBHOOK_SECRET || ''
    };

    for (const entry of routes) {
      if (entry.method !== req.method) continue;
      const match = entry.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      entry.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(match[i + 1]);
        } catch {
          params[key] = match[i + 1];
        }
      });
      await entry.handler(req, res, ctx, params);
      return;
    }

    if (req.method === 'GET' && serveStatic(req, res, pathname)) return;

    if (isApi) {
      sendError(res, 404, 'not_found', 'Route not found');
    } else {
      notFoundPage(req, res);
    }
  } catch (err) {
    console.error(`[error] ${req.method} ${pathname}:`, err && err.stack ? err.stack : err);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof HttpError) {
      if (isApi) sendError(res, err.status, err.code, err.message);
      else errorPage(req, res, err.status, err.message);
      return;
    }
    if (isApi) sendError(res, 500, 'internal_error', 'Something went wrong');
    else errorPage(req, res, 500, 'Something went wrong');
  }
}

// import.meta.main needs Node >=24.2; pathToFileURL comparison covers 22.13+.
// A bundled CJS build (Lambda) has an empty import.meta, which must mean "not
// main" so the function never opens a listening socket.
const rawMetaUrl = import.meta.url;
const metaUrl = typeof rawMetaUrl === 'string' && rawMetaUrl ? rawMetaUrl : '';
const isMain = metaUrl
  ? (import.meta.main ?? (process.argv[1] ? metaUrl === pathToFileURL(process.argv[1]).href : false))
  : false;

if (isMain) {
  createServer(handleRequest).listen(PORT, () => {
    console.log(`QuoteMint listening on ${BASE_URL} (data: ${resolveDataDir()})`);
  });
}
