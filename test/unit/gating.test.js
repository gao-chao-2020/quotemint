import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/db.js';
import { canCreateQuote, countQuotesThisMonth, monthBoundsUtc, quotaFor, FREE_MONTHLY_QUOTES } from '../../src/lib/gating.js';
import { insertQuote, listEvents, markViewed, QuoteError, sendQuote, updateQuoteRow } from '../../src/lib/quotes.js';

const dir = mkdtempSync(join(tmpdir(), 'qm-gating-'));
const db = openDb(dir);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeUser(email, plan) {
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, 'scrypt$x$y', 'Test', plan, new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
}

const QUOTE_DATA = {
  title: 'Test Quote',
  client_name: 'Client',
  client_email: '',
  currency: 'USD',
  items: [{ desc: 'work', qty: 1, unit_price_cents: 10000 }],
  discount_pct: 0,
  tax_pct: 0,
  notes: '',
  terms: '',
  valid_until: null
};

function rawInsertQuote(userId, createdAt) {
  db.prepare(
    `INSERT INTO quotes (user_id, public_token, title, client_name, items, status, created_at, updated_at)
     VALUES (?, ?, 'Old', 'Client', '[]', 'draft', ?, ?)`
  ).run(userId, crypto.randomUUID().replace(/-/g, ''), createdAt, createdAt);
}

test('free limit boundary: 3 allowed, 4th blocked', () => {
  const user = makeUser('free@test.dev', 'free');
  assert.equal(FREE_MONTHLY_QUOTES, 3);
  assert.equal(countQuotesThisMonth(db, user.id), 0);
  assert.equal(canCreateQuote(db, user), true);
  insertQuote(db, user, QUOTE_DATA);
  insertQuote(db, user, QUOTE_DATA);
  assert.equal(canCreateQuote(db, user), true);
  insertQuote(db, user, QUOTE_DATA);
  assert.equal(countQuotesThisMonth(db, user.id), 3);
  assert.equal(canCreateQuote(db, user), false);
  assert.throws(
    () => insertQuote(db, user, QUOTE_DATA),
    (err) => err instanceof QuoteError && err.status === 403 && err.code === 'free_limit_reached'
  );
});

test('month rollover: quotes from a previous month do not count', () => {
  const user = makeUser('rollover@test.dev', 'free');
  const prevMonth = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  rawInsertQuote(user.id, prevMonth);
  assert.equal(countQuotesThisMonth(db, user.id), 0);
  assert.equal(canCreateQuote(db, user), true);
  insertQuote(db, user, QUOTE_DATA);
  insertQuote(db, user, QUOTE_DATA);
  insertQuote(db, user, QUOTE_DATA);
  assert.equal(canCreateQuote(db, user), false);
});

test('quota shape: free max 3 with UTC month reset', () => {
  const user = makeUser('quota@test.dev', 'free');
  rawInsertQuote(user.id, new Date().toISOString());
  const quota = quotaFor(db, user);
  const { resetsAt } = monthBoundsUtc();
  assert.equal(quota.used, 1);
  assert.equal(quota.max, 3);
  assert.equal(quota.resets_at, resetsAt);
  const resetDate = new Date(quota.resets_at);
  assert.equal(resetDate.getUTCDate(), 1);
  assert.equal(resetDate.getUTCHours(), 0);
  assert.ok(resetDate.getTime() > Date.now());
});

test('pro users are unlimited with max null', () => {
  const user = makeUser('pro@test.dev', 'pro');
  for (let i = 0; i < 5; i += 1) insertQuote(db, user, QUOTE_DATA);
  assert.equal(canCreateQuote(db, user), true);
  const quota = quotaFor(db, user);
  assert.equal(quota.used, 5);
  assert.equal(quota.max, null);
});

test('updateQuoteRow edits drafts only (race guard)', () => {
  const user = makeUser('guard@test.dev', 'pro');
  const draft = insertQuote(db, user, QUOTE_DATA);
  const edited = updateQuoteRow(db, draft.id, user.id, { ...QUOTE_DATA, title: 'Edited title' });
  assert.ok(edited);
  assert.equal(edited.title, 'Edited title');
  assert.equal(edited.status, 'draft');
  sendQuote(db, edited);
  assert.equal(updateQuoteRow(db, draft.id, user.id, { ...QUOTE_DATA, title: 'Late edit' }), null);
  const row = db.prepare('SELECT title, status FROM quotes WHERE id = ?').get(draft.id);
  assert.equal(row.status, 'sent');
  assert.equal(row.title, 'Edited title');
  const other = makeUser('guard2@test.dev', 'pro');
  const othersDraft = insertQuote(db, other, QUOTE_DATA);
  assert.equal(updateQuoteRow(db, othersDraft.id, user.id, QUOTE_DATA), null);
});

test('markViewed records one view event and dedupes rapid repeats', () => {
  const user = makeUser('views@test.dev', 'pro');
  const quote = sendQuote(db, insertQuote(db, user, QUOTE_DATA));
  const first = markViewed(db, quote);
  assert.equal(first.status, 'viewed');
  assert.ok(first.viewed_at);
  markViewed(db, first);
  markViewed(db, first);
  const views = listEvents(db, quote.id).filter((e) => e.type === 'view');
  assert.equal(views.length, 1);
});

test('markViewed appends a new event when the last view is older than 60s', () => {
  const user = makeUser('views-old@test.dev', 'pro');
  const quote = sendQuote(db, insertQuote(db, user, QUOTE_DATA));
  const first = markViewed(db, quote);
  db.prepare(`UPDATE quote_events SET at = ? WHERE quote_id = ? AND type = 'view'`).run(
    new Date(Date.now() - 61000).toISOString(),
    quote.id
  );
  const second = markViewed(db, first);
  assert.equal(second.status, 'viewed');
  assert.equal(listEvents(db, quote.id).filter((e) => e.type === 'view').length, 2);
});

test('markViewed ignores draft quotes entirely', () => {
  const user = makeUser('views-draft@test.dev', 'pro');
  const draft = insertQuote(db, user, QUOTE_DATA);
  const after = markViewed(db, draft);
  assert.equal(after.status, 'draft');
  assert.equal(after.viewed_at, null);
  assert.equal(listEvents(db, draft.id).length, 0);
});
