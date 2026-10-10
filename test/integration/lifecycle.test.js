import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertErr, assertOk, boot, createQuote, quoteBody, sendQuote, signup } from './helpers.js';

const PORT = 3221;

let server;
let cookie;

before(async () => {
  server = await boot({ port: PORT });
});

after(async () => {
  await server?.close();
});

// Fractional qty + fractional discount + fractional tax, per contract §2:
//   item1: round(2.5 * 1999) = round(4997.5) = 4998
//   item2: 1 * 25000 = 25000
//   subtotal = 29998; discount 10.5% -> round(3149.79) = 3150
//   tax 8.25% on (29998-3150)=26848 -> round(2214.96) = 2215
//   total = 26848 + 2215 = 29063
const EXACT_MATH_BODY = quoteBody({
  title: 'Brand identity package',
  client_name: 'Acme Corp',
  items: [
    { desc: 'Logo design', qty: 2.5, unit_price_cents: 1999 },
    { desc: 'Style guide', qty: 1, unit_price_cents: 25000 }
  ],
  discount_pct: 10.5,
  tax_pct: 8.25
});
const EXACT_TOTALS = { subtotal_cents: 29998, discount_cents: 3150, tax_cents: 2215, total_cents: 29063 };

test('signup response has user shape and session cookie', async () => {
  const account = await signup(server, { name: 'Sarah Freelance' });
  cookie = account.cookie;
  assert.ok(cookie.startsWith('qm_session='), 'expected qm_session cookie');
  const { user } = assertOk(account.res, 201);
  assert.equal(user.name, 'Sarah Freelance');
  assert.equal(user.plan, 'free');
  assert.ok(!('password_hash' in user), 'password_hash must never be returned');
});

test('create quote computes exact cents math from contract §2', async () => {
  const res = await api(server, 'POST', '/api/quotes', { cookie, body: EXACT_MATH_BODY });
  const { quote } = assertOk(res, 201);
  assert.equal(quote.status, 'draft');
  assert.deepEqual(quote.totals, EXACT_TOTALS);
  assert.deepEqual(quote.items, EXACT_MATH_BODY.items);
  assert.match(quote.public_token, /^[0-9a-f]{32}$/);
});

test('full lifecycle: send -> view -> accept with typed-name signature', async () => {
  const created = assertOk(await api(server, 'POST', '/api/quotes', { cookie, body: EXACT_MATH_BODY }), 201);
  const quote = created.quote;
  const token = quote.public_token;

  // Draft public view renders a draft ribbon and records nothing (§6).
  const draftView = await api(server, 'GET', `/q/${token}`);
  assert.equal(draftView.status, 200);
  assert.match(draftView.headers.get('content-type'), /text\/html/);

  const afterDraftView = assertOk(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie }));
  assert.equal(afterDraftView.quote.status, 'draft');
  assert.equal(afterDraftView.quote.views, 0);

  // Send.
  const sent = assertOk(await sendQuote(server, cookie, quote.id));
  assert.equal(sent.quote.status, 'sent');
  assert.ok(sent.quote.sent_at, 'sent_at must be set');
  assert.equal(sent.public_url, `http://localhost:${PORT}/q/${token}`);

  // First public view upgrades sent -> viewed, records one view event (§6).
  const viewed = await api(server, 'GET', `/q/${token}`);
  assert.equal(viewed.status, 200);
  assert.ok(viewed.text.includes(EXACT_MATH_BODY.client_name));

  const afterView = assertOk(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie }));
  assert.equal(afterView.quote.status, 'viewed');
  assert.ok(afterView.quote.viewed_at, 'viewed_at must be set');
  assert.equal(afterView.quote.views, 1);

  // Accept without agreeing -> 400, state untouched.
  assertErr(
    await api(server, 'POST', `/api/public/quotes/${token}/accept`, { body: { name: 'Jane Client', agree: false } }),
    400,
    'not_agreed'
  );

  // Accept with typed name.
  const accepted = assertOk(
    await api(server, 'POST', `/api/public/quotes/${token}/accept`, { body: { name: 'Jane Client', agree: true } })
  );
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.accepted_name, 'Jane Client');
  assert.ok(!Number.isNaN(Date.parse(accepted.accepted_at)), 'accepted_at must be an ISO date');

  const finalQuote = assertOk(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie }));
  assert.equal(finalQuote.quote.status, 'accepted');
  assert.equal(finalQuote.quote.accepted_name, 'Jane Client');
  assert.equal(finalQuote.quote.views, 1);

  // Public page shows the accepted stamp.
  const publicAfter = await api(server, 'GET', `/q/${token}`);
  assert.ok(publicAfter.text.includes('Accepted'), 'accepted stamp missing');
  assert.ok(publicAfter.text.includes('Jane Client'), 'signer name missing');

  // Re-accept on a final quote -> 409 (§9).
  assertErr(
    await api(server, 'POST', `/api/public/quotes/${token}/accept`, { body: { name: 'Someone Else', agree: true } }),
    409,
    'already_final'
  );
});

test('decline path: reason recorded, decline again 409, accept on declined 409', async () => {
  const quote = assertOk(await api(server, 'POST', '/api/quotes', { cookie, body: quoteBody() }), 201).quote;
  assertOk(await sendQuote(server, cookie, quote.id));
  await api(server, 'GET', `/q/${quote.public_token}`);

  const declined = assertOk(
    await api(server, 'POST', `/api/public/quotes/${quote.public_token}/decline`, { body: { reason: 'Budget cuts' } })
  );
  assert.equal(declined.status, 'declined');

  assertErr(
    await api(server, 'POST', `/api/public/quotes/${quote.public_token}/decline`, { body: { reason: 'again' } }),
    409,
    'already_final'
  );
  assertErr(
    await api(server, 'POST', `/api/public/quotes/${quote.public_token}/accept`, { body: { name: 'X', agree: true } }),
    409,
    'already_final'
  );
});

test('quote list item shape matches contract §8, newest first, views counted', async () => {
  const { quotes } = assertOk(await api(server, 'GET', '/api/quotes', { cookie }));
  assert.ok(quotes.length >= 2);
  const expectedKeys = [
    'accepted_at', 'client_name', 'created_at', 'currency', 'id', 'public_token',
    'sent_at', 'status', 'title', 'total_cents', 'valid_until', 'viewed_at', 'views'
  ];
  assert.deepEqual(Object.keys(quotes[0]).sort(), expectedKeys);
  assert.ok(quotes[0].id > quotes[1].id, 'newest first');
  const acceptedItem = quotes.find((q) => q.status === 'accepted');
  assert.ok(acceptedItem, 'accepted quote missing from list');
  assert.equal(acceptedItem.views, 1);
  assert.equal(acceptedItem.total_cents, EXACT_TOTALS.total_cents);
});

test('send on accepted quote -> 409 already_final (§6)', async () => {
  const { quotes } = assertOk(await api(server, 'GET', '/api/quotes', { cookie }));
  const accepted = quotes.find((q) => q.status === 'accepted');
  assertErr(await sendQuote(server, cookie, accepted.id), 409, 'already_final');
});

test('unknown public token -> 404 json and 404 html page', async () => {
  const fakeToken = '0'.repeat(32);
  assertErr(await api(server, 'POST', `/api/public/quotes/${fakeToken}/accept`, { body: { name: 'X', agree: true } }), 404, 'not_found');
  const page = await api(server, 'GET', `/q/${fakeToken}`);
  assert.equal(page.status, 404);
});
