// Quote editor: live totals (mirrors §2 integer-cents math), row management, save/send.

import { $, $$, api, absoluteUrl, copyText, errorText, flash, setBusy, toast } from './common.js';
import { centsFromPriceInput, formatMoney } from './format.js';

const S = window.__I18N__?.t || {};
const boot = window.__BOOT__ || {};
const quote = boot.quote || null;
const editable = Boolean(boot.editable);

function currentCurrency() {
  const select = $('#currency');
  return (select && select.value) || (quote && quote.currency) || 'USD';
}

function clampPct(raw) {
  const n = Number.parseFloat(String(raw ?? '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function readRow(row) {
  const desc = row.querySelector('.item-desc')?.value ?? '';
  const qtyRaw = row.querySelector('.item-qty')?.value ?? '';
  const priceRaw = row.querySelector('.item-price')?.value ?? '';
  const qty = Number.parseFloat(String(qtyRaw).trim());
  const unitCents = centsFromPriceInput(priceRaw);
  const lineCents =
    Number.isFinite(qty) && qty > 0 && unitCents !== null ? Math.round(qty * unitCents) : 0;
  return { desc, qtyRaw, priceRaw, qty, unitCents, lineCents };
}

function recalc() {
  if (!editable) return;
  const currency = currentCurrency();
  let subtotal = 0;
  for (const row of $$('#items-body .item-row')) {
    const v = readRow(row);
    subtotal += v.lineCents;
    const cell = row.querySelector('.line-total');
    if (cell) cell.textContent = formatMoney(v.lineCents, currency);
  }
  const discount = Math.round((subtotal * clampPct($('#discount-pct')?.value)) / 100);
  const tax = Math.round(((subtotal - discount) * clampPct($('#tax-pct')?.value)) / 100);
  const set = (selector, text) => {
    const el = $(selector);
    if (el) el.textContent = text;
  };
  set('#sum-subtotal', formatMoney(subtotal, currency));
  set('#sum-discount', `−${formatMoney(discount, currency)}`);
  set('#sum-tax', `+${formatMoney(tax, currency)}`);
  set('#sum-total', formatMoney(subtotal - discount + tax, currency));
}

function renumber() {
  $$('#items-body .item-row').forEach((row, index) => {
    const n = index + 1;
    const text = (key, fallback) => (S[key] || fallback).replace('{n}', n);
    const label = (cls, aria) => {
      const el = row.querySelector(cls);
      if (el) el.setAttribute('aria-label', aria);
    };
    label('.item-desc', text('ed.item.aria_desc', 'Line item {n} description'));
    label('.item-qty', text('ed.item.aria_qty', 'Line item {n} quantity'));
    label('.item-price', text('ed.item.aria_price', 'Line item {n} unit price'));
    const remove = row.querySelector('.item-remove');
    if (remove) remove.setAttribute('aria-label', text('ed.item.aria_remove', 'Remove line item {n}'));
  });
}

function addRow() {
  const tpl = $('#item-row-template');
  const body = $('#items-body');
  if (!tpl || !body) return null;
  const row = tpl.content.firstElementChild.cloneNode(true);
  body.append(row);
  renumber();
  recalc();
  row.querySelector('.item-desc')?.focus();
  return row;
}

function clearRow(row) {
  for (const cls of ['.item-desc', '.item-qty', '.item-price']) {
    const input = row.querySelector(cls);
    if (input) input.value = '';
  }
}

function collectPayload() {
  const lineText = (key, fallback, n) => (S[key] || fallback).replace('{n}', n);
  const title = String($('#quote-title')?.value || '').trim();
  if (!title) return { error: S['ed.err.title_required'] || 'Enter a quote title.' };
  if (title.length > 200) return { error: S['ed.err.title_long'] || 'Quote title must be 200 characters or less.' };

  const clientName = String($('#client-name')?.value || '').trim();
  if (!clientName) return { error: S['ed.err.client_required'] || 'Enter a client name.' };
  if (clientName.length > 120) return { error: S['ed.err.client_long'] || 'Client name must be 120 characters or less.' };

  const clientEmail = String($('#client-email')?.value || '').trim();
  if (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    return { error: S['ed.err.email_invalid'] || 'Enter a valid client email or leave it blank.' };
  }

  const items = [];
  const rows = $$('#items-body .item-row');
  for (let i = 0; i < rows.length; i += 1) {
    const v = readRow(rows[i]);
    const isEmpty = !v.desc.trim() && !String(v.qtyRaw).trim() && !String(v.priceRaw).trim();
    if (isEmpty) continue;
    const n = i + 1;
    const desc = v.desc.trim();
    if (!desc) return { error: lineText('ed.err.line_desc', 'Line {n}: add a description.', n) };
    if (!Number.isFinite(v.qty) || v.qty <= 0) {
      return { error: lineText('ed.err.line_qty_pos', 'Line {n}: quantity must be greater than 0.', n) };
    }
    if (v.qty > 100000) {
      return { error: lineText('ed.err.line_qty_max', 'Line {n}: quantity must be 100,000 or less.', n) };
    }
    if (v.unitCents === null || v.unitCents < 0) {
      return { error: lineText('ed.err.line_price', 'Line {n}: enter a valid unit price (0 or more).', n) };
    }
    if (v.unitCents > 1e12) {
      return { error: lineText('ed.err.line_price_max', 'Line {n}: unit price is too large.', n) };
    }
    items.push({ desc, qty: v.qty, unit_price_cents: v.unitCents });
  }
  if (items.length === 0) return { error: S['ed.err.items_min'] || 'Add at least one line item.' };
  if (items.length > 50) return { error: S['ed.err.items_max'] || 'A quote can have at most 50 line items.' };

  const discountRaw = String($('#discount-pct')?.value ?? '').trim();
  const discountPct = discountRaw === '' ? 0 : Number.parseFloat(discountRaw);
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return { error: S['ed.err.discount_range'] || 'Discount must be between 0 and 100.' };
  }
  const taxRaw = String($('#tax-pct')?.value ?? '').trim();
  const taxPct = taxRaw === '' ? 0 : Number.parseFloat(taxRaw);
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 100) {
    return { error: S['ed.err.tax_range'] || 'Tax must be between 0 and 100.' };
  }

  return {
    payload: {
      title,
      client_name: clientName,
      client_email: clientEmail,
      currency: currentCurrency(),
      valid_until: String($('#valid-until')?.value || '') || null,
      notes: String($('#notes')?.value || ''),
      terms: String($('#terms')?.value || ''),
      discount_pct: discountPct,
      tax_pct: taxPct,
      items,
    },
  };
}

function reloadSoon() {
  setTimeout(() => location.reload(), 1200);
}

if (editable) {
  $('#items-body')?.addEventListener('input', (event) => {
    if (event.target.closest('.item-row')) recalc();
  });
  $('#discount-pct')?.addEventListener('input', recalc);
  $('#tax-pct')?.addEventListener('input', recalc);
  $('#currency')?.addEventListener('change', recalc);
  $('#add-item')?.addEventListener('click', addRow);

  $('#items-body')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.item-remove');
    if (!btn) return;
    const row = btn.closest('.item-row');
    const rows = $$('#items-body .item-row');
    if (row && rows.length > 1) row.remove();
    else if (row) clearRow(row);
    renumber();
    recalc();
  });

  $('#save-btn')?.addEventListener('click', async () => {
    const result = collectPayload();
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    const btn = $('#save-btn');
    setBusy(btn, true, S['ed.busy.save'] || 'Saving…');
    try {
      if (quote) {
        await api(`/api/quotes/${quote.id}`, { method: 'PUT', body: result.payload });
        toast(S['ed.toast.saved'] || 'Changes saved.');
      } else {
        const data = await api('/api/quotes', { method: 'POST', body: result.payload });
        const id = Number(data?.quote?.id) || 0;
        flash(S['ed.flash.saved'] || 'Quote saved. Review it, then send the link to your client.');
        location.assign(`/app/quotes/${id}/edit`);
        return;
      }
    } catch (error) {
      if (error.code === 'free_limit_reached') {
        const dialog = $('#limit-dialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
        else toast(errorText(error), 'error');
      } else if (error.code === 'not_draft') {
        toast(errorText(error), 'error');
        reloadSoon();
      } else {
        toast(errorText(error), 'error');
      }
    } finally {
      setBusy(btn, false);
    }
  });

  $('#send-btn')?.addEventListener('click', async () => {
    const id = Number($('#send-btn')?.dataset.quoteId) || (quote && quote.id);
    if (!id) return;
    const btn = $('#send-btn');
    setBusy(btn, true, S['ed.busy.send'] || 'Sending…');
    try {
      await api(`/api/quotes/${id}/send`, { method: 'POST' });
      flash(S['ed.flash.sent'] || 'Quote sent. Share the public link with your client.');
      location.reload();
    } catch (error) {
      setBusy(btn, false);
      if (error.code === 'already_final' || error.code === 'not_draft') {
        toast(errorText(error), 'error');
        reloadSoon();
      } else {
        toast(errorText(error), 'error');
      }
    }
  });
}

const copyBtn = $('#send-copy');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const input = $('#send-url');
    const value = String(input?.value || '').trim();
    if (!value) {
      toast(S['ed.toast.no_link'] || 'No link to copy yet.', 'error');
      return;
    }
    try {
      await copyText(absoluteUrl(value));
      toast(S['toast.link_copied'] || 'Link copied to clipboard.');
    } catch {
      toast(S['ed.copy_failed'] || 'Could not copy the link. Select and copy it manually.', 'error');
    }
  });
}
