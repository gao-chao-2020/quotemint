import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertErr, assertOk, boot, sessionCookie, signup, uniqueEmail } from './helpers.js';

const PORT = 3223;

let server;
let account;

before(async () => {
  server = await boot({ port: PORT });
  account = await signup(server, { name: 'Auth Tester' });
});

after(async () => {
  await server?.close();
});

test('signup sets HttpOnly SameSite=Lax cookie and returns full user shape (§3)', async () => {
  const { res } = account;
  const cookie = res.setCookie;
  assert.match(cookie, /qm_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.ok(!/Secure/.test(cookie), 'no Secure flag on http BASE_URL');

  const { user } = assertOk(res, 201);
  assert.deepEqual(Object.keys(user).sort(), [
    'brand_color', 'company', 'created_at', 'email', 'id', 'logo_text', 'name', 'plan', 'plan_renews_at'
  ]);
  assert.ok(!('password_hash' in user));
  assert.ok(!('stripe_customer_id' in user));
  assert.ok(!('stripe_subscription_id' in user));
});

test('/api/auth/me returns user + quota shapes (§3)', async () => {
  const { user, quota } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: account.cookie }));
  assert.equal(user.email, account.email);
  assert.deepEqual(Object.keys(quota).sort(), ['max', 'resets_at', 'used']);
  assert.equal(quota.max, 3);
  assert.equal(quota.used, 0);
  assert.ok(!Number.isNaN(Date.parse(quota.resets_at)));
});

test('duplicate email -> 409 email_taken', async () => {
  assertErr(
    await api(server, 'POST', '/api/auth/signup', { body: { email: account.email, password: 'password123', name: 'Dup' } }),
    409,
    'email_taken'
  );
});

test('wrong password and unknown email -> identical 401 invalid_credentials (§3)', async () => {
  const wrongPassword = await api(server, 'POST', '/api/auth/login', {
    body: { email: account.email, password: 'wrong-password' }
  });
  const unknownEmail = await api(server, 'POST', '/api/auth/login', {
    body: { email: uniqueEmail('ghost'), password: 'password123' }
  });
  assertErr(wrongPassword, 401, 'invalid_credentials');
  assertErr(unknownEmail, 401, 'invalid_credentials');
  assert.deepEqual(unknownEmail.body, wrongPassword.body, 'response bodies must be indistinguishable');
});

test('login with correct password -> 200 with user', async () => {
  const { user } = assertOk(
    await api(server, 'POST', '/api/auth/login', { body: { email: account.email, password: account.password } })
  );
  assert.equal(user.email, account.email);
});

test('me without cookie -> 401 not_authenticated', async () => {
  assertErr(await api(server, 'GET', '/api/auth/me'), 401, 'not_authenticated');
});

test('logout clears session - old cookie rejected afterwards', async () => {
  const fresh = await signup(server);
  assertOk(await api(server, 'POST', '/api/auth/logout', { cookie: fresh.cookie }));
  assertErr(await api(server, 'GET', '/api/auth/me', { cookie: fresh.cookie }), 401, 'not_authenticated');
});

test('signup validation 400s: bad email, short password, blank name', async () => {
  assertErr(
    await api(server, 'POST', '/api/auth/signup', { body: { email: 'not-an-email', password: 'password123', name: 'X' } }),
    400,
    'invalid_email'
  );
  assertErr(
    await api(server, 'POST', '/api/auth/signup', { body: { email: uniqueEmail(), password: 'short', name: 'X' } }),
    400,
    'invalid_password'
  );
  assertErr(
    await api(server, 'POST', '/api/auth/signup', { body: { email: uniqueEmail(), password: 'password123', name: '   ' } }),
    400,
    'invalid_name'
  );
});

test('profile: name always updatable; branding gated to pro (§3)', async () => {
  assertErr(await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { name: '   ' } }), 400, 'invalid_name');

  const renamed = assertOk(await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { name: 'Auth Tester 2' } }));
  assert.equal(renamed.user.name, 'Auth Tester 2');

  // Branding fields with plan=free -> 403 pro_required.
  assertErr(
    await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { brand_color: '#123456' } }),
    403,
    'pro_required'
  );

  // Upgrade (DEMO_MODE) then invalid values hit the 400 validators, not the plan gate.
  const upgraded = assertOk(await api(server, 'POST', '/api/billing/demo-upgrade', { cookie: account.cookie }));
  assert.equal(upgraded.user.plan, 'pro');

  assertErr(
    await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { brand_color: '#12345' } }),
    400,
    'invalid_brand_color'
  );
  assertErr(
    await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { company: 'c'.repeat(81) } }),
    400,
    'invalid_company'
  );
  assertErr(
    await api(server, 'PUT', '/api/auth/profile', { cookie: account.cookie, body: { logo_text: 'l'.repeat(41) } }),
    400,
    'invalid_logo_text'
  );
});

test('page auth redirects: /app without session -> /login; /login with session -> /app (§11)', async () => {
  const anon = await api(server, 'GET', '/app');
  assert.equal(anon.status, 302);
  assert.equal(anon.location, '/login');

  const loggedIn = await api(server, 'GET', '/login', { cookie: account.cookie });
  assert.equal(loggedIn.status, 302);
  assert.equal(loggedIn.location, '/app');
});

test('login issues a working session cookie', async () => {
  const res = await api(server, 'POST', '/api/auth/login', { body: { email: account.email, password: account.password } });
  assert.equal(res.status, 200);
  const cookie = sessionCookie(res.setCookie);
  assert.ok(cookie, 'login must set qm_session');
  assertOk(await api(server, 'GET', '/api/auth/me', { cookie }));
});
