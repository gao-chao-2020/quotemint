import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertErr, assertOk, boot, createQuote, quoteBody, sendQuote, signup } from './helpers.js';

const PORT = 3225;

let server;
let alice;
let bob;

before(async () => {
  // clientIp() honors X-Forwarded-For only behind a trusted proxy (TRUST_PROXY=1,
  // README deployment section); the rate-limit test needs distinct simulated IPs.
  server = await boot({ port: PORT, env: { STRIPE_WEBHOOK_SECRET: 'whsec_testsecret', TRUST_PROXY: '1' } });
  alice = await signup(server, { name: 'Alice' });
  bob = await signup(server, { name: 'Bob' });
});

after(async () => {
  await server?.close();
});

test('security headers present on every response (§13)', async () => {
  const res = await api(server, 'GET', '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('mutating /api/* without X-Requested-With -> 403 csrf (§5)', async () => {
  assertErr(
    await api(server, 'POST', '/api/auth/login', { csrf: false, body: { email: 'a@b.co', password: 'password123' } }),
    403,
    'csrf'
  );
  assertErr(
    await api(server, 'POST', '/api/quotes', { csrf: false, cookie: alice.cookie, body: quoteBody() }),
    403,
    'csrf'
  );
});

test('Origin host mismatch -> 403 origin; matching origin passes (§5)', async () => {
  assertErr(
    await api(server, 'POST', '/api/auth/login', {
      headers: { Origin: 'http://evil.example' },
      body: { email: alice.email, password: alice.password }
    }),
    403,
    'origin'
  );

  const sameOrigin = await api(server, 'POST', '/api/auth/login', {
    headers: { Origin: `http://localhost:${PORT}` },
    body: { email: alice.email, password: 'wrong-password' }
  });
  assertErr(sameOrigin, 401, 'invalid_credentials');
});

test('/webhooks/stripe is exempt from the CSRF header rule (§5 + approved resolution)', async () => {
  const res = await api(server, 'POST', '/webhooks/stripe', {
    csrf: false,
    raw: '{"type":"noop"}',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' }
  });
  assertErr(res, 400, 'invalid_signature');
});

test('cross-user isolation: Bob cannot read, edit, or delete Alice quotes', async () => {
  const { quote } = assertOk(await createQuote(server, alice.cookie, { title: 'Alice secret' }), 201);

  assertErr(await api(server, 'GET', `/api/quotes/${quote.id}`, { cookie: bob.cookie }), 404, 'not_found');
  assertErr(
    await api(server, 'PUT', `/api/quotes/${quote.id}`, { cookie: bob.cookie, body: quoteBody({ title: 'stolen' }) }),
    404,
    'not_found'
  );
  assertErr(await api(server, 'DELETE', `/api/quotes/${quote.id}`, { cookie: bob.cookie }), 404, 'not_found');

  const listForBob = assertOk(await api(server, 'GET', '/api/quotes', { cookie: bob.cookie }));
  assert.ok(!listForBob.quotes.some((q) => q.id === quote.id), "Alice's quote leaked into Bob's list");
  assertErr(await api(server, 'GET', '/api/quotes'), 401, 'not_authenticated');
});

test('XSS probe: raw script/attribute payloads are escaped on the public page (§12)', async () => {
  const scriptPayload = '<script>alert(1)</script>';
  const attrPayload = '"><img src=x onerror=alert(1)>';
  const { quote } = assertOk(
    await createQuote(server, alice.cookie, {
      title: 'XSS probe',
      client_name: scriptPayload,
      notes: attrPayload
    }),
    201
  );
  assertOk(await sendQuote(server, alice.cookie, quote.id));

  const page = await api(server, 'GET', `/q/${quote.public_token}`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('<script>alert(1)</script>'), 'raw script payload rendered unescaped');
  assert.ok(!page.text.includes('"><img src=x onerror=alert(1)>'), 'raw attribute payload rendered unescaped');
  assert.ok(page.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped script payload missing');
  assert.ok(page.text.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'escaped attribute payload missing');
});

test('static path traversal attempts -> 404, never file contents (§13)', async () => {
  for (const path of ['/..%2fpackage.json', '/%2e%2e/package.json', '/..%2f..%2fpackage.json']) {
    const res = await api(server, 'GET', path);
    assert.equal(res.status, 404, `${path} should 404`);
    assert.ok(!res.text.includes('quotemint'), `${path} leaked package.json`);
  }
  const control = await api(server, 'GET', '/styles.css');
  assert.equal(control.status, 200, 'static serving itself must work');
  assert.match(control.headers.get('content-type'), /text\/css/);
});

test('auth rate limit: 20 attempts pass, 21st from same IP -> 429 (§4)', async () => {
  const ip = '203.0.113.7';
  for (let i = 1; i <= 20; i += 1) {
    const res = await api(server, 'POST', '/api/auth/login', {
      headers: { 'X-Forwarded-For': ip },
      body: { email: `nobody.${i}@test.local`, password: 'password123' }
    });
    assertErr(res, 401, 'invalid_credentials');
  }
  const limited = await api(server, 'POST', '/api/auth/login', {
    headers: { 'X-Forwarded-For': ip },
    body: { email: 'nobody.21@test.local', password: 'password123' }
  });
  assertErr(limited, 429, 'rate_limited');

  // A different IP is unaffected.
  const other = await api(server, 'POST', '/api/auth/login', {
    headers: { 'X-Forwarded-For': '198.51.100.9' },
    body: { email: 'nobody.other@test.local', password: 'password123' }
  });
  assertErr(other, 401, 'invalid_credentials');
});

test('request body over 1MB -> 413 payload_too_large (§13)', async () => {
  const huge = JSON.stringify(quoteBody({ notes: 'a'.repeat(1_200_000) }));
  const res = await api(server, 'POST', '/api/quotes', { cookie: alice.cookie, raw: huge });
  assertErr(res, 413, 'payload_too_large');
});
