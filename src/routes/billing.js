import { sendError, sendJson, HttpError } from '../lib/http.js';
import { publicUser } from '../lib/auth.js';
import { createCheckoutSession, handleWebhookEvent, isConfigured, isDemoMode, renewsAtFromNow, verifyWebhook } from '../lib/stripe.js';

const RAW_LIMIT_BYTES = 1024 * 1024;

export async function checkout(req, res, ctx) {
  if (!ctx.user) {
    sendError(res, 401, 'not_authenticated', 'Log in to continue');
    return;
  }
  if (!isConfigured()) {
    sendError(res, 503, 'billing_disabled', 'Billing is not configured on this server');
    return;
  }
  try {
    const url = await createCheckoutSession(ctx.user);
    sendJson(res, 200, { ok: true, data: { url } });
  } catch (err) {
    console.error('checkout session failed:', err.message);
    sendError(res, 502, 'stripe_error', 'Could not start checkout. Try again shortly.');
  }
}

export async function demoUpgrade(req, res, ctx) {
  if (!ctx.user) {
    sendError(res, 401, 'not_authenticated', 'Log in to continue');
    return;
  }
  if (!isDemoMode() || process.env.NODE_ENV === 'production') {
    sendError(res, 403, 'demo_disabled', 'Demo upgrades are disabled');
    return;
  }
  ctx.db
    .prepare(`UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE id = ?`)
    .run(renewsAtFromNow(), ctx.user.id);
  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  sendJson(res, 200, { ok: true, data: { user: publicUser(user) } });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > RAW_LIMIT_BYTES) {
        overflow = true;
        chunks.length = 0;
        if (size > RAW_LIMIT_BYTES * 8) {
          reject(new HttpError(413, 'payload_too_large', 'Request body exceeds 1MB'));
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (overflow) {
        reject(new HttpError(413, 'payload_too_large', 'Request body exceeds 1MB'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function stripeWebhook(req, res, ctx) {
  if (!ctx.stripeWebhookSecret) {
    sendError(res, 503, 'billing_disabled', 'Webhook secret is not configured');
    return;
  }
  const raw = await readRawBody(req);
  const result = verifyWebhook(raw.toString('utf8'), req.headers['stripe-signature'], ctx.stripeWebhookSecret);
  if (!result.ok) {
    sendError(res, 400, 'invalid_signature', 'Signature verification failed');
    return;
  }
  let event = null;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    sendError(res, 400, 'invalid_payload', 'Body must be JSON');
    return;
  }
  handleWebhookEvent(ctx.db, event);
  sendJson(res, 200, { received: true });
}
