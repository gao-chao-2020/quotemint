// Public quote page (GET /q/:token). Document-style layout, print-optimized A4.
// Branding (company/logo_text/brand_color) applies when the owner is on Pro.

import { bootScript, computeTotals, esc, formatDate, formatDateTime, formatMoney, icon, layout } from './layout.js';

function issuerName(branding) {
  return String(branding?.logo_text || branding?.company || '');
}

function issuerMonogram(name) {
  return name.trim().charAt(0).toUpperCase();
}

function itemsTable(quote, currency) {
  const items = Array.isArray(quote.items) ? quote.items : [];
  const rows = items
    .map((item, index) => {
      const qty = Number(item?.qty);
      const unit = Number(item?.unit_price_cents);
      const line = Math.round((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0));
      return `<tr>
<td class="doc-num">${index + 1}</td>
<td class="doc-desc">${esc(item?.desc ?? '')}</td>
<td class="doc-qty">${esc(Number.isFinite(qty) ? qty : '')}</td>
<td class="doc-price">${esc(formatMoney(Number.isFinite(unit) ? unit : 0, currency))}</td>
<td class="doc-amount">${esc(formatMoney(line, currency))}</td>
</tr>`;
    })
    .join('');
  return `<table class="doc-table">
<thead>
<tr>
<th scope="col" class="doc-num">#</th>
<th scope="col" class="doc-desc">Description</th>
<th scope="col" class="doc-qty">Qty</th>
<th scope="col" class="doc-price">Unit price</th>
<th scope="col" class="doc-amount">Amount</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>`;
}

function stamp(quote) {
  const status = String(quote.status || '');
  if (status === 'accepted') {
    const by = quote.accepted_name ? `<div class="stamp-line">Signed by ${esc(quote.accepted_name)}</div>` : '';
    const at = quote.accepted_at ? `<div class="stamp-line">${esc(formatDateTime(quote.accepted_at))}</div>` : '';
    return `<div class="stamp stamp-accepted" role="status"><div class="stamp-label">Accepted</div>${by}${at}</div>`;
  }
  if (status === 'declined') {
    const at = quote.declined_at ? `<div class="stamp-line">${esc(formatDateTime(quote.declined_at))}</div>` : '';
    return `<div class="stamp stamp-declined" role="status"><div class="stamp-label">Declined</div>${at}</div>`;
  }
  return '';
}

function dialogs() {
  return `<dialog class="dialog" id="accept-dialog" aria-labelledby="accept-title">
<form class="dialog-form" id="accept-form">
<h2 class="dialog-title" id="accept-title">Accept this quote</h2>
<p class="dialog-text">Accepting records your typed name and a timestamp as your e-signature.</p>
<div class="field">
<label for="accept-name">Full name</label>
<input class="input" id="accept-name" type="text" maxlength="120" autocomplete="name" required>
</div>
<label class="check-row"><input type="checkbox" id="accept-agree"><span>I agree to the terms of this quote</span></label>
<p class="form-error" id="accept-error" role="alert" hidden></p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button>
<button type="submit" class="btn btn-primary" id="accept-submit">Accept quote</button>
</div>
</form>
</dialog>
<dialog class="dialog" id="decline-dialog" aria-labelledby="decline-title">
<form class="dialog-form" id="decline-form">
<h2 class="dialog-title" id="decline-title">Decline this quote</h2>
<p class="dialog-text">Let them know why, so they can revise the numbers. Optional.</p>
<div class="field">
<label for="decline-reason">Reason <span class="muted">(optional)</span></label>
<textarea class="input" id="decline-reason" rows="3" maxlength="500" placeholder="e.g. Budget is tighter than expected this quarter."></textarea>
</div>
<p class="form-error" id="decline-error" role="alert" hidden></p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>Cancel</button>
<button type="submit" class="btn btn-danger" id="decline-submit">Decline quote</button>
</div>
</form>
</dialog>`;
}

export function renderPublicQuote({ quote, totals, branding = null, showBadge = true } = {}) {
  if (!quote) {
    const body = `<div class="doc-wrap"><div class="doc doc-missing">
<h1 class="doc-title">Quote not found</h1>
<p class="doc-text">This quote link is invalid or the quote was removed.</p>
<a class="btn btn-primary" href="/">Go to QuoteMint</a>
</div></div>`;
    return layout({ title: 'Quote not found — QuoteMint', body, nav: 'none', bodyClass: 'page-public', noindex: true });
  }

  const currency = String(quote.currency || 'USD');
  const sums = totals || computeTotals(quote.items, quote.discount_pct, quote.tax_pct);
  const brand = String(branding?.brand_color || '');
  const name = issuerName(branding);
  const monogram = name ? issuerMonogram(name) : '';
  const status = String(quote.status || 'draft');
  const isDraft = status === 'draft';
  const isOpen = status === 'sent' || status === 'viewed';
  const isTerminal = status === 'accepted' || status === 'declined';
  const discountPct = Number(quote.discount_pct) || 0;
  const taxPct = Number(quote.tax_pct) || 0;

  const pageTitle = `${quote.title || 'Quote'} — ${name || 'QuoteMint'}`;

  const issuerBlock = name
    ? `<div class="doc-issuer">
<span class="doc-logo" aria-hidden="true">${esc(monogram)}</span>
<div>
<div class="doc-issuer-name">${esc(branding?.logo_text || name)}</div>
${branding?.logo_text && branding?.company ? `<div class="doc-issuer-sub">${esc(branding.company)}</div>` : ''}
</div>
</div>`
    : '<div class="doc-issuer"><div><div class="doc-issuer-name">Quote</div></div></div>';

  const actions = isOpen
    ? `<div class="doc-actions no-print">
<button type="button" class="btn btn-primary btn-lg" id="accept-btn">Accept quote</button>
<button type="button" class="btn btn-secondary btn-lg" id="decline-btn">Decline</button>
<button type="button" class="btn btn-ghost" id="print-btn" aria-label="Print or save as PDF">${icon('printer', 17)} Print</button>
</div>`
    : `<div class="doc-actions no-print">
<button type="button" class="btn btn-secondary" id="print-btn" aria-label="Print or save as PDF">${icon('printer', 17)} Print</button>
</div>`;

  const draftNotice = isDraft
    ? `<div class="draft-notice no-print" role="status">${icon('alert', 17)}<span>This is a draft — it has not been sent yet.</span></div>`
    : '';

  const notesBlock = quote.notes
    ? `<section class="doc-section"><h2 class="doc-section-title">Notes</h2><p class="doc-text">${esc(quote.notes)}</p></section>`
    : '';
  const termsBlock = quote.terms
    ? `<section class="doc-section"><h2 class="doc-section-title">Terms</h2><p class="doc-text">${esc(quote.terms)}</p></section>`
    : '';

  const metaRows = [
    quote.id ? `<div class="doc-meta-item"><dt>Quote</dt><dd>#${Number(quote.id) || 0}</dd></div>` : '',
    quote.created_at ? `<div class="doc-meta-item"><dt>Issued</dt><dd>${esc(formatDate(quote.created_at))}</dd></div>` : '',
    quote.valid_until ? `<div class="doc-meta-item"><dt>Valid until</dt><dd>${esc(formatDate(quote.valid_until))}</dd></div>` : '',
  ].filter(Boolean).join('');

  const badge = showBadge
    ? `<footer class="doc-foot no-print">
<a class="powered" href="/" target="_blank" rel="noopener">Powered by <span class="powered-brand">QuoteMint</span></a>
</footer>`
    : '';

  const boot = bootScript({ token: String(quote.public_token || ''), status });

  const body = `
<div class="doc-wrap">
<article class="doc"${brand ? ` style="--brand:${esc(brand)}"` : ''}>
${isDraft ? '<div class="ribbon" aria-hidden="true">Draft</div>' : ''}
<header class="doc-head">
${issuerBlock}
<div class="doc-meta">
<dl class="doc-meta-list">${metaRows}</dl>
${stamp(quote)}
</div>
</header>
<div class="doc-title-block">
<h1 class="doc-title">${esc(quote.title || 'Quote')}</h1>
<p class="doc-for">Prepared for <strong>${esc(quote.client_name || '')}</strong>${quote.client_email ? ` <span class="muted">${esc(quote.client_email)}</span>` : ''}</p>
</div>
${draftNotice}
${itemsTable(quote, currency)}
<div class="doc-sums">
<div class="doc-sum-row"><span>Subtotal</span><span class="doc-sum-num">${esc(formatMoney(sums.subtotal_cents, currency))}</span></div>
${discountPct > 0 ? `<div class="doc-sum-row"><span>Discount (${esc(discountPct)}%)</span><span class="doc-sum-num">−${esc(formatMoney(sums.discount_cents, currency))}</span></div>` : ''}
${taxPct > 0 ? `<div class="doc-sum-row"><span>Tax (${esc(taxPct)}%)</span><span class="doc-sum-num">+${esc(formatMoney(sums.tax_cents, currency))}</span></div>` : ''}
<div class="doc-sum-row doc-sum-grand"><span>Total</span><span class="doc-sum-num">${esc(formatMoney(sums.total_cents, currency))}</span></div>
</div>
${notesBlock}
${termsBlock}
${actions}
${badge}
</article>
</div>
${dialogs()}
${boot}`;

  return layout({
    title: pageTitle,
    description: `Quote from ${name || 'QuoteMint'} for ${quote.client_name || 'you'}.`,
    body,
    nav: 'none',
    bodyClass: 'page-public',
    noindex: true,
    brandColor: brand || null,
    scripts: ['/publicquote.js'],
  });
}
