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

after(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function makeUser(email, plan) {
  const info = await db.run(
    'INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, ?, ?, ?, ?)',
    email,
    'scrypt$x$y',
    'Test',
    plan,
    new Date().toISOString()
  );
  return db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
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

async function rawInsertQuote(userId, createdAt) {
  await db.run(
    `INSERT INTO quotes (user_id, public_token, title, client_name, items, status, created_at, updated_at)
     VALUES (?, ?, 'Old', 'Client', '[]', 'draft', ?, ?)`,
    userId,
    crypto.randomUUID().replace(/-/g, ''),
    createdAt,
    createdAt
  );
}

test('free limit boundary: 3 allowed, 4th blocked', async () => {
  const user = await makeUser('free@test.dev', 'free');
  assert.equal(FREE_MONTHLY_QUOTES, 3);
  assert.equal(await countQuotesThisMonth(db, user.id), 0);
  assert.equal(await canCreateQuote(db, user), true);
  await insertQuote(db, user, QUOTE_DATA);
  await insertQuote(db, user, QUOTE_DATA);
  assert.equal(await canCreateQuote(db, user), true);
  await insertQuote(db, user, QUOTE_DATA);
  assert.equal(await countQuotesThisMonth(db, user.id), 3);
  assert.equal(await canCreateQuote(db, user), false);
  await assert.rejects(
    () => insertQuote(db, user, QUOTE_DATA),
    (err) => err instanceof QuoteError && err.status === 403 && err.code === 'free_limit_reached'
  );
});

test('month rollover: quotes from a previous month do not count', async () => {
  const user = await makeUser('rollover@test.dev', 'free');
  const prevMonth = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await rawInsertQuote(user.id, prevMonth);
  assert.equal(await countQuotesThisMonth(db, user.id), 0);
  assert.equal(await canCreateQuote(db, user), true);
  await insertQuote(db, user, QUOTE_DATA);
  await insertQuote(db, user, QUOTE_DATA);
  await insertQuote(db, user, QUOTE_DATA);
  assert.equal(await canCreateQuote(db, user), false);
});

test('quota shape: free max 3 with UTC month reset', async () => {
  const user = await makeUser('quota@test.dev', 'free');
  await rawInsertQuote(user.id, new Date().toISOString());
  const quota = await quotaFor(db, user);
  const { resetsAt } = monthBoundsUtc();
  assert.equal(quota.used, 1);
  assert.equal(quota.max, 3);
  assert.equal(quota.resets_at, resetsAt);
  const resetDate = new Date(quota.resets_at);
  assert.equal(resetDate.getUTCDate(), 1);
  assert.equal(resetDate.getUTCHours(), 0);
  assert.ok(resetDate.getTime() > Date.now());
});

test('pro users are unlimited with max null', async () => {
  const user = await makeUser('pro@test.dev', 'pro');
  for (let i = 0; i < 5; i += 1) await insertQuote(db, user, QUOTE_DATA);
  assert.equal(await canCreateQuote(db, user), true);
  const quota = await quotaFor(db, user);
  assert.equal(quota.used, 5);
  assert.equal(quota.max, null);
});

test('updateQuoteRow edits drafts only (race guard)', async () => {
  const user = await makeUser('guard@test.dev', 'pro');
  const draft = await insertQuote(db, user, QUOTE_DATA);
  const edited = await updateQuoteRow(db, draft.id, user.id, { ...QUOTE_DATA, title: 'Edited title' });
  assert.ok(edited);
  assert.equal(edited.title, 'Edited title');
  assert.equal(edited.status, 'draft');
  await sendQuote(db, edited);
  assert.equal(await updateQuoteRow(db, draft.id, user.id, { ...QUOTE_DATA, title: 'Late edit' }), null);
  const row = await db.get('SELECT title, status FROM quotes WHERE id = ?', draft.id);
  assert.equal(row.status, 'sent');
  assert.equal(row.title, 'Edited title');
  const other = await makeUser('guard2@test.dev', 'pro');
  const othersDraft = await insertQuote(db, other, QUOTE_DATA);
  assert.equal(await updateQuoteRow(db, othersDraft.id, user.id, QUOTE_DATA), null);
});

test('markViewed records one view event and dedupes rapid repeats', async () => {
  const user = await makeUser('views@test.dev', 'pro');
  const quote = await sendQuote(db, await insertQuote(db, user, QUOTE_DATA));
  const first = await markViewed(db, quote);
  assert.equal(first.status, 'viewed');
  assert.ok(first.viewed_at);
  await markViewed(db, first);
  await markViewed(db, first);
  const views = (await listEvents(db, quote.id)).filter((e) => e.type === 'view');
  assert.equal(views.length, 1);
});

test('markViewed appends a new event when the last view is older than 60s', async () => {
  const user = await makeUser('views-old@test.dev', 'pro');
  const quote = await sendQuote(db, await insertQuote(db, user, QUOTE_DATA));
  const first = await markViewed(db, quote);
  await db.run(
    `UPDATE quote_events SET at = ? WHERE quote_id = ? AND type = 'view'`,
    new Date(Date.now() - 61000).toISOString(),
    quote.id
  );
  const second = await markViewed(db, first);
  assert.equal(second.status, 'viewed');
  assert.equal((await listEvents(db, quote.id)).filter((e) => e.type === 'view').length, 2);
});

test('markViewed ignores draft quotes entirely', async () => {
  const user = await makeUser('views-draft@test.dev', 'pro');
  const draft = await insertQuote(db, user, QUOTE_DATA);
  const viewed = await markViewed(db, draft);
  assert.equal(viewed.status, 'draft');
  assert.equal(viewed.viewed_at, null);
  assert.equal((await listEvents(db, draft.id)).length, 0);
});
