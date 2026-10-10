import { randomBytes } from 'node:crypto';
import { computeTotals } from './money.js';
import { canCreateQuote } from './gating.js';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY'];
export const EVENT_TYPES = ['sent', 'view', 'accept', 'decline'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class QuoteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fieldError(code, message) {
  throw new QuoteError(400, code, message);
}

function requireString(value, { code, min = 1, max, optional = false }) {
  if (value === undefined || value === null) {
    if (optional) return '';
    fieldError(code, `${code.replace(/^invalid_/, '')} is required`);
  }
  if (typeof value !== 'string') fieldError(code, 'Must be a string');
  const trimmed = value.trim();
  if (trimmed.length < min) fieldError(code, `Must be at least ${min} characters`);
  if (trimmed.length > max) fieldError(code, `Must be at most ${max} characters`);
  return trimmed;
}

function optionalText(value, { code, max }) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fieldError(code, 'Must be a string');
  if (value.length > max) fieldError(code, `Must be at most ${max} characters`);
  return value;
}

function validateItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    fieldError('invalid_items', 'items must be an array of 1-50 entries');
  }
  return value.map((item) => {
    const desc = item?.desc;
    if (typeof desc !== 'string' || desc.trim().length < 1 || desc.trim().length > 500) {
      fieldError('invalid_items', 'Each item needs a description of 1-500 characters');
    }
    const qty = item?.qty;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > 100000) {
      fieldError('invalid_items', 'Each item qty must be > 0 and <= 100000');
    }
    const price = item?.unit_price_cents;
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 1e12) {
      fieldError('invalid_items', 'Each unit_price_cents must be an integer 0..1e12');
    }
    return { desc: desc.trim(), qty, unit_price_cents: price };
  });
}

function validatePct(value, code) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    fieldError(code, 'Must be a number between 0 and 100');
  }
  return value;
}

function validateValidUntil(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    fieldError('invalid_valid_until', 'valid_until must be YYYY-MM-DD');
  }
  return value;
}

export function validateQuoteBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fieldError('invalid_body', 'Request body must be a JSON object');
  }
  const title = requireString(body.title, { code: 'invalid_title', max: 200 });
  const clientName = requireString(body.client_name, { code: 'invalid_client_name', max: 120 });

  let clientEmail = '';
  if (body.client_email !== undefined && body.client_email !== null && body.client_email !== '') {
    if (typeof body.client_email !== 'string') fieldError('invalid_client_email', 'Must be a string');
    clientEmail = body.client_email.trim().toLowerCase();
    if (clientEmail.length > 254 || !EMAIL_RE.test(clientEmail)) {
      fieldError('invalid_client_email', 'Must be a valid email');
    }
  }

  let currency = body.currency === undefined || body.currency === null ? 'USD' : body.currency;
  if (typeof currency !== 'string' || !CURRENCIES.includes(currency.toUpperCase())) {
    fieldError('invalid_currency', `currency must be one of ${CURRENCIES.join(', ')}`);
  }
  currency = currency.toUpperCase();

  return {
    title,
    client_name: clientName,
    client_email: clientEmail,
    currency,
    items: validateItems(body.items),
    discount_pct: validatePct(body.discount_pct, 'invalid_discount_pct'),
    tax_pct: validatePct(body.tax_pct, 'invalid_tax_pct'),
    notes: optionalText(body.notes, { code: 'invalid_notes', max: 2000 }),
    terms: optionalText(body.terms, { code: 'invalid_terms', max: 2000 }),
    valid_until: validateValidUntil(body.valid_until)
  };
}

export function recordEvent(db, quoteId, type, meta = '') {
  db.prepare('INSERT INTO quote_events (quote_id, type, at, meta) VALUES (?, ?, ?, ?)').run(
    quoteId,
    type,
    new Date().toISOString(),
    String(meta)
  );
}

export function parseItems(row) {
  try {
    const parsed = JSON.parse(row.items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function quoteTotals(row) {
  try {
    return computeTotals(parseItems(row), row.discount_pct, row.tax_pct);
  } catch {
    return { subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0 };
  }
}

export function quoteRowToFull(row, events = null) {
  const { items, ...rest } = row;
  const quote = { ...rest, items: parseItems(row) };
  return { quote, totals: quoteTotals(row), events };
}

export function listQuoteRows(db, userId) {
  return db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM quote_events e WHERE e.quote_id = q.id AND e.type = 'view') AS views
       FROM quotes q WHERE q.user_id = ? ORDER BY q.id DESC`
    )
    .all(userId);
}

export function fetchQuoteWithViews(db, quoteId, userId) {
  return db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM quote_events e WHERE e.quote_id = q.id AND e.type = 'view') AS views
       FROM quotes q WHERE q.id = ? AND q.user_id = ?`
    )
    .get(quoteId, userId);
}

export function fetchQuoteByToken(db, token) {
  return db.prepare('SELECT * FROM quotes WHERE public_token = ?').get(token);
}

export function quoteEvents(db, quoteId) {
  return db
    .prepare('SELECT type, at, meta FROM quote_events WHERE quote_id = ? ORDER BY id ASC')
    .all(quoteId);
}

export function insertQuote(db, user, data) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!canCreateQuote(db, user)) {
      throw new QuoteError(403, 'free_limit_reached', 'Free plan allows 3 quotes per month. Upgrade to Pro for unlimited quotes.');
    }
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO quotes
         (user_id, public_token, title, client_name, client_email, currency, items, discount_pct, tax_pct, notes, terms, status, valid_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
      )
      .run(
        user.id,
        randomBytes(16).toString('hex'),
        data.title,
        data.client_name,
        data.client_email,
        data.currency,
        JSON.stringify(data.items),
        data.discount_pct,
        data.tax_pct,
        data.notes,
        data.terms,
        data.valid_until,
        now,
        now
      );
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM quotes WHERE id = ?').get(Number(info.lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateQuoteRow(db, quoteId, data) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE quotes SET title = ?, client_name = ?, client_email = ?, currency = ?, items = ?,
     discount_pct = ?, tax_pct = ?, notes = ?, terms = ?, valid_until = ?, updated_at = ? WHERE id = ?`
  ).run(
    data.title,
    data.client_name,
    data.client_email,
    data.currency,
    JSON.stringify(data.items),
    data.discount_pct,
    data.tax_pct,
    data.notes,
    data.terms,
    data.valid_until,
    now,
    quoteId
  );
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
}

export function sendQuote(db, row) {
  if (row.status === 'accepted' || row.status === 'declined') {
    throw new QuoteError(409, 'already_final', 'Quote is already final');
  }
  if (!row.title.trim() || !row.client_name.trim() || parseItems(row).length === 0) {
    throw new QuoteError(400, 'incomplete', 'Quote needs a title, client name, and at least one item');
  }
  const now = new Date().toISOString();
  if (row.status === 'draft') {
    db.prepare('UPDATE quotes SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?').run('sent', now, now, row.id);
    recordEvent(db, row.id, 'sent');
  }
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(row.id);
}

export function markViewed(db, row) {
  if (row.status !== 'sent') return row;
  const now = new Date().toISOString();
  db.prepare('UPDATE quotes SET status = ?, viewed_at = ?, updated_at = ? WHERE id = ?').run('viewed', now, now, row.id);
  recordEvent(db, row.id, 'view');
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(row.id);
}

export function acceptQuote(db, row, name) {
  if (row.status === 'accepted' || row.status === 'declined') {
    throw new QuoteError(409, 'already_final', 'Quote is already final');
  }
  if (row.status !== 'sent' && row.status !== 'viewed') {
    throw new QuoteError(404, 'not_found', 'Quote not found');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE quotes SET status = ?, accepted_at = ?, accepted_name = ?, updated_at = ? WHERE id = ?').run(
    'accepted',
    now,
    name,
    now,
    row.id
  );
  recordEvent(db, row.id, 'accept');
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(row.id);
}

export function declineQuote(db, row, reason = '') {
  if (row.status === 'accepted' || row.status === 'declined') {
    throw new QuoteError(409, 'already_final', 'Quote is already final');
  }
  if (row.status !== 'sent' && row.status !== 'viewed') {
    throw new QuoteError(404, 'not_found', 'Quote not found');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE quotes SET status = ?, declined_at = ?, updated_at = ? WHERE id = ?').run('declined', now, now, row.id);
  recordEvent(db, row.id, 'decline', reason);
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(row.id);
}

export function parsePublicToken(token) {
  return typeof token === 'string' && /^[0-9a-f]{32}$/.test(token) ? token : null;
}
