import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/db.js';
import { canCreateQuote, countQuotesThisMonth, monthBoundsUtc, quotaFor, FREE_MONTHLY_QUOTES } from '../../src/lib/gating.js';
import { insertQuote, QuoteError } from '../../src/lib/quotes.js';

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
