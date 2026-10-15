import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { api, assertErr, assertOk, boot, signup } from './helpers.js';

// Provider matrix ports
const NONE_PORT = 3231;
const STRIPE_PORT = 3232;
const CREEM_PORT = 3233;
const STUB_PORT = 3234;
const BOTH_PORT = 3235;
const WEBHOOK_PORT = 3236;
const MISSING_SECRET_PORT = 3237;

const CREEM_KEY = 'creem_test_dummy_key';
const PRODUCT_ID = 'prod_test_quotemint';
const WEBHOOK_SECRET = 'creem_whsec_test';
const STUB_CHECKOUT_URL = 'https://checkout.creem.io/ch_stub_quotemint_1';

const STUB_BASE = `http://localhost:${STUB_PORT}`;

// Mirrors src/lib/creem.js verifyWebhook: HMAC-SHA256 hex of the raw body,
// keyed by the webhook secret, carried in the `creem-signature` header.
function creemSign(rawBody, secret = WEBHOOK_SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function postWebhook(target, rawBody, { signature } = {}) {
  const header = signature === undefined ? creemSign(rawBody) : signature;
  return api(target, 'POST', '/webhooks/creem', {
    csrf: false,
    raw: rawBody,
    headers: { 'Content-Type': 'application/json', 'creem-signature': header }
  });
}

function checkoutCompletedEvent(userId, { eventId = 'evt_stub_checkout_1', subscriptionId = 'sub_stub_1', customerId = 'cus_stub_1' } = {}) {
  return JSON.stringify({
    id: eventId,
    eventType: 'checkout.completed',
    object: {
      id: 'ch_stub_1',
      object: 'checkout',
      request_id: String(userId),
      metadata: { user_id: String(userId) },
      customer: { id: customerId, email: 'stub.buyer@example.com' },
      subscription: { id: subscriptionId, status: 'active' }
    }
  });
}

function subscriptionCanceledEvent(subscriptionId, { eventId = 'evt_stub_cancel_1' } = {}) {
  return JSON.stringify({
    id: eventId,
    eventType: 'subscription.canceled',
    object: { id: subscriptionId, object: 'subscription', status: 'canceled' }
  });
}

function readUserRow(dataDir, userId) {
  const db = new DatabaseSync(join(dataDir, 'app.db'), { readOnly: true });
  try {
    return db
      .prepare('SELECT plan, stripe_customer_id, stripe_subscription_id, plan_renews_at FROM users WHERE id = ?')
      .get(userId);
  } finally {
    db.close();
  }
}

let stub;
let stubRequests;
let noneServer;
let stripeServer;
let creemServer;
let bothServer;
let webhookServer;
let missingSecretServer;

before(async () => {
  stubRequests = [];
  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      stubRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.headers['x-api-key'] !== CREEM_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'invalid api key' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ch_stub_1', checkout_url: STUB_CHECKOUT_URL, product_id: PRODUCT_ID, status: 'pending' }));
    });
  });
  await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));

  noneServer = await boot({ port: NONE_PORT });
  stripeServer = await boot({
    port: STRIPE_PORT,
    env: { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_PRICE_ID: 'price_dummy' }
  });
  creemServer = await boot({
    port: CREEM_PORT,
    env: { CREEM_API_KEY: CREEM_KEY, CREEM_PRODUCT_ID: PRODUCT_ID, CREEM_API_BASE: STUB_BASE }
  });
  bothServer = await boot({
    port: BOTH_PORT,
    env: {
      CREEM_API_KEY: CREEM_KEY,
      CREEM_PRODUCT_ID: PRODUCT_ID,
      CREEM_API_BASE: STUB_BASE,
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_PRICE_ID: 'price_dummy'
    }
  });
  webhookServer = await boot({
    port: WEBHOOK_PORT,
    env: {
      CREEM_API_KEY: CREEM_KEY,
      CREEM_PRODUCT_ID: PRODUCT_ID,
      CREEM_API_BASE: STUB_BASE,
      CREEM_WEBHOOK_SECRET: WEBHOOK_SECRET
    }
  });
  missingSecretServer = await boot({
    port: MISSING_SECRET_PORT,
    env: { CREEM_API_KEY: CREEM_KEY, CREEM_PRODUCT_ID: PRODUCT_ID, CREEM_API_BASE: STUB_BASE }
  });
});

after(async () => {
  await Promise.all([
    noneServer?.close(),
    stripeServer?.close(),
    creemServer?.close(),
    bothServer?.close(),
    webhookServer?.close(),
    missingSecretServer?.close()
  ]);
  await new Promise((resolve) => stub.close(resolve));
});

test('no billing env -> checkout is 503 billing_disabled', async () => {
  const user = await signup(noneServer, { name: 'No Provider' });
  const res = await api(noneServer, 'POST', '/api/billing/checkout', { cookie: user.cookie });
  assertErr(res, 503, 'billing_disabled');
});

test('no billing env -> billing page offers the mailto upgrade CTA, no dead button (§17)', async () => {
  const user = await signup(noneServer, { name: 'Billing CTA' });
  const en = await api(noneServer, 'GET', '/app/billing', { cookie: user.cookie });
  assert.equal(en.status, 200);
  assert.ok(
    en.text.includes('href="mailto:support@quotemint.dpdns.org?subject=QuoteMint Pro"'),
    'billing page must offer the mailto upgrade CTA when no provider is configured'
  );
  assert.ok(en.text.includes('Contact us to upgrade'), 'en CTA label missing');
  assert.ok(!en.text.includes('id="upgrade-btn"'), 'checkout button must not render without a provider');
  assert.ok(en.text.includes('id="demo-upgrade-btn"'), 'demo upgrade button must stay (DEMO_MODE only)');

  const zh = await api(noneServer, 'GET', '/app/billing', { cookie: `lang=zh; ${user.cookie}` });
  assert.ok(zh.text.includes('联系我们开通'), 'zh CTA label missing');
  const duplicated = zh.text.split('暂时不可用').length - 1;
  assert.ok(duplicated <= 1, `unavailable message must not be duplicated, found ${duplicated}`);
});

test('stripe-only env -> dispatch selects stripe (not billing_disabled, not creem)', async () => {
  const user = await signup(stripeServer, { name: 'Stripe Only' });
  const beforeCount = stubRequests.length;
  const res = await api(stripeServer, 'POST', '/api/billing/checkout', { cookie: user.cookie });
  assert.notEqual(res.status, 503, `stripe must be dispatched when only STRIPE env is set: ${res.text}`);
  assert.notEqual(res.body?.error?.code, 'billing_disabled', res.text);
  assert.ok(res.status >= 500, `dummy stripe key must fail remotely, got ${res.status}: ${res.text}`);
  assert.equal(stubRequests.length, beforeCount, 'creem stub must not be called in stripe-only mode');
});

test('creem env + CREEM_API_BASE stub -> checkout returns the stub URL (§17)', async () => {
  const user = await signup(creemServer, { name: 'Creem Buyer' });
  const beforeCount = stubRequests.length;
  const data = assertOk(await api(creemServer, 'POST', '/api/billing/checkout', { cookie: user.cookie }));
  assert.equal(data.url, STUB_CHECKOUT_URL);

  assert.equal(stubRequests.length, beforeCount + 1, 'exactly one Creem checkout-creation call expected');
  const req = stubRequests[stubRequests.length - 1];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/checkouts');
  assert.match(req.headers['content-type'] || '', /application\/json/);

  const body = JSON.parse(req.body);
  assert.equal(body.product_id, PRODUCT_ID, 'checkout must carry the configured product id');
  assert.equal(body.success_url, `${creemServer.base}/app/billing?upgraded=1`);
  if ('cancel_url' in body) assert.equal(body.cancel_url, `${creemServer.base}/app/billing`);
  const uid = String(user.user.id);
  assert.ok(
    body.request_id === uid || body.metadata?.user_id === uid,
    `checkout must carry the user id via request_id/metadata: ${req.body}`
  );
  assert.ok(req.body.includes(user.email), `checkout must carry the customer email: ${req.body}`);
});

test('both creem and stripe env set -> creem wins (§17 precedence)', async () => {
  const user = await signup(bothServer, { name: 'Both Providers' });
  const beforeCount = stubRequests.length;
  const data = assertOk(await api(bothServer, 'POST', '/api/billing/checkout', { cookie: user.cookie }));
  assert.equal(data.url, STUB_CHECKOUT_URL, 'creem must take precedence when both providers are configured');
  assert.equal(stubRequests.length, beforeCount + 1);
});

test('webhook: bad signature -> 400 invalid_signature', async () => {
  const raw = JSON.stringify({ id: 'evt_bad', eventType: 'checkout.completed', object: {} });
  assertErr(await postWebhook(webhookServer, raw, { signature: 'deadbeef' }), 400, 'invalid_signature');
  assertErr(await postWebhook(webhookServer, raw, { signature: '' }), 400, 'invalid_signature');
  assertErr(await postWebhook(webhookServer, raw, { signature: 'a'.repeat(64) }), 400, 'invalid_signature');
  assertErr(await postWebhook(webhookServer, raw, { signature: creemSign(raw, 'wrong_secret') }), 400, 'invalid_signature');
});

test('webhook: checkout.completed upgrades the user and stores provider ids (§17)', async () => {
  const user = await signup(webhookServer, { name: 'Webhook Buyer' });
  const raw = checkoutCompletedEvent(user.user.id);
  const res = await postWebhook(webhookServer, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user: me, quota } = assertOk(await api(webhookServer, 'GET', '/api/auth/me', { cookie: user.cookie }));
  assert.equal(me.plan, 'pro');
  assert.equal(quota.max, null);

  const row = readUserRow(webhookServer.dataDir, user.user.id);
  assert.equal(row.plan, 'pro');
  assert.equal(row.stripe_customer_id, 'cus_stub_1');
  assert.equal(row.stripe_subscription_id, 'sub_stub_1');
  assert.ok(row.plan_renews_at, 'plan_renews_at should be set on upgrade');
});

test('webhook: subscription.canceled downgrades the matching user (§17)', async () => {
  const user = await signup(webhookServer, { name: 'Webhook Cancel' });
  assert.equal((await postWebhook(webhookServer, checkoutCompletedEvent(user.user.id, { eventId: 'evt_cancel_pre', subscriptionId: 'sub_cancel_1' }))).status, 200);

  const cancelRaw = subscriptionCanceledEvent('sub_cancel_1');
  const res = await postWebhook(webhookServer, cancelRaw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user: me, quota } = assertOk(await api(webhookServer, 'GET', '/api/auth/me', { cookie: user.cookie }));
  assert.equal(me.plan, 'free');
  assert.equal(me.plan_renews_at, null, 'renewal must be cleared on cancellation');
  assert.equal(quota.max, 3);

  const row = readUserRow(webhookServer.dataDir, user.user.id);
  assert.equal(row.stripe_subscription_id, null);
});

test('webhook: subscription.paid equivalent upgrades a free user (§17)', async () => {
  const user = await signup(webhookServer, { name: 'Webhook Paid' });
  const raw = JSON.stringify({
    id: 'evt_paid_1',
    eventType: 'subscription.paid',
    object: {
      id: 'sub_paid_1',
      object: 'subscription',
      status: 'paid',
      metadata: { user_id: String(user.user.id) },
      customer: { id: 'cus_paid_1', email: user.email }
    }
  });
  const res = await postWebhook(webhookServer, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user: me, quota } = assertOk(await api(webhookServer, 'GET', '/api/auth/me', { cookie: user.cookie }));
  assert.equal(me.plan, 'pro');
  assert.equal(quota.max, null);
});

test('webhook: unknown event -> 200 acknowledged, no plan change', async () => {
  const user = await signup(webhookServer, { name: 'Webhook Unknown' });
  const raw = JSON.stringify({ id: 'evt_refund_1', eventType: 'refund.created', object: { id: 'ref_1' } });
  const res = await postWebhook(webhookServer, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user: me } = assertOk(await api(webhookServer, 'GET', '/api/auth/me', { cookie: user.cookie }));
  assert.equal(me.plan, 'free', 'unknown events must not touch plans');
});

test('webhook: checkout.completed without a user identifier -> 200 no-op, no crash', async () => {
  const user = await signup(webhookServer, { name: 'Webhook Mismatch' });
  const raw = JSON.stringify({
    id: 'evt_no_user',
    eventType: 'checkout.completed',
    object: { id: 'ch_no_user', object: 'checkout', customer: { id: 'cus_x', email: 'x@example.com' } }
  });
  const res = await postWebhook(webhookServer, raw);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { received: true });

  const { user: me } = assertOk(await api(webhookServer, 'GET', '/api/auth/me', { cookie: user.cookie }));
  assert.equal(me.plan, 'free', 'unresolvable event must not upgrade anyone');
});

test('server without CREEM_WEBHOOK_SECRET -> 503 billing_disabled (stripe parity)', async () => {
  const raw = JSON.stringify({ id: 'evt_nosecret', eventType: 'checkout.completed', object: {} });
  assertErr(await postWebhook(missingSecretServer, raw), 503, 'billing_disabled');
});
