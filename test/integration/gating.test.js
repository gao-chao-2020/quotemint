import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertErr, assertOk, boot, createQuote, signup } from './helpers.js';

const PORT = 3222;

let server;
let account;
let firstToken;

before(async () => {
  server = await boot({ port: PORT });
  account = await signup(server, { name: 'Free User' });
});

after(async () => {
  await server?.close();
});

test('free user can create 3 quotes, 4th -> 403 free_limit_reached (§7)', async () => {
  for (let i = 0; i < 3; i += 1) {
    const { quote } = assertOk(await createQuote(server, account.cookie, { title: `Quote ${i + 1}` }), 201);
    assert.equal(quote.status, 'draft');
    if (i === 0) firstToken = quote.public_token;
  }
  assertErr(await createQuote(server, account.cookie, { title: 'Quote 4' }), 403, 'free_limit_reached');

  const { quota } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: account.cookie }));
  assert.equal(quota.used, 3);
  assert.equal(quota.max, 3);
  const now = new Date();
  const expectedReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  assert.equal(quota.resets_at, expectedReset);
});

test('free user public page shows the Powered by badge (§7)', async () => {
  const page = await api(server, 'GET', `/q/${firstToken}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('Powered by'), 'free plan badge missing');
});

test('free user has events hidden (null) and branding blocked (§3, §7)', async () => {
  const { quotes } = assertOk(await api(server, 'GET', '/api/quotes', { cookie: account.cookie }));
  const { events } = assertOk(await api(server, 'GET', `/api/quotes/${quotes[0].id}`, { cookie: account.cookie }));
  assert.equal(events, null, 'events must be null for free plan');

  assertErr(
    await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { company: 'Acme Studio' } }),
    403,
    'pro_required'
  );
});

test('demo-upgrade -> pro: plan, renews_at, unlimited quotes', async () => {
  const before = Date.now();
  const { user } = assertOk(await api(server, 'POST', '/api/billing/demo-upgrade', { cookie: account.cookie }));
  assert.equal(user.plan, 'pro');
  const renewsAt = Date.parse(user.plan_renews_at);
  const expected = before + 31 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(renewsAt - expected) < 5 * 60 * 1000, `plan_renews_at ${user.plan_renews_at} not ~31d out`);

  assertOk(await createQuote(server, account.cookie, { title: 'Quote 4 (pro)' }), 201);
  assertOk(await createQuote(server, account.cookie, { title: 'Quote 5 (pro)' }), 201);

  const { quota } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: account.cookie }));
  assert.equal(quota.max, null, 'pro quota max must be null');
  assert.equal(quota.used, 5);
});

test('pro user: badge gone, events visible, branding reflected on public page (§7, §11)', async () => {
  const page = await api(server, 'GET', `/q/${firstToken}`);
  assert.ok(!page.text.includes('Powered by'), 'pro badge must not render');

  assertOk(
    await api(server, 'PUT', '/api/auth/profile', {
      cookie: account.cookie,
      body: { company: 'Acme Studio', brand_color: '#123456' }
    })
  );

  const { quotes } = assertOk(await api(server, 'GET', '/api/quotes', { cookie: account.cookie }));
  const newest = quotes[0];

  const branded = await api(server, 'GET', `/q/${newest.public_token}`);
  assert.ok(branded.text.includes('Acme Studio'), 'company missing from public page');
  assert.ok(branded.text.includes('--brand:#123456'), 'brand_color missing from public page');

  const { events } = assertOk(await api(server, 'GET', `/api/quotes/${newest.id}`, { cookie: account.cookie }));
  assert.ok(Array.isArray(events), 'events must be an array for pro');
});
