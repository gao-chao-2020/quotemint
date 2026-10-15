import { readBody, sendError, sendJson } from '../lib/http.js';
import { publicUser } from '../lib/auth.js';
import { createCheckoutSession, isConfigured, isDemoMode, providerName, renewsAtFromNow } from '../lib/billing.js';
import * as creem from '../lib/creem.js';
import { handleWebhookEvent, verifyWebhook } from '../lib/stripe.js';

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
    const url = await createCheckoutSession(ctx.db, ctx.user);
    sendJson(res, 200, { ok: true, data: { url } });
  } catch (err) {
    console.error('checkout session failed:', err.message);
    sendError(res, 502, providerName() === 'creem' ? 'creem_error' : 'stripe_error', 'Could not start checkout. Try again shortly.');
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
  await ctx.db.run(`UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE id = ?`, renewsAtFromNow(), ctx.user.id);
  const user = await ctx.db.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
  sendJson(res, 200, { ok: true, data: { user: publicUser(user) } });
}

export async function stripeWebhook(req, res, ctx) {
  if (!ctx.stripeWebhookSecret) {
    sendError(res, 503, 'billing_disabled', 'Webhook secret is not configured');
    return;
  }
  const raw = await readBody(req);
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
  await handleWebhookEvent(ctx.db, event);
  sendJson(res, 200, { received: true });
}

export async function creemWebhook(req, res, ctx) {
  if (!ctx.creemWebhookSecret) {
    sendError(res, 503, 'billing_disabled', 'Webhook secret is not configured');
    return;
  }
  const raw = await readBody(req);
  const result = creem.verifyWebhook(raw.toString('utf8'), req.headers['creem-signature'], ctx.creemWebhookSecret);
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
  await creem.handleWebhookEvent(ctx.db, event);
  sendJson(res, 200, { received: true });
}
