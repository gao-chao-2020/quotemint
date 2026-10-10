import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/db.js';
import {
  createCheckoutSession,
  handleWebhookEvent,
  isConfigured,
  parseSignatureHeader,
  renewsAtFromNow,
  verifyWebhook
} from '../../src/lib/stripe.js';

const SECRET = 'whsec_test_123';
const dir = mkdtempSync(join(tmpdir(), 'qm-stripe-'));
const db = openDb(dir);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function sign(rawBody, timestampSeconds, secret = SECRET) {
  const hmac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `t=${timestampSeconds},v1=${hmac}`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

test('verifyWebhook accepts a valid signature', () => {
  const body = JSON.stringify({ type: 'ping' });
  const result = verifyWebhook(body, sign(body, nowSeconds()), SECRET);
  assert.deepEqual(result, { ok: true });
});

test('verifyWebhook rejects wrong secret, tampered body, bad hex', () => {
  const body = JSON.stringify({ type: 'ping' });
  const t = nowSeconds();
  assert.equal(verifyWebhook(body, sign(body, t), 'whsec_other').ok, false);
  assert.equal(verifyWebhook(`${body} `, sign(body, t), SECRET).reason, 'mismatch');
  assert.equal(verifyWebhook(body, `t=${t},v1=zzzz`, SECRET).ok, false);
});

test('verifyWebhook rejects stale and future timestamps beyond 300s', () => {
  const body = '{}';
  const t = nowSeconds();
  assert.equal(verifyWebhook(body, sign(body, t - 301), SECRET).reason, 'tolerance');
  assert.equal(verifyWebhook(body, sign(body, t + 301), SECRET).reason, 'tolerance');
  assert.deepEqual(verifyWebhook(body, sign(body, t - 299), SECRET), { ok: true });
  assert.deepEqual(verifyWebhook(body, sign(body, t + 299), SECRET), { ok: true });
});

test('verifyWebhook reports missing secret and malformed headers', () => {
  assert.equal(verifyWebhook('{}', 't=1,v1=aa', '').reason, 'missing_secret');
  assert.equal(verifyWebhook('{}', 'garbage', SECRET).reason, 'malformed');
  assert.equal(verifyWebhook('{}', `t=notanumber,v1=aa`, SECRET).reason, 'malformed');
  assert.equal(verifyWebhook('{}', undefined, SECRET).reason, 'malformed');
});

test('signature header with several v1 values accepts any match', () => {
  const body = '{"a":1}';
  const t = nowSeconds();
  const good = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const header = `t=${t},v1=${'0'.repeat(64)},v1=${good}`;
  assert.deepEqual(verifyWebhook(body, header, SECRET), { ok: true });
  assert.deepEqual(parseSignatureHeader(header).v1.length, 2);
});

test('handleWebhookEvent upgrades user on checkout.session.completed', () => {
  db.prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)').run(
    'buyer@test.dev',
    'scrypt$x$y',
    'Buyer',
    new Date().toISOString()
  );
  const event = {
    type: 'checkout.session.completed',
    data: { object: { metadata: { user_id: '1' }, client_reference_id: '1', customer: 'cus_123', subscription: 'sub_123' } }
  };
  assert.deepEqual(handleWebhookEvent(db, event), { handled: true });
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.equal(user.plan, 'pro');
  assert.equal(user.stripe_customer_id, 'cus_123');
  assert.equal(user.stripe_subscription_id, 'sub_123');
  assert.ok(new Date(user.plan_renews_at).getTime() > Date.now());
});

test('handleWebhookEvent falls back to client_reference_id and ignores unknown users', () => {
  const fallback = {
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: '1', customer: 'cus_9', subscription: 'sub_9' } }
  };
  assert.deepEqual(handleWebhookEvent(db, fallback), { handled: true });
  const unknown = { type: 'checkout.session.completed', data: { object: { metadata: { user_id: '999' } } } };
  assert.deepEqual(handleWebhookEvent(db, unknown), { handled: false });
  assert.deepEqual(handleWebhookEvent(db, { type: 'invoice.paid', data: { object: {} } }), { handled: false });
  assert.deepEqual(handleWebhookEvent(db, null), { handled: false });
});

test('customer.subscription.deleted downgrades matching user', () => {
  const event = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_9' } } };
  assert.deepEqual(handleWebhookEvent(db, event), { handled: true });
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
  assert.equal(user.plan, 'free');
  assert.equal(user.stripe_subscription_id, null);
  assert.deepEqual(handleWebhookEvent(db, event), { handled: false });
});

test('isConfigured requires both secret key and price id', () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedPrice = process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  assert.equal(isConfigured(), false);
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  assert.equal(isConfigured(), false);
  process.env.STRIPE_PRICE_ID = 'price_1';
  assert.equal(isConfigured(), true);
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = savedKey;
  if (savedPrice === undefined) delete process.env.STRIPE_PRICE_ID;
  else process.env.STRIPE_PRICE_ID = savedPrice;
});

test('createCheckoutSession posts form-encoded params with bearer auth', async () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedPrice = process.env.STRIPE_PRICE_ID;
  const savedBase = process.env.BASE_URL;
  const savedFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PRICE_ID = 'price_abc';
  process.env.BASE_URL = 'https://quotemint.example';
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/x' }) };
  };
  try {
    const url = await createCheckoutSession({ id: 7, email: 'buyer@test.dev' });
    assert.equal(url, 'https://checkout.stripe.com/c/pay/x');
    assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer sk_test_123');
    assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(captured.options.body);
    assert.equal(params.get('mode'), 'subscription');
    assert.equal(params.get('line_items[0][price]'), 'price_abc');
    assert.equal(params.get('line_items[0][quantity]'), '1');
    assert.equal(params.get('success_url'), 'https://quotemint.example/app/billing?upgraded=1');
    assert.equal(params.get('cancel_url'), 'https://quotemint.example/app/billing');
    assert.equal(params.get('customer_email'), 'buyer@test.dev');
    assert.equal(params.get('client_reference_id'), '7');
    assert.equal(params.get('metadata[user_id]'), '7');
    assert.equal(params.get('allow_promotion_codes'), 'true');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
    if (savedPrice === undefined) delete process.env.STRIPE_PRICE_ID;
    else process.env.STRIPE_PRICE_ID = savedPrice;
    if (savedBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = savedBase;
  }
});

test('createCheckoutSession surfaces Stripe errors', async () => {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedPrice = process.env.STRIPE_PRICE_ID;
  const savedFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PRICE_ID = 'price_abc';
  globalThis.fetch = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'card declined' } }) });
  try {
    await assert.rejects(() => createCheckoutSession({ id: 1, email: 'a@b.co' }), /card declined/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
    if (savedPrice === undefined) delete process.env.STRIPE_PRICE_ID;
    else process.env.STRIPE_PRICE_ID = savedPrice;
  }
});

test('renewsAtFromNow adds 31 days', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(renewsAtFromNow(now), '2026-02-01T00:00:00.000Z');
});
