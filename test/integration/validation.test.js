import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { api, assertErr, assertOk, boot, createQuote, quoteBody, sendQuote, signup } from './helpers.js';

const PORT = 3224;

let server;
let alice;
let bob;

before(async () => {
  server = await boot({ port: PORT });
  alice = await signup(server, { name: 'Alice' });
  bob = await signup(server, { name: 'Bob' });
  // This file exercises write validation, not plan gating; the direct-DB
  // incomplete draft also consumes a free-plan slot, so take quota out of play.
  assertOk(await api(server, 'POST', '/api/billing/demo-upgrade', { cookie: alice.cookie }));
});

after(async () => {
  await server?.close();
});

// Create validation makes incomplete drafts unreachable through the API
// (title/client_name/items are enforced at create time), so seed the row
// directly to exercise the send-time guard (§6) for legacy/edge data.
function insertIncompleteDraft(dataDir, userId) {
  const db = new DatabaseSync(join(dataDir, 'app.db'));
  try {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO quotes (user_id, public_token, title, client_name, items, status, created_at, updated_at)
         VALUES (?, ?, '', '', '[]', 'draft', ?, ?)`
      )
      .run(userId, randomBytes(16).toString('hex'), now, now);
    return Number(info.lastInsertRowid);
  } finally {
    db.close();
  }
}

test('write-body validation 400s match contract §8', async () => {
  const cases = [
    [{ currency: 'XXX' }, 'invalid_currency'],
    [{ items: [] }, 'invalid_items'],
    [{ items: Array.from({ length: 51 }, (_, i) => ({ desc: `item ${i}`, qty: 1, unit_price_cents: 100 })) }, 'invalid_items'],
    [{ items: [{ desc: 'ok', qty: 0, unit_price_cents: 100 }] }, 'invalid_items'],
    [{ items: [{ desc: 'x'.repeat(501), qty: 1, unit_price_cents: 100 }] }, 'invalid_items'],
    [{ items: [{ desc: 'ok', qty: 1, unit_price_cents: 1.5 }] }, 'invalid_items'],
    [{ title: 'x'.repeat(201) }, 'invalid_title'],
    [{ client_name: '' }, 'invalid_client_name'],
    [{ client_email: 'not-an-email' }, 'invalid_client_email'],
    [{ notes: 'n'.repeat(2001) }, 'invalid_notes'],
    [{ terms: 't'.repeat(2001) }, 'invalid_terms'],
    [{ valid_until: '2026-13-40' }, 'invalid_valid_until']
  ];
  for (const [overrides, code] of cases) {
    const res = await api(server, 'POST', '/api/quotes', { cookie: alice.cookie, body: quoteBody(overrides) });
    assertErr(res, 400, code);
  }
});

test('pct out of range 400s: contract §8 validation governs the API surface', async () => {
  // §2 clamps at the money.js layer; the API layer validates 0-100 and rejects (§8).
  assertErr(
    await api(server, 'POST', '/api/quotes', { cookie: alice.cookie, body: quoteBody({ discount_pct: 150 }) }),
    400,
    'invalid_discount_pct'
  );
  assertErr(
    await api(server, 'POST', '/api/quotes', { cookie: alice.cookie, body: quoteBody({ tax_pct: -1 }) }),
    400,
    'invalid_tax_pct'
  );
});

test('send on incomplete draft -> 400 incomplete', async () => {
  const id = insertIncompleteDraft(server.dataDir, alice.user.id);
  assertErr(await sendQuote(server, alice.cookie, id), 400, 'incomplete');
});

test('PUT and DELETE on sent quote -> 409 not_draft (§6)', async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Sent quote' }), 201);
  assertOk(await sendQuote(server, alice.cookie, quote.id));

  assertErr(
    await api(server, 'PUT', `/api/quotes/${quote.id}`, { cookie: alice.cookie, body: quoteBody({ title: 'Edited' }) }),
    409,
    'not_draft'
  );
  assertErr(await api(server, 'DELETE', `/api/quotes/${quote.id}`, { cookie: alice.cookie }), 409, 'not_draft');
});

test('re-send after view -> 200 and no status regression (§6)', async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Resend quote' }), 201);
  assertOk(await sendQuote(server, alice.cookie, quote.id));
  await api(server, 'GET', `/q/${quote.public_token}`);

  const resent = assertOk(await sendQuote(server, alice.cookie, quote.id));
  assert.equal(resent.quote.status, 'viewed', 'viewed must not regress on re-send');
  assert.equal(resent.public_url, `http://localhost:${PORT}/q/${quote.public_token}`);
});

test('accept/decline on draft -> 404 (approved contract resolution)', async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Draft quote' }), 201);
  assertErr(
    await api(server, 'POST', `/api/public/quotes/${quote.public_token}/accept`, { body: { name: 'X', agree: true } }),
    404,
    'not_found'
  );
  assertErr(
    await api(server, 'POST', `/api/public/quotes/${quote.public_token}/decline`, { body: { reason: 'no' } }),
    404,
    'not_found'
  );
});

test('delete draft -> 200, then gone from list and GET', async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Doomed draft' }), 201);
  assertOk(await api(server, 'DELETE', `/api/quotes/${quote.id}`, { cookie: alice.cookie }));
  assertErr(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie: alice.cookie }), 404, 'not_found');

  const { quotes } = assertOk(await api(server, 'GET', '/api/quotes', { cookie: alice.cookie }));
  assert.ok(!quotes.some((q) => q.id === quote.id));
});

test("other users' quotes -> 404 on GET/PUT/DELETE/send", async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Alice private' }), 201);

  assertErr(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie: bob.cookie }), 404, 'not_found');
  assertErr(
    await api(server, 'PUT', `/api/quotes/${quote.id}`, { cookie: bob.cookie, body: quoteBody({ title: 'Hijacked' }) }),
    404,
    'not_found'
  );
  assertErr(await api(server, 'DELETE', `/api/quotes/${quote.id}`, { cookie: bob.cookie }), 404, 'not_found');
  assertErr(await sendQuote(server, bob.cookie, quote.id), 404, 'not_found');

  // Owner still sees the untouched quote.
  const { quote: intact } = assertOk(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie: alice.cookie }));
  assert.equal(intact.title, 'Alice private');
  assert.equal(intact.status, 'draft');
});
