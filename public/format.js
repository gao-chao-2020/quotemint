// Client-side display formatting. Money math mirrors the API contract §2 (integer cents).

export function formatMoney(cents, currency = 'USD') {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }
}

// Parses a price input in currency units ("12.50") into integer cents. Returns null when unparseable.
export function centsFromPriceInput(raw) {
  const parsed = Number.parseFloat(String(raw ?? '').trim());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}
