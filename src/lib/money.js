const MAX_UNIT_PRICE_CENTS = 1e12;

export function clampPct(value) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, numeric));
}

export function computeTotals(items, discountPct = 0, taxPct = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array');
  }
  let subtotal = 0;
  for (const item of items) {
    const qty = item?.qty;
    const unitPrice = item?.unit_price_cents;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
      throw new Error('invalid item qty');
    }
    if (
      typeof unitPrice !== 'number' ||
      !Number.isInteger(unitPrice) ||
      unitPrice < 0 ||
      unitPrice > MAX_UNIT_PRICE_CENTS
    ) {
      throw new Error('invalid item unit_price_cents');
    }
    subtotal += Math.round(qty * unitPrice);
  }
  const discount = Math.round((subtotal * clampPct(discountPct)) / 100);
  const tax = Math.round(((subtotal - discount) * clampPct(taxPct)) / 100);
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    tax_cents: tax,
    total_cents: subtotal - discount + tax
  };
}

export function formatMoney(cents, currency = 'USD') {
  return formatWith(cents, currency) ?? formatWith(cents, 'USD');
}

function formatWith(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return null;
  }
}
