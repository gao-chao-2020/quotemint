import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { api, assertErr, assertOk, boot, signup } from './helpers.js';

const PORT = 3226;
const MISSING_SECRET_PORT = 3227;
const SECRET = 'whsec_testsecret';

let server;
let bareServer;
let userOne;
let userTwo;

function sign(rawBody, { t = Math.floor(Date.now() / 1000), secret = SECRET } = {}) {
  const hmac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${hmac}`;
}

function postWebhook(target, rawBody, { signature, secret = SECRET } = {}) {
  const header = signature === undefined ? sign(rawBody, { secret }) : signature;
  return api(target, 'POST', '/webhooks/stripe', {
    csrf: false,
    raw: rawBody,
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }
  });
}

before(async () => {
  server = await boot({ port: PORT, env: { STRIPE_WEBHOOK_SECRET: SECRET } });
  userOne = await signup(server, { name: 'Checkout One' });
  userTwo = await signup(server, { name: 'Checkout Two' });
});

after(async () => {
  await server?.close();
  await bareServer?.close();
});

test('bad signature -> 400 invalid_signature (§10)', async () => {
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
  assertErr(await postWebhook(server, raw, { signature: 't=' + Math.floor(Date.now() / 1000) + ',v1=deadbeef' }), 400, 'invalid_signature');
  assertErr(await postWebhook(server, raw, { signature: '' }), 400, 'invalid_signature');
});

test('timestamp older than 300s -> 400 even with a valid HMAC (§10)', async () => {
  const raw = JSON.stringify({
    id: 'evt_old',
    type: 'checkout.session.completed',
    data: { object: { metadata: { user_id: String(userOne.user.id) } } }
  });
  const oldT = Math.floor(Date.now() / 1000) - 301;
  assertErr(await postWebhook(server, raw, { signature: sign(raw, { t: oldT }) }), 400, 'invalid_signature');

  // user must NOT have been upgraded by the rejected replay.
  const { user } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: userOne.cookie }));
  assert.equal(user.plan, 'free');
});

test('checkout.session.completed with valid signature upgrades user via metadata.user_id', async () => {
  const raw = JSON.stringify({
    id: 'evt_checkout_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        mode: 'subscription',
        payment_status: 'paid',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        client_reference_id: String(userOne.user.id),
        metadata: { user_id: String(userOne.user.id) }
      }
    }
  });
  const res = await postWebhook(server, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user, quota } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: userOne.cookie }));
  assert.equal(user.plan, 'pro');
  assert.equal(quota.max, null);
  const renewsAt = Date.parse(user.plan_renews_at);
  assert.ok(Math.abs(renewsAt - (Date.now() + 31 * 24 * 60 * 60 * 1000)) < 5 * 60 * 1000);
});

test('checkout.session.completed falls back to client_reference_id (§10)', async () => {
  const raw = JSON.stringify({
    id: 'evt_checkout_2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_2',
        mode: 'subscription',
        payment_status: 'paid',
        customer: 'cus_test_2',
        subscription: 'sub_test_2',
        client_reference_id: String(userTwo.user.id)
      }
    }
  });
  assert.equal((await postWebhook(server, raw)).status, 200);

  const { user } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: userTwo.cookie }));
  assert.equal(user.plan, 'pro');
});

test('customer.subscription.deleted downgrades the matching user (§10)', async () => {
  const raw = JSON.stringify({
    id: 'evt_del_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_test_1' } }
  });
  assert.equal((await postWebhook(server, raw)).status, 200);

  const { user, quota } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: userOne.cookie }));
  assert.equal(user.plan, 'free');
  assert.equal(user.plan_renews_at, null, 'plan_renews_at must be nulled on cancellation');
  assert.equal(quota.max, 3);
});

test('unhandled event types are ignored but acknowledged (§10)', async () => {
  const raw = JSON.stringify({ id: 'evt_other', type: 'invoice.paid', data: { object: {} } });
  const res = await postWebhook(server, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user } = assertOk(await api(server, 'GET', '/api/auth/me', { cookie: userTwo.cookie }));
  assert.equal(user.plan, 'pro', 'unrelated event must not touch plans');
});

test('server without STRIPE_WEBHOOK_SECRET -> 503 billing_disabled (§10)', async () => {
  bareServer = await boot({ port: MISSING_SECRET_PORT });
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
  assertErr(await postWebhook(bareServer, raw), 503, 'billing_disabled');
});
