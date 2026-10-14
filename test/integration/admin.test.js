import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { api, assertErr, assertOk, boot, signup } from './helpers.js';
import { hashPassword } from '../../src/lib/auth.js';

const PORT = 3228;
const PORT_OFF = 3229;
const ADMIN_PASSWORD = 'admin-password-123';
const ADMIN_SECRET = 'integration-admin-secret';

let off;
let server;
let adminCookie = '';
let user;

function cookieFrom(res) {
  const match = /qm_admin=([^;]+)/.exec(res.setCookie || '');
  return match ? `qm_admin=${match[1]}` : '';
}

// Reads the live SQLite file directly (WAL allows concurrent readers) so plan,
// renews_at, and audit rows are verified against what was actually stored.
function withDb(fn) {
  const db = new DatabaseSync(join(server.dataDir, 'app.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function readPlan(email) {
  return withDb((db) => db.prepare('SELECT plan, plan_renews_at FROM users WHERE email = ?').get(email));
}

function readAdminEvents() {
  return withDb((db) => db.prepare('SELECT action, target_email, detail FROM admin_events ORDER BY id DESC').all());
}

before(async () => {
  off = await boot({ port: PORT_OFF, env: { ADMIN_PASSWORD_HASH: '', ADMIN_SESSION_SECRET: '' } });
  server = await boot({
    port: PORT,
    env: {
      ADMIN_PASSWORD_HASH: hashPassword(ADMIN_PASSWORD),
      ADMIN_SESSION_SECRET: ADMIN_SECRET,
      TRUST_PROXY: '1'
    }
  });
  user = await signup(server, { name: 'Admin Target' });
});

after(async () => {
  await off?.close();
  await server?.close();
});

test('gate off: /admin paths are a byte-identical 404 to a nonexistent route', async () => {
  const control = await api(off, 'GET', '/definitely-not-a-route');
  assert.equal(control.status, 404);
  for (const path of ['/admin', '/admin/login', '/admin/users?q=x', '/admin.js', '/admin/admin.js', '/%61dmin.js', '/.%2fadmin.js']) {
    const res = await api(off, 'GET', path);
    assert.equal(res.status, 404, `${path} must 404 when unconfigured`);
    assert.equal(res.text, control.text, `${path} must be indistinguishable from a nonexistent route`);
  }
  const post = await api(off, 'POST', '/admin/login', { body: { password: 'x' } });
  assert.equal(post.status, 404);
  assert.equal(post.text, control.text);
});

test('configured: wrong or missing password -> 401 bad_password', async () => {
  assertErr(await api(server, 'POST', '/admin/login', { body: { password: 'wrong-password' } }), 401, 'bad_password');
  assertErr(await api(server, 'POST', '/admin/login', { body: {} }), 401, 'bad_password');
});

test('configured: correct password sets the qm_admin cookie', async () => {
  const res = await api(server, 'POST', '/admin/login', { body: { password: ADMIN_PASSWORD } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.ok, true);
  assert.match(res.setCookie, /qm_admin=\d+\.[0-9a-f]{64}/);
  assert.match(res.setCookie, /HttpOnly/);
  assert.match(res.setCookie, /SameSite=Lax/);
  assert.match(res.setCookie, /Path=\/admin/);
  assert.match(res.setCookie, /Max-Age=604800/);
  assert.ok(!/;\s*Secure/i.test(res.setCookie), 'Secure must be off on plain-http localhost');
  adminCookie = cookieFrom(res);
  assert.ok(adminCookie.length > 'qm_admin='.length);
});

test('unauthenticated or tampered admin requests: GET -> 302 login, JSON -> 401', async () => {
  let res = await api(server, 'GET', '/admin');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/login');

  res = await api(server, 'GET', '/admin', { cookie: 'qm_admin=9999999999999.deadbeef' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/login');

  res = await api(server, 'GET', '/admin/users', { cookie: 'qm_admin=abc.def' });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/login');

  // A regular user session must not open the admin surface.
  res = await api(server, 'GET', '/admin', { cookie: user.cookie });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin/login');

  assertErr(await api(server, 'POST', '/admin/grant', { body: { email: user.email } }), 401, 'not_authenticated');
});

test('GET /admin/login redirects to /admin once authenticated', async () => {
  const res = await api(server, 'GET', '/admin/login', { cookie: adminCookie });
  assert.equal(res.status, 302);
  assert.equal(res.location, '/admin');
});

test('dashboard renders stats, the user table, and admin.js is served', async () => {
  const res = await api(server, 'GET', '/admin', { cookie: adminCookie });
  assert.equal(res.status, 200, res.text);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(res.text.includes(user.email), 'user email should appear in the dashboard table');
  assert.ok(res.text.includes('admin-table'));
  assert.ok(res.text.includes('data-admin-grant'));

  const script = await api(server, 'GET', '/admin/admin.js');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);

  // The client script moved out of public/: no encoded variant may resurrect it.
  const encoded = await api(server, 'GET', '/%61dmin.js');
  assert.equal(encoded.status, 404, 'encoded /admin.js must not exist outside the gate');
});

test('grant sets plan pro, stacks active renewals, and writes admin_events rows', async () => {
  const first = assertOk(
    await api(server, 'POST', '/admin/grant', { cookie: adminCookie, body: { email: user.email, months: 2 } })
  );
  const firstMs = Date.parse(first.renews_at);
  assert.ok(Number.isFinite(firstMs), `renews_at must be an ISO timestamp: ${first.renews_at}`);
  const daysAhead = (firstMs - Date.now()) / 86_400_000;
  assert.ok(daysAhead > 55 && daysAhead < 65, `expected ~2 months ahead, got ${daysAhead.toFixed(1)} days`);

  let row = readPlan(user.email);
  assert.equal(row.plan, 'pro');
  assert.equal(row.plan_renews_at, first.renews_at);

  // A second grant extends the active renewal date instead of resetting it.
  const second = assertOk(
    await api(server, 'POST', '/admin/grant', { cookie: adminCookie, body: { email: user.email, months: 1 } })
  );
  const addedDays = (Date.parse(second.renews_at) - firstMs) / 86_400_000;
  assert.ok(addedDays > 27 && addedDays < 32, `expected +1 month from ${first.renews_at}, got +${addedDays.toFixed(1)} days`);
  row = readPlan(user.email);
  assert.equal(row.plan_renews_at, second.renews_at);

  const events = readAdminEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].action, 'grant');
  assert.equal(events[0].target_email, user.email);
  assert.equal(events[0].detail, '1');
  assert.equal(events[1].detail, '2');

  const page = await api(server, 'GET', `/admin/users?q=${encodeURIComponent(user.email)}`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('pill-pro'));
  assert.ok(page.text.includes(user.email));
});

test('revoke returns the account to free, clears renews_at, and writes the audit row', async () => {
  assertOk(await api(server, 'POST', '/admin/revoke', { cookie: adminCookie, body: { email: user.email } }));

  const row = readPlan(user.email);
  assert.equal(row.plan, 'free');
  assert.equal(row.plan_renews_at, null);

  const events = readAdminEvents();
  assert.equal(events[0].action, 'revoke');
  assert.equal(events[0].target_email, user.email);

  const page = await api(server, 'GET', `/admin/users?q=${encodeURIComponent(user.email)}`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('pill-free'));
});

test('admin POSTs without X-Requested-With -> 403 csrf', async () => {
  assertErr(await api(server, 'POST', '/admin/grant', { cookie: adminCookie, csrf: false, body: { email: user.email } }), 403, 'csrf');
  assertErr(await api(server, 'POST', '/admin/revoke', { cookie: adminCookie, csrf: false, body: { email: user.email } }), 403, 'csrf');
  assertErr(await api(server, 'POST', '/admin/login', { csrf: false, body: { password: ADMIN_PASSWORD } }), 403, 'csrf');
  assertErr(await api(server, 'POST', '/admin/logout', { cookie: adminCookie, csrf: false }), 403, 'csrf');
});

test('cross-origin admin POST -> 403 origin', async () => {
  assertErr(
    await api(server, 'POST', '/admin/grant', {
      cookie: adminCookie,
      headers: { Origin: 'https://evil.example' },
      body: { email: user.email }
    }),
    403,
    'origin'
  );
});

test('unknown email -> 404 user_not_found; invalid months -> 400 invalid_months', async () => {
  assertErr(await api(server, 'POST', '/admin/grant', { cookie: adminCookie, body: { email: 'nobody@test.local' } }), 404, 'user_not_found');
  assertErr(await api(server, 'POST', '/admin/revoke', { cookie: adminCookie, body: { email: 'nobody@test.local' } }), 404, 'user_not_found');
  assertErr(await api(server, 'POST', '/admin/grant', { cookie: adminCookie, body: { email: user.email, months: 0 } }), 400, 'invalid_months');
  assertErr(await api(server, 'POST', '/admin/grant', { cookie: adminCookie, body: { email: user.email, months: 121 } }), 400, 'invalid_months');
});

test('login rate limit: 10 attempts per IP per window, then 429', async () => {
  const headers = { 'X-Forwarded-For': '203.0.113.99' };
  for (let i = 0; i < 10; i += 1) {
    assertErr(await api(server, 'POST', '/admin/login', { headers, body: { password: 'wrong-password' } }), 401, 'bad_password');
  }
  assertErr(await api(server, 'POST', '/admin/login', { headers, body: { password: ADMIN_PASSWORD } }), 429, 'rate_limited');
});

test('logout clears the admin cookie', async () => {
  const res = await api(server, 'POST', '/admin/logout', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.setCookie, /qm_admin=;/);
  assert.match(res.setCookie, /Max-Age=0/);
  assert.match(res.setCookie, /Path=\/admin/);
});
