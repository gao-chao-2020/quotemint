import { clientIp, createRateLimiter, readJson, sendError, sendJson } from '../lib/http.js';
import { notifyQuoteAccepted } from '../lib/notify.js';
import { acceptQuote, declineQuote, fetchQuoteByToken, QuoteError } from '../lib/quotes.js';

const publicLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

function limited(req, res) {
  if (publicLimiter.check(clientIp(req))) return false;
  sendError(res, 429, 'rate_limited', 'Too many requests');
  return true;
}

async function lookup(res, ctx, params) {
  const quote = await fetchQuoteByToken(ctx.db, params.token);
  if (!quote) {
    sendError(res, 404, 'not_found', 'Quote not found');
    return null;
  }
  return quote;
}

export async function acceptPublicQuote(req, res, ctx, params) {
  if (limited(req, res)) return;
  const body = await readJson(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 120) {
    sendError(res, 400, 'invalid_name', 'Name must be 1-120 characters');
    return;
  }
  if (body.agree !== true) {
    sendError(res, 400, 'not_agreed', 'You must agree to the quote terms');
    return;
  }
  const quote = await lookup(res, ctx, params);
  if (!quote) return;
  try {
    const updated = await acceptQuote(ctx.db, quote, name);
    // Fire-and-forget: mail problems must never delay or fail the client's accept.
    void notifyQuoteAccepted(ctx.db, updated, ctx.baseUrl);
    sendJson(res, 200, {
      ok: true,
      data: { status: updated.status, accepted_name: updated.accepted_name, accepted_at: updated.accepted_at }
    });
  } catch (err) {
    if (err instanceof QuoteError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}

export async function declinePublicQuote(req, res, ctx, params) {
  if (limited(req, res)) return;
  const body = await readJson(req);
  let reason = '';
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string' || body.reason.length > 500) {
      sendError(res, 400, 'invalid_reason', 'Reason must be at most 500 characters');
      return;
    }
    reason = body.reason.trim();
  }
  const quote = await lookup(res, ctx, params);
  if (!quote) return;
  try {
    const updated = await declineQuote(ctx.db, quote, reason);
    sendJson(res, 200, { ok: true, data: { status: updated.status } });
  } catch (err) {
    if (err instanceof QuoteError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }
    throw err;
  }
}
