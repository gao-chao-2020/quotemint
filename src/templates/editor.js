// Quote editor (GET /app/quotes/new, GET /app/quotes/:id/edit). Live totals mirror
// the §2 money math in integer cents; non-draft quotes render read-only.

import { bootScript, computeTotals, esc, formatDate, formatMoney, icon, layout, statusPill } from './layout.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY'];

function defaultItems(quote) {
  if (quote && Array.isArray(quote.items) && quote.items.length > 0) return quote.items;
  return [{ desc: '', qty: 1, unit_price_cents: 0 }];
}

function itemRow(item, index, editable, currency) {
  const qty = Number(item?.qty);
  const unit = Number(item?.unit_price_cents);
  const lineCents = Math.round((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0));
  const disabled = editable ? '' : ' disabled';
  return `<tr class="item-row">
<td class="col-desc"><input class="input item-desc" type="text" maxlength="500" placeholder="Description of work" aria-label="Line item ${index + 1} description" value="${esc(item?.desc ?? '')}"${disabled}></td>
<td class="col-qty"><input class="input item-qty" type="number" min="0" step="any" inputmode="decimal" aria-label="Line item ${index + 1} quantity" value="${esc(Number.isFinite(qty) ? qty : '')}"${disabled}></td>
<td class="col-price"><input class="input item-price" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Line item ${index + 1} unit price" value="${esc(Number.isFinite(unit) ? (unit / 100).toFixed(2) : '')}"${disabled}></td>
<td class="col-amount"><span class="line-total">${esc(formatMoney(lineCents, currency))}</span></td>
<td class="col-remove">${editable ? `<button type="button" class="icon-btn icon-btn-danger item-remove" aria-label="Remove line item ${index + 1}">${icon('x', 16)}</button>` : ''}</td>
</tr>`;
}

function readOnlyBanner(quote) {
  const status = String(quote.status || 'draft');
  let text;
  if (status === 'accepted') {
    const by = quote.accepted_name ? ` by ${quote.accepted_name}` : '';
    const at = quote.accepted_at ? ` on ${formatDate(quote.accepted_at)}` : '';
    text = `This quote was accepted${by}${at}.`;
  } else if (status === 'declined') {
    const at = quote.declined_at ? ` on ${formatDate(quote.declined_at)}` : '';
    text = `This quote was declined${at}.`;
  } else if (status === 'viewed') {
    text = 'Your client has viewed this quote. It can no longer be edited.';
  } else {
    text = 'This quote has been sent. It can no longer be edited.';
  }
  return `<div class="banner banner-${esc(status)}" role="status">${icon('alert', 18)}<div><strong>${esc(text)}</strong><p>Create a new quote if you need to send updated numbers.</p></div></div>`;
}

export function renderEditor({ user, quote = null, quota = null } = {}) {
  const editable = !quote || quote.status === 'draft';
  const currency = esc(quote?.currency || 'USD');
  const items = defaultItems(quote);
  const discountPct = Number(quote?.discount_pct) || 0;
  const taxPct = Number(quote?.tax_pct) || 0;
  const totals = quote?.totals || computeTotals(items, discountPct, taxPct);
  const isNew = !quote;
  const newAtLimit = isNew && quota && quota.max !== null && quota.max !== undefined && Number(quota.used) >= Number(quota.max);

  const title = isNew ? 'New quote — QuoteMint' : `${quote.title || 'Quote'} — QuoteMint`;

  const currencyOptions = CURRENCIES
    .map((code) => `<option value="${code}"${(quote?.currency || 'USD') === code ? ' selected' : ''}>${code}</option>`)
    .join('');

  const quotaBanner = newAtLimit
    ? `<div class="banner banner-warn" role="status">${icon('bolt', 18)}<div><strong>You have used all ${esc(String(quota.max))} free quotes this month.</strong><p>This quote will not save until you <a href="/app/billing">upgrade to Pro</a> or the month resets.</p></div></div>`
    : '';

  const limitDialog = `<dialog class="dialog" id="limit-dialog" aria-labelledby="limit-dialog-title">
<form class="dialog-form" method="dialog">
<h2 class="dialog-title" id="limit-dialog-title">Free plan limit reached</h2>
<p class="dialog-text">You have used all ${esc(String(quota?.max ?? 3))} quotes included in the free plan this month. Upgrade to Pro for unlimited quotes, custom branding, and full analytics.</p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>Not now</button>
<a class="btn btn-primary" href="/app/billing">View plans</a>
</div>
</form>
</dialog>`;

  const sendPanel = quote && quote.status === 'draft'
    ? `<div class="panel side-panel" id="send-panel">
<h2 class="side-title">${icon('send', 17)} Send to client</h2>
<p class="side-text">Mark this quote as sent and share its public link.</p>
<button type="button" class="btn btn-primary btn-block" id="send-btn" data-quote-id="${Number(quote.id) || 0}">Send to client</button>
<div class="send-result" id="send-result" hidden>
<p class="field-label">Public link</p>
<div class="copy-row">
<input class="input" id="send-url" type="text" readonly aria-label="Public quote link">
<button type="button" class="btn btn-secondary" id="send-copy">${icon('copy', 16)} Copy</button>
</div>
<a class="btn btn-secondary btn-block" id="send-open" href="#" target="_blank" rel="noopener">${icon('external', 16)} Open link</a>
</div>
</div>`
    : '';

  const linkPanel = quote && quote.status !== 'draft'
    ? `<div class="panel side-panel">
<h2 class="side-title">${icon('link', 17)} Public link</h2>
<p class="side-text">Anyone with this link can view this quote.</p>
<div class="copy-row">
<input class="input" id="send-url" type="text" readonly aria-label="Public quote link" value="${esc(`/q/${quote.public_token || ''}`)}">
<button type="button" class="btn btn-secondary" id="send-copy">${icon('copy', 16)} Copy</button>
</div>
<a class="btn btn-secondary btn-block" id="send-open" href="/q/${esc(quote.public_token || '')}" target="_blank" rel="noopener">${icon('external', 16)} Open link</a>
</div>`
    : '';

  const savePanel = editable
    ? `<div class="panel side-panel">
<button type="button" class="btn btn-primary btn-block btn-lg" id="save-btn">${isNew ? 'Save quote' : 'Save changes'}</button>
<p class="side-text">${isNew ? 'Save first, then send the link to your client.' : 'Changes apply immediately.'}</p>
</div>`
    : '';

  const statusMeta = quote
    ? `<p class="side-text">Status: ${statusPill(quote.status)}${quote.updated_at ? ` · Updated ${esc(formatDate(quote.updated_at))}` : ''}</p>`
    : '';

  const boot = bootScript({
    quote: quote
      ? { id: Number(quote.id) || 0, status: String(quote.status || 'draft'), currency: String(quote.currency || 'USD'), token: String(quote.public_token || '') }
      : null,
    editable,
    quota: quota || null,
  });

  const body = `
<div class="container app-main">
<div class="page-head">
<div>
<h1 class="page-title">${isNew ? 'New quote' : esc(quote.title || 'Quote')}</h1>
<p class="page-sub">${isNew ? 'Fill in the details — totals update as you type.' : `For ${esc(quote.client_name || 'your client')} · Created ${esc(formatDate(quote.created_at))}`}</p>
</div>
<a class="btn btn-secondary" href="/app">${icon('arrow-right', 16)} Back to dashboard</a>
</div>
${quote && !editable ? readOnlyBanner(quote) : ''}
${quotaBanner}
<div class="editor-grid">
<div class="editor-main">
<section class="panel" aria-label="Quote details">
<h2 class="panel-title">Details</h2>
<div class="field-grid">
<div class="field span-2">
<label for="quote-title">Quote title</label>
<input class="input" id="quote-title" type="text" maxlength="200" placeholder="e.g. Website redesign" value="${esc(quote?.title ?? '')}"${editable ? '' : ' disabled'} required>
</div>
<div class="field">
<label for="client-name">Client name</label>
<input class="input" id="client-name" type="text" maxlength="120" placeholder="e.g. Acme Co." value="${esc(quote?.client_name ?? '')}"${editable ? '' : ' disabled'} required>
</div>
<div class="field">
<label for="client-email">Client email <span class="muted">(optional)</span></label>
<input class="input" id="client-email" type="email" maxlength="254" placeholder="client@example.com" value="${esc(quote?.client_email ?? '')}"${editable ? '' : ' disabled'}>
</div>
<div class="field">
<label for="currency">Currency</label>
<select class="input" id="currency"${editable ? '' : ' disabled'}>${currencyOptions}</select>
</div>
<div class="field">
<label for="valid-until">Valid until <span class="muted">(optional)</span></label>
<input class="input" id="valid-until" type="date" value="${esc(quote?.valid_until ?? '')}"${editable ? '' : ' disabled'}>
</div>
</div>
</section>

<section class="panel" aria-label="Line items">
<h2 class="panel-title">Line items</h2>
<div class="table-scroll">
<table class="items-table">
<thead>
<tr>
<th scope="col" class="col-desc">Description</th>
<th scope="col" class="col-qty">Qty</th>
<th scope="col" class="col-price">Unit price</th>
<th scope="col" class="col-amount">Amount</th>
<th scope="col" class="col-remove"><span class="sr-only">Remove</span></th>
</tr>
</thead>
<tbody id="items-body">
${items.map((item, index) => itemRow(item, index, editable, quote?.currency || 'USD')).join('')}
</tbody>
</table>
</div>
${editable ? `<button type="button" class="btn btn-secondary btn-sm" id="add-item">${icon('plus', 16)} Add item</button>` : ''}
<div class="totals">
<div class="totals-row"><span>Subtotal</span><span class="num" id="sum-subtotal">${esc(formatMoney(totals.subtotal_cents, quote?.currency || 'USD'))}</span></div>
<div class="totals-row">
<span class="totals-label">Discount
${editable
    ? `<span class="pct-input"><input class="input input-pct" id="discount-pct" type="number" min="0" max="100" step="any" inputmode="decimal" aria-label="Discount percent" value="${esc(discountPct)}"><span class="pct-suffix">%</span></span>`
    : `<span class="muted">(${esc(discountPct)}%)</span>`}
</span>
<span class="num" id="sum-discount">−${esc(formatMoney(totals.discount_cents, quote?.currency || 'USD'))}</span>
</div>
<div class="totals-row">
<span class="totals-label">Tax
${editable
    ? `<span class="pct-input"><input class="input input-pct" id="tax-pct" type="number" min="0" max="100" step="any" inputmode="decimal" aria-label="Tax percent" value="${esc(taxPct)}"><span class="pct-suffix">%</span></span>`
    : `<span class="muted">(${esc(taxPct)}%)</span>`}
</span>
<span class="num" id="sum-tax">+${esc(formatMoney(totals.tax_cents, quote?.currency || 'USD'))}</span>
</div>
<div class="totals-row totals-grand"><span>Total</span><span class="num" id="sum-total">${esc(formatMoney(totals.total_cents, quote?.currency || 'USD'))}</span></div>
</div>
</section>

<section class="panel" aria-label="Notes and terms">
<h2 class="panel-title">Notes &amp; terms</h2>
<div class="field">
<label for="notes">Notes <span class="muted">(shown to your client)</span></label>
<textarea class="input" id="notes" rows="3" maxlength="2000" placeholder="Anything the client should know about this quote."${editable ? '' : ' disabled'}>${esc(quote?.notes ?? '')}</textarea>
</div>
<div class="field">
<label for="terms">Terms <span class="muted">(your client agrees to these on acceptance)</span></label>
<textarea class="input" id="terms" rows="3" maxlength="2000" placeholder="e.g. 50% deposit due on acceptance. Balance due on delivery."${editable ? '' : ' disabled'}>${esc(quote?.terms ?? '')}</textarea>
</div>
</section>
</div>

<aside class="editor-side">
${savePanel}
${sendPanel}
${linkPanel}
<div class="panel side-panel">
<h2 class="side-title">Quote status</h2>
${statusMeta}
<p class="side-text">${isNew ? 'This quote is not saved yet.' : editable ? 'Drafts can be edited and deleted. Sending locks it.' : 'Locked quotes cannot be edited or deleted.'}</p>
</div>
</aside>
</div>
</div>
<template id="item-row-template">${itemRow({ desc: '', qty: 1, unit_price_cents: 0 }, 0, true, quote?.currency || 'USD')}</template>
${limitDialog}
${boot}`;

  return layout({
    title,
    description: 'Build and send your quote.',
    body,
    nav: 'app',
    active: isNew ? 'new' : '',
    user,
    bodyClass: 'page-app page-editor',
    scripts: ['/editor.js'],
  });
}
