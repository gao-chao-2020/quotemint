import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  renderLanding,
  renderAuth,
  renderDashboard,
  renderEditor,
  renderBilling,
  renderPublicQuote,
  renderError
} from '../templates/index.js';
import * as templates from '../templates/index.js';
import { isPro, quotaFor } from '../lib/gating.js';
import { resolveLang, safeNext } from '../lib/lang.js';
import { fetchQuoteByToken, listEvents, listQuoteRows, markViewed, quoteRowToFull } from '../lib/quotes.js';
import { isConfigured, isDemoMode, providerName } from '../lib/billing.js';

const ALIPAY_QR_PATH = fileURLToPath(new URL('../../public/alipay-qr.png', import.meta.url));

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

export function landingPage(req, res) {
  sendHtml(res, 200, renderLanding({ lang: resolveLang(req), path: req.url.split('?')[0] }));
}

export function authPage(req, res, ctx, params) {
  if (ctx.user) {
    redirect(res, '/app');
    return;
  }
  sendHtml(res, 200, renderAuth({ mode: params.mode, lang: resolveLang(req), path: req.url.split('?')[0] }));
}

export function langRoute(req, res, ctx, params) {
  const code = params.code;
  if (code !== 'en' && code !== 'zh') {
    redirect(res, '/');
    return;
  }
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  const next = new URLSearchParams(query).get('next');
  const secure = String(ctx.baseUrl || '').startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `lang=${code}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`);
  redirect(res, safeNext(next));
}

export async function dashboardPage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  const rows = await listQuoteRows(ctx.db, ctx.user.id);
  const quotes = rows.map((row) => {
    const { quote, totals } = quoteRowToFull(row);
    return { ...quote, total_cents: totals.total_cents, totals, views: row.views };
  });
  sendHtml(
    res,
    200,
    renderDashboard({ user: ctx.user, quotes, quota: await quotaFor(ctx.db, ctx.user), lang: resolveLang(req), path: req.url.split('?')[0] })
  );
}

export async function newQuotePage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  sendHtml(
    res,
    200,
    renderEditor({ user: ctx.user, quote: null, events: null, quota: await quotaFor(ctx.db, ctx.user), lang: resolveLang(req), path: req.url.split('?')[0] })
  );
}

export async function editQuotePage(req, res, ctx, params) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  const id = Number(params.id);
  const row = Number.isInteger(id)
    ? await ctx.db.get('SELECT * FROM quotes WHERE id = ? AND user_id = ?', id, ctx.user.id)
    : null;
  if (!row) {
    sendHtml(res, 404, renderError({ status: 404, message: 'Quote not found' }));
    return;
  }
  const { quote, totals } = quoteRowToFull(row);
  const events = isPro(ctx.user) ? await listEvents(ctx.db, id) : null;
  sendHtml(
    res,
    200,
    renderEditor({ user: ctx.user, quote: { ...quote, totals }, events, quota: await quotaFor(ctx.db, ctx.user), lang: resolveLang(req), path: req.url.split('?')[0] })
  );
}

export function billingPage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  sendHtml(
    res,
    200,
    renderBilling({
      user: ctx.user,
      billingEnabled: isConfigured(),
      demoMode: isDemoMode(),
      providerName: providerName(),
      alipayQr: existsSync(ALIPAY_QR_PATH),
      lang: resolveLang(req),
      path: req.url.split('?')[0]
    })
  );
}

export async function publicQuotePage(req, res, ctx, params) {
  let quote = await fetchQuoteByToken(ctx.db, params.token);
  if (!quote) {
    sendHtml(res, 404, renderError({ status: 404, message: 'Quote not found' }));
    return;
  }
  quote = await markViewed(ctx.db, quote);
  const { quote: fullQuote, totals } = quoteRowToFull(quote);
  const owner = await ctx.db.get('SELECT company, brand_color, logo_text, plan FROM users WHERE id = ?', quote.user_id);
  const branding = owner
    ? { company: owner.company, brand_color: owner.brand_color, logo_text: owner.logo_text }
    : { company: '', brand_color: '#4F46E5', logo_text: '' };
  sendHtml(
    res,
    200,
    renderPublicQuote({ quote: fullQuote, totals, branding, showBadge: owner ? !isPro(owner) : true, lang: resolveLang(req), path: req.url.split('?')[0] })
  );
}

function legalPage(req, res, page) {
  const renderLegal = templates.renderLegal;
  if (typeof renderLegal !== 'function') {
    errorPage(req, res, 503, 'Legal pages are not available yet');
    return;
  }
  sendHtml(res, 200, renderLegal({ page, lang: resolveLang(req), path: req.url.split('?')[0] }));
}

export function privacyPage(req, res) {
  legalPage(req, res, 'privacy');
}

export function termsPage(req, res) {
  legalPage(req, res, 'terms');
}

export function notFoundPage(req, res) {
  sendHtml(res, 404, renderError({ status: 404, message: 'Page not found' }));
}

export function errorPage(req, res, status = 500, message = 'Something went wrong') {
  sendHtml(res, status, renderError({ status, message }));
}
