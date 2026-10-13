import * as creem from './creem.js';
import * as stripe from './stripe.js';

export { renewsAtFromNow } from './stripe.js';

export function providerName() {
  if (creem.isConfigured()) return 'creem';
  if (stripe.isConfigured()) return 'stripe';
  return null;
}

export function provider() {
  const name = providerName();
  if (name === 'creem') return creem;
  if (name === 'stripe') return stripe;
  return null;
}

export function isConfigured() {
  return providerName() !== null;
}

export function isDemoMode() {
  return process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

export async function createCheckoutSession(db, user) {
  const activeProvider = provider();
  if (!activeProvider) throw new Error('Billing is not configured');
  if (providerName() === 'creem') {
    const { url } = await creem.createCheckoutSession(db, user);
    return url;
  }
  return stripe.createCheckoutSession(user);
}
