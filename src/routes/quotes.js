import { readJson, sendError, sendJson } from '../lib/http.js';
import { quotaFor } from '../lib/gating.js';
import {
  fetchQuoteWithViews,
  insertQuote,
  listQuoteRows,
  quoteEvents,
  quoteRowToFull,
  QuoteError,
  sendQuote,
  updateQuoteRow,
  validateQuoteBody
} from '../lib/quotes.js';

function requireUser(res, ctx) {
  if (!ctx.user) {
    sendError(res, 401, 'not_authenticated', 'Log in to continue');
    return false;
  }
  return true;
}

function parseId(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function handleQuoteError(res, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof QuoteError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

export function listQuotes(req, res, ctx) {
  if (!requireUser(res, ctx)) return;
  const rows = listQuoteRows(ctx.db, ctx.user.id);
  const quotes = rows.map((row) => ({
    id: row.id,
    title: row.title,
    client_name: row.client_name,
    status: row.status,
    currency: row.currency,
    total_cents: quoteRowToFull(row).totals.total_cents,
    public_token: row.public_token,
    created_at: row.created_at,
    sent_at: row.sent_at,
    viewed_at: row.viewed_at,
    accepted_at: row.accepted_at,
    valid_until: row.valid_until,
    views: row.views
  }));
  sendJson(res, 200, { ok: true, data: { quotes, quota: quotaFor(ctx.db, ctx.user) } });
}

export async function createQuote(req, res, ctx) {
  if (!requireUser(res, ctx)) return;
  const body = await readJson(req);
  await handleQuoteError(res, () => {
    const data = validateQuoteBody(body);
    const row = insertQuote(ctx.db, ctx.user, data);
    const { quote, totals } = quoteRowToFull(row);
    sendJson(res, 201, { ok: true, data: { quote: { ...quote, totals } } });
  });
}

export function getQuote(req, res, ctx, params) {
  if (!requireUser(res, ctx)) return;
  const id = parseId(params);
  const row = id ? fetchQuoteWithViews(ctx.db, id, ctx.user.id) : null;
  if (!row) {
    sendError(res, 404, 'not_found', 'Quote not found');
    return;
  }
  const { quote, totals } = quoteRowToFull(row);
  const events = ctx.user.plan === 'pro' ? quoteEvents(ctx.db, id) : null;
  sendJson(res, 200, { ok: true, data: { quote: { ...quote, totals }, totals, events } });
}

export async function updateQuote(req, res, ctx, params) {
  if (!requireUser(res, ctx)) return;
  const id = parseId(params);
  const row = id ? ctx.db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(id, ctx.user.id) : null;
  if (!row) {
    sendError(res, 404, 'not_found', 'Quote not found');
    return;
  }
  if (row.status !== 'draft') {
    sendError(res, 409, 'not_draft', 'Only draft quotes can be edited');
    return;
  }
  const body = await readJson(req);
  await handleQuoteError(res, () => {
    const data = validateQuoteBody(body);
    const updated = updateQuoteRow(ctx.db, id, ctx.user.id, data);
    if (!updated) {
      sendError(res, 409, 'not_draft', 'Only draft quotes can be edited');
      return;
    }
    const { quote, totals } = quoteRowToFull(updated);
    sendJson(res, 200, { ok: true, data: { quote: { ...quote, totals } } });
  });
}

export function deleteQuote(req, res, ctx, params) {
  if (!requireUser(res, ctx)) return;
  const id = parseId(params);
  const row = id ? ctx.db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(id, ctx.user.id) : null;
  if (!row) {
    sendError(res, 404, 'not_found', 'Quote not found');
    return;
  }
  if (row.status !== 'draft') {
    sendError(res, 409, 'not_draft', 'Only draft quotes can be deleted');
    return;
  }
  ctx.db.prepare('DELETE FROM quote_events WHERE quote_id = ?').run(id);
  ctx.db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
}

export function sendQuoteRoute(req, res, ctx, params) {
  if (!requireUser(res, ctx)) return;
  const id = parseId(params);
  const row = id ? ctx.db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(id, ctx.user.id) : null;
  if (!row) {
    sendError(res, 404, 'not_found', 'Quote not found');
    return;
  }
  try {
    const updated = sendQuote(ctx.db, row);
    const { quote, totals } = quoteRowToFull(updated);
    sendJson(res, 200, {
      ok: true,
      data: { quote: { ...quote, totals }, public_url: `${ctx.baseUrl}/q/${updated.public_token}` }
    });
  } catch (err) {
    if (err instanceof QuoteError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}
