import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_API_BASE = 'https://api.creem.io';
const RENEWAL_DAYS = 31;
const RENEWAL_MS = RENEWAL_DAYS * 24 * 60 * 60 * 1000;

const UPGRADE_EVENTS = new Set(['checkout.completed', 'subscription.active', 'subscription.paid']);
const DOWNGRADE_EVENTS = new Set(['subscription.canceled', 'subscription.expired', 'subscription.unpaid']);

export function isConfigured() {
  return Boolean(process.env.CREEM_API_KEY) && Boolean(process.env.CREEM_PRODUCT_ID);
}

function apiBase() {
  return process.env.CREEM_API_BASE || DEFAULT_API_BASE;
}

export function renewsAtFromNow(now = new Date()) {
  return new Date(now.getTime() + RENEWAL_MS).toISOString();
}

export async function createCheckoutSession(db, user) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${apiBase()}/v1/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.CREEM_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      product_id: process.env.CREEM_PRODUCT_ID,
      request_id: String(user.id),
      success_url: `${baseUrl}/app/billing?upgraded=1`,
      customer: { email: user.email },
      metadata: { user_id: String(user.id) }
    })
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.checkout_url) {
    const detail = typeof payload?.message === 'string' ? payload.message : `Creem responded ${res.status}`;
    throw new Error(detail);
  }
  return { url: payload.checkout_url };
}

// Creem signs only the raw body (no timestamp), so there is no replay-tolerance window to enforce.
export function verifyWebhook(rawBody, signatureHeader, secret = process.env.CREEM_WEBHOOK_SECRET) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader.trim(), 'hex');
  if (provided.length !== expected.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(provided, expected) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

function objectId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

async function resolveUserId(db, object) {
  const raw = object.metadata?.user_id ?? object.request_id;
  const userId = Number(raw);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const user = await db.get('SELECT id FROM users WHERE id = ?', userId);
  return user ? user.id : null;
}

async function upgrade(db, eventType, object) {
  const customerId = objectId(object.customer);
  const subscriptionId = eventType === 'checkout.completed' ? objectId(object.subscription) : objectId(object);
  let userId = await resolveUserId(db, object);
  if (userId === null && customerId) {
    const row = await db.get('SELECT id FROM users WHERE stripe_customer_id = ?', customerId);
    if (row) userId = row.id;
  }
  if (userId === null && subscriptionId) {
    const row = await db.get('SELECT id FROM users WHERE stripe_subscription_id = ?', subscriptionId);
    if (row) userId = row.id;
  }
  if (userId === null) return { handled: false };
  await db.run(
    `UPDATE users SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ?, plan_renews_at = ? WHERE id = ?`,
    customerId,
    subscriptionId,
    renewsAtFromNow(),
    userId
  );
  return { handled: true };
}

async function downgrade(db, object) {
  const subscriptionId = objectId(object);
  const customerId = objectId(object.customer);
  const userId = await resolveUserId(db, object);
  const base = `UPDATE users SET plan = 'free', stripe_subscription_id = NULL, plan_renews_at = NULL`;
  if (userId !== null) {
    return { handled: (await db.run(`${base} WHERE id = ?`, userId)).changes > 0 };
  }
  if (subscriptionId) {
    const result = await db.run(`${base} WHERE stripe_subscription_id = ?`, subscriptionId);
    if (result.changes > 0) return { handled: true };
  }
  if (customerId) {
    const result = await db.run(`${base} WHERE stripe_customer_id = ?`, customerId);
    if (result.changes > 0) return { handled: true };
  }
  return { handled: false };
}

export async function handleWebhookEvent(db, event) {
  if (!event || typeof event !== 'object') return { handled: false };
  const type = event.eventType;
  const object = event.object;
  if (typeof type !== 'string' || !object || typeof object !== 'object') return { handled: false };
  if (UPGRADE_EVENTS.has(type)) return upgrade(db, type, object);
  if (DOWNGRADE_EVENTS.has(type)) return downgrade(db, object);
  return { handled: false };
}
