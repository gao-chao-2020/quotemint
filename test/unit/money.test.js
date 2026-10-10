import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, formatMoney } from '../../src/lib/money.js';

test('sums lines and computes totals without discount or tax', () => {
  const totals = computeTotals(
    [
      { desc: 'a', qty: 2, unit_price_cents: 1500 },
      { desc: 'b', qty: 1, unit_price_cents: 250 }
    ],
    0,
    0
  );
  assert.deepEqual(totals, { subtotal_cents: 3250, discount_cents: 0, tax_cents: 0, total_cents: 3250 });
});

test('fractional qty rounds half up per line', () => {
  assert.equal(computeTotals([{ desc: 'a', qty: 1.5, unit_price_cents: 999 }]).subtotal_cents, 1499);
  assert.equal(computeTotals([{ desc: 'a', qty: 0.3333, unit_price_cents: 300 }]).subtotal_cents, 100);
});

test('discount and tax rounding boundaries', () => {
  const totals = computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 999 }], 10, 7.5);
  assert.deepEqual(totals, { subtotal_cents: 999, discount_cents: 100, tax_cents: 67, total_cents: 966 });
});

test('tax rounds half up on post-discount base', () => {
  const totals = computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 100 }], 0, 12.5);
  assert.deepEqual(totals, { subtotal_cents: 100, discount_cents: 0, tax_cents: 13, total_cents: 113 });
});

test('100 percent discount zeroes the total', () => {
  const totals = computeTotals(
    [
      { desc: 'a', qty: 2, unit_price_cents: 2500 },
      { desc: 'b', qty: 1, unit_price_cents: 0 }
    ],
    100,
    20
  );
  assert.deepEqual(totals, { subtotal_cents: 5000, discount_cents: 5000, tax_cents: 0, total_cents: 0 });
});

test('percentages are clamped to 0..100', () => {
  const over = computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 1000 }], 150, 150);
  assert.equal(over.discount_cents, 1000);
  assert.equal(over.total_cents, 0);
  const under = computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 1000 }], -5, -5);
  assert.equal(under.discount_cents, 0);
  assert.equal(under.tax_cents, 0);
});

test('invalid items throw', () => {
  assert.throws(() => computeTotals([]));
  assert.throws(() => computeTotals('nope'));
  assert.throws(() => computeTotals([{ desc: 'a', qty: 0, unit_price_cents: 100 }]));
  assert.throws(() => computeTotals([{ desc: 'a', qty: -2, unit_price_cents: 100 }]));
  assert.throws(() => computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 1.5 }]));
  assert.throws(() => computeTotals([{ desc: 'a', qty: 1, unit_price_cents: -1 }]));
  assert.throws(() => computeTotals([{ desc: 'a', qty: 1, unit_price_cents: 1e13 }]));
});

test('formatMoney formats known currencies', () => {
  assert.equal(formatMoney(1234, 'USD'), '$12.34');
  assert.match(formatMoney(500, 'EUR'), /5\.00/);
  assert.match(formatMoney(500, 'GBP'), /5\.00/);
});

test('formatMoney falls back to USD for unknown currency codes', () => {
  assert.equal(formatMoney(500, 'NOTACUR'), '$5.00');
  assert.equal(formatMoney(500, 'usd-typo'), '$5.00');
});
