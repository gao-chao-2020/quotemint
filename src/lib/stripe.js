import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;
const RENEWAL_DAYS = 31;

export function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_PRICE_ID);
}

export function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}

export function parseSignatureHeader(header) {
  const parsed = { t: null, v1: [] };
  if (typeof header !== 'string') return parsed;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') parsed.t = value;
    else if (key === 'v1') parsed.v1.push(value);
  }
  return parsed;
}

export function verifyWebhook(rawBody, signatureHeader, secret, nowMs = Date.now()) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  const { t, v1 } = parseSignatureHeader(signatureHeader);
  if (!t || v1.length === 0) return { ok: false, reason: 'malformed' };
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowMs / 1000 - timestamp) > TOLERANCE_SECONDS) return { ok: false, reason: 'tolerance' };

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  for (const candidate of v1) {
    let provided;
    try {
      provided = Buffer.from(candidate, 'hex');
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

export async function createCheckoutSession(user) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('line_items[0][price]', process.env.STRIPE_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${baseUrl}/app/billing?upgraded=1`);
  params.set('cancel_url', `${baseUrl}/app/billing`);
  params.set('customer_email', user.email);
  params.set('client_reference_id', String(user.id));
  params.set('metadata[user_id]', String(user.id));
  params.set('allow_promotion_codes', 'true');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.url) {
    const detail = payload?.error?.message || `Stripe responded ${res.status}`;
    throw new Error(detail);
  }
  return payload.url;
}

export function renewsAtFromNow(now = new Date()) {
  return new Date(now.getTime() + RENEWAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function handleWebhookEvent(db, event) {
  if (!event || typeof event !== 'object') return { handled: false };
  const type = event.type;
  const object = event.data?.object;

  if (type === 'checkout.session.completed' && object) {
    if (object.mode !== 'subscription') return { handled: false };
    if (object.payment_status !== 'paid' && object.payment_status !== 'no_payment_required') {
      return { handled: false };
    }
    const userIdRaw = object.metadata?.user_id ?? object.client_reference_id;
    const userId = Number(userIdRaw);
    if (!Number.isInteger(userId) || userId <= 0) return { handled: false };
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return { handled: false };
    db.prepare(
      `UPDATE users SET plan = 'pro', stripe_customer_id = ?, stripe_subscription_id = ?, plan_renews_at = ? WHERE id = ?`
    ).run(
      object.customer ?? null,
      object.subscription ?? null,
      renewsAtFromNow(),
      userId
    );
    return { handled: true };
  }

  if (type === 'customer.subscription.deleted' && object) {
    const subscriptionId = object.id;
    if (typeof subscriptionId !== 'string' || !subscriptionId) return { handled: false };
    const result = db
      .prepare(
        `UPDATE users SET plan = 'free', stripe_subscription_id = NULL, plan_renews_at = NULL WHERE stripe_subscription_id = ?`
      )
      .run(subscriptionId);
    return { handled: result.changes > 0 };
  }

  return { handled: false };
}
