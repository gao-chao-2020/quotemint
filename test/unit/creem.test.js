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
  renewsAtFromNow,
  verifyWebhook
} from '../../src/lib/creem.js';

const SECRET = 'creem_whsec_unit_123';
const dir = mkdtempSync(join(tmpdir(), 'qm-creem-'));
const db = openDb(dir);

after(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

function sign(rawBody, secret = SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function saveEnv(...keys) {
  const saved = keys.map((key) => [key, process.env[key]]);
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function insertUser(email) {
  const info = await db.run(
    'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)',
    email,
    'scrypt$x$y',
    'User',
    new Date().toISOString()
  );
  return info.lastInsertRowid;
}

async function userRow(id) {
  return db.get('SELECT * FROM users WHERE id = ?', id);
}

test('isConfigured requires both api key and product id', () => {
  const restore = saveEnv('CREEM_API_KEY', 'CREEM_PRODUCT_ID');
  try {
    delete process.env.CREEM_API_KEY;
    delete process.env.CREEM_PRODUCT_ID;
    assert.equal(isConfigured(), false);
    process.env.CREEM_API_KEY = 'creem_test_1';
    assert.equal(isConfigured(), false);
    process.env.CREEM_PRODUCT_ID = 'prod_1';
    assert.equal(isConfigured(), true);
  } finally {
    restore();
  }
});

test('verifyWebhook accepts a signature over the raw body', () => {
  const body = JSON.stringify({ id: 'evt_1', eventType: 'checkout.completed', object: { id: 'ch_1' } });
  assert.deepEqual(verifyWebhook(body, sign(body), SECRET), { ok: true });
});

test('verifyWebhook falls back to CREEM_WEBHOOK_SECRET from env', () => {
  const restore = saveEnv('CREEM_WEBHOOK_SECRET');
  process.env.CREEM_WEBHOOK_SECRET = SECRET;
  try {
    const body = '{"a":1}';
    assert.deepEqual(verifyWebhook(body, sign(body)), { ok: true });
  } finally {
    restore();
  }
});

test('verifyWebhook rejects tampered bodies, wrong secrets, and malformed headers', () => {
  const body = '{"amount":100}';
  assert.equal(verifyWebhook(`${body} `, sign(body), SECRET).reason, 'mismatch');
  assert.equal(verifyWebhook(body, sign(body, 'wrong_secret'), SECRET).reason, 'mismatch');
  assert.equal(verifyWebhook(body, 'zzzz', SECRET).reason, 'mismatch');
  assert.equal(verifyWebhook(body, undefined, SECRET).reason, 'malformed');
  assert.equal(verifyWebhook(body, '', SECRET).reason, 'malformed');
});

test('verifyWebhook rejects wrong-length signatures without throwing', () => {
  const body = '{}';
  assert.equal(verifyWebhook(body, 'ab'.repeat(16), SECRET).reason, 'mismatch');
  assert.equal(verifyWebhook(body, sign(body).slice(0, 63), SECRET).reason, 'mismatch');
});

test('verifyWebhook reports a missing secret', () => {
  const restore = saveEnv('CREEM_WEBHOOK_SECRET');
  delete process.env.CREEM_WEBHOOK_SECRET;
  try {
    assert.equal(verifyWebhook('{}', 'aa').reason, 'missing_secret');
    assert.equal(verifyWebhook('{}', 'aa', '').reason, 'missing_secret');
  } finally {
    restore();
  }
});

test('createCheckoutSession posts JSON with x-api-key to the configured base and returns {url}', async () => {
  const restore = saveEnv('CREEM_API_KEY', 'CREEM_PRODUCT_ID', 'CREEM_API_BASE', 'BASE_URL');
  const savedFetch = globalThis.fetch;
  process.env.CREEM_API_KEY = 'creem_test_123';
  process.env.CREEM_PRODUCT_ID = 'prod_abc';
  process.env.CREEM_API_BASE = 'http://localhost:4444';
  process.env.BASE_URL = 'https://quotemint.example';
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'ch_9', checkout_url: 'https://checkout.creem.io/ch_9', status: 'pending' })
    };
  };
  try {
    const result = await createCheckoutSession(db, { id: 7, email: 'buyer@test.dev' });
    assert.deepEqual(result, { url: 'https://checkout.creem.io/ch_9' });
    assert.equal(captured.url, 'http://localhost:4444/v1/checkouts');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers['x-api-key'], 'creem_test_123');
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.product_id, 'prod_abc');
    assert.equal(body.request_id, '7');
    assert.equal(body.success_url, 'https://quotemint.example/app/billing?upgraded=1');
    assert.equal(body.customer.email, 'buyer@test.dev');
    assert.equal(body.metadata.user_id, '7');
  } finally {
    globalThis.fetch = savedFetch;
    restore();
  }
});

test('createCheckoutSession defaults to the documented Creem host and surfaces API errors', async () => {
  const restore = saveEnv('CREEM_API_KEY', 'CREEM_PRODUCT_ID', 'CREEM_API_BASE');
  const savedFetch = globalThis.fetch;
  process.env.CREEM_API_KEY = 'creem_test_123';
  process.env.CREEM_PRODUCT_ID = 'prod_abc';
  delete process.env.CREEM_API_BASE;
  try {
    let capturedUrl = null;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ checkout_url: 'https://checkout.creem.io/ch_10' }) };
    };
    await createCheckoutSession(db, { id: 1, email: 'a@b.co' });
    assert.equal(capturedUrl, 'https://api.creem.io/v1/checkouts');

    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'invalid api key' }) });
    await assert.rejects(() => createCheckoutSession(db, { id: 1, email: 'a@b.co' }), /invalid api key/);

    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'pending' }) });
    await assert.rejects(() => createCheckoutSession(db, { id: 1, email: 'a@b.co' }), /Creem responded 200/);
  } finally {
    globalThis.fetch = savedFetch;
    restore();
  }
});

test('handleWebhookEvent upgrades on checkout.completed and stores provider ids', async () => {
  const userId = await insertUser('checkout@test.dev');
  const event = {
    id: 'evt_checkout_1',
    eventType: 'checkout.completed',
    object: {
      id: 'ch_1',
      object: 'checkout',
      request_id: String(userId),
      metadata: { user_id: String(userId) },
      customer: { id: 'cus_1', email: 'checkout@test.dev' },
      subscription: { id: 'sub_1', status: 'active' }
    }
  };
  assert.deepEqual(await handleWebhookEvent(db, event), { handled: true });
  const row = await userRow(userId);
  assert.equal(row.plan, 'pro');
  assert.equal(row.stripe_customer_id, 'cus_1');
  assert.equal(row.stripe_subscription_id, 'sub_1');
  const renewsAt = Date.parse(row.plan_renews_at);
  assert.ok(Math.abs(renewsAt - (Date.now() + 31 * 24 * 60 * 60 * 1000)) < 5 * 60 * 1000);
});

test('handleWebhookEvent resolves the user via request_id fallback and ignores unknown users', async () => {
  const userId = await insertUser('fallback@test.dev');
  const viaRequestId = {
    eventType: 'checkout.completed',
    object: {
      id: 'ch_2',
      request_id: String(userId),
      customer: { id: 'cus_2' },
      subscription: { id: 'sub_2' }
    }
  };
  assert.deepEqual(await handleWebhookEvent(db, viaRequestId), { handled: true });
  assert.equal((await userRow(userId)).stripe_subscription_id, 'sub_2');

  const unknown = {
    eventType: 'checkout.completed',
    object: { id: 'ch_3', metadata: { user_id: '999' }, customer: { id: 'cus_none' } }
  };
  assert.deepEqual(await handleWebhookEvent(db, unknown), { handled: false });
  const row = await userRow(userId);
  assert.equal(row.plan, 'pro');
  assert.equal(row.stripe_subscription_id, 'sub_2');
});

test('handleWebhookEvent upgrades on subscription.active and refreshes on subscription.paid', async () => {
  const userId = await insertUser('subscriber@test.dev');
  const active = {
    eventType: 'subscription.active',
    object: { id: 'sub_a1', status: 'active', customer: { id: 'cus_a' }, metadata: { user_id: String(userId) } }
  };
  assert.deepEqual(await handleWebhookEvent(db, active), { handled: true });
  let row = await userRow(userId);
  assert.equal(row.plan, 'pro');
  assert.equal(row.stripe_customer_id, 'cus_a');
  assert.equal(row.stripe_subscription_id, 'sub_a1');

  const paid = { eventType: 'subscription.paid', object: { id: 'sub_a1', customer: { id: 'cus_a' } } };
  assert.deepEqual(await handleWebhookEvent(db, paid), { handled: true });
  row = await userRow(userId);
  assert.equal(row.plan, 'pro');
  assert.equal(row.stripe_subscription_id, 'sub_a1');
});

test('handleWebhookEvent downgrades on canceled/expired/unpaid and clears renewal', async () => {
  for (const [i, type] of ['subscription.canceled', 'subscription.expired', 'subscription.unpaid'].entries()) {
    const userId = await insertUser(`downgrade${i}@test.dev`);
    await db.run(
      `UPDATE users SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`,
      `cus_d${i}`,
      `sub_d${i}`,
      userId
    );

    const event = { eventType: type, object: { id: `sub_d${i}`, object: 'subscription', status: type.split('.')[1] } };
    assert.deepEqual(await handleWebhookEvent(db, event), { handled: true });
    const row = await userRow(userId);
    assert.equal(row.plan, 'free');
    assert.equal(row.stripe_subscription_id, null);
    assert.equal(row.plan_renews_at, null);
    assert.equal(row.stripe_customer_id, `cus_d${i}`);
    assert.deepEqual(await handleWebhookEvent(db, event), { handled: false });
  }

  const customerFallback = await insertUser('customer-fallback@test.dev');
  await db.run(
    `UPDATE users SET plan = 'pro', stripe_customer_id = 'cus_fb', stripe_subscription_id = 'sub_fb' WHERE id = ?`,
    customerFallback
  );
  const unmatchedSub = { eventType: 'subscription.canceled', object: { id: 'sub_other', customer: { id: 'cus_fb' } } };
  assert.deepEqual(await handleWebhookEvent(db, unmatchedSub), { handled: true });
  assert.equal((await userRow(customerFallback)).plan, 'free');
});

test('handleWebhookEvent ignores unknown and malformed events', async () => {
  const userId = await insertUser('unknown@test.dev');
  await db.run(`UPDATE users SET plan = 'pro' WHERE id = ?`, userId);
  assert.deepEqual(await handleWebhookEvent(db, { eventType: 'refund.created', object: { id: 'ref_1' } }), { handled: false });
  assert.deepEqual(await handleWebhookEvent(db, { eventType: 'checkout.completed' }), { handled: false });
  assert.deepEqual(await handleWebhookEvent(db, { object: { id: 'ch_1' } }), { handled: false });
  assert.deepEqual(await handleWebhookEvent(db, null), { handled: false });
  assert.equal((await userRow(userId)).plan, 'pro');
});

test('renewsAtFromNow adds 31 days', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(renewsAtFromNow(now), '2026-02-01T00:00:00.000Z');
});
