import {
  renderLanding,
  renderAuth,
  renderDashboard,
  renderEditor,
  renderBilling,
  renderPublicQuote,
  renderError
} from '../templates/index.js';
import { quotaFor } from '../lib/gating.js';
import { fetchQuoteByToken, listEvents, listQuoteRows, markViewed, quoteRowToFull } from '../lib/quotes.js';
import { isConfigured, isDemoMode } from '../lib/stripe.js';

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

export function landingPage(req, res) {
  sendHtml(res, 200, renderLanding({}));
}

export function authPage(req, res, ctx, params) {
  if (ctx.user) {
    redirect(res, '/app');
    return;
  }
  sendHtml(res, 200, renderAuth({ mode: params.mode }));
}

export function dashboardPage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  const quotes = listQuoteRows(ctx.db, ctx.user.id).map((row) => {
    const { quote, totals } = quoteRowToFull(row);
    return { ...quote, total_cents: totals.total_cents, totals, views: row.views };
  });
  sendHtml(res, 200, renderDashboard({ user: ctx.user, quotes, quota: quotaFor(ctx.db, ctx.user) }));
}

export function newQuotePage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  sendHtml(res, 200, renderEditor({ user: ctx.user, quote: null, events: null, quota: quotaFor(ctx.db, ctx.user) }));
}

export function editQuotePage(req, res, ctx, params) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  const id = Number(params.id);
  const row = Number.isInteger(id)
    ? ctx.db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(id, ctx.user.id)
    : null;
  if (!row) {
    sendHtml(res, 404, renderError({ status: 404, message: 'Quote not found' }));
    return;
  }
  const { quote, totals } = quoteRowToFull(row);
  const events = ctx.user.plan === 'pro' ? listEvents(ctx.db, id) : null;
  sendHtml(res, 200, renderEditor({ user: ctx.user, quote: { ...quote, totals }, events, quota: quotaFor(ctx.db, ctx.user) }));
}

export function billingPage(req, res, ctx) {
  if (!ctx.user) {
    redirect(res, '/login');
    return;
  }
  sendHtml(res, 200, renderBilling({ user: ctx.user, billingEnabled: isConfigured(), demoMode: isDemoMode() }));
}

export function publicQuotePage(req, res, ctx, params) {
  let quote = fetchQuoteByToken(ctx.db, params.token);
  if (!quote) {
    sendHtml(res, 404, renderError({ status: 404, message: 'Quote not found' }));
    return;
  }
  quote = markViewed(ctx.db, quote);
  const { quote: fullQuote, totals } = quoteRowToFull(quote);
  const owner = ctx.db
    .prepare('SELECT company, brand_color, logo_text, plan FROM users WHERE id = ?')
    .get(quote.user_id);
  const branding = owner
    ? { company: owner.company, brand_color: owner.brand_color, logo_text: owner.logo_text }
    : { company: '', brand_color: '#4F46E5', logo_text: '' };
  sendHtml(
    res,
    200,
    renderPublicQuote({ quote: fullQuote, totals, branding, showBadge: owner ? owner.plan === 'free' : true })
  );
}

export function notFoundPage(req, res) {
  sendHtml(res, 404, renderError({ status: 404, message: 'Page not found' }));
}

export function errorPage(req, res, status = 500, message = 'Something went wrong') {
  sendHtml(res, status, renderError({ status, message }));
}
