// Public quote page (GET /q/:token). Document-style layout, print-optimized A4.
// Branding (company/logo_text/brand_color) applies when the owner is on Pro.

import { bootScript, computeTotals, esc, footerMeta, formatDate, formatDateTime, formatMoney, icon, langSwitch, layout, sanitizeBrandColor } from './layout.js';
import { t } from './i18n.js';

function issuerName(branding) {
  return String(branding?.logo_text || branding?.company || '');
}

function issuerMonogram(name) {
  return name.trim().charAt(0).toUpperCase();
}

function itemsTable(quote, currency, lang) {
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
<th scope="col" class="doc-desc">${esc(t(lang, 'quote.items.desc'))}</th>
<th scope="col" class="doc-qty">${esc(t(lang, 'quote.items.qty'))}</th>
<th scope="col" class="doc-price">${esc(t(lang, 'quote.items.price'))}</th>
<th scope="col" class="doc-amount">${esc(t(lang, 'quote.items.amount'))}</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>`;
}

function stamp(quote, lang) {
  const status = String(quote.status || '');
  if (status === 'accepted') {
    const by = quote.accepted_name
      ? `<div class="stamp-line">${esc(t(lang, 'quote.signed_by', { name: quote.accepted_name }))}</div>`
      : '';
    const at = quote.accepted_at ? `<div class="stamp-line">${esc(formatDateTime(quote.accepted_at, lang))}</div>` : '';
    return `<div class="stamp stamp-accepted" role="status"><div class="stamp-label">${esc(t(lang, 'status.accepted'))}</div>${by}${at}</div>`;
  }
  if (status === 'declined') {
    const at = quote.declined_at ? `<div class="stamp-line">${esc(formatDateTime(quote.declined_at, lang))}</div>` : '';
    return `<div class="stamp stamp-declined" role="status"><div class="stamp-label">${esc(t(lang, 'status.declined'))}</div>${at}</div>`;
  }
  return '';
}

function dialogs(lang) {
  return `<dialog class="dialog" id="accept-dialog" aria-labelledby="accept-title">
<form class="dialog-form" id="accept-form">
<h2 class="dialog-title" id="accept-title">${esc(t(lang, 'quote.accept.title'))}</h2>
<p class="dialog-text">${esc(t(lang, 'quote.accept.text'))}</p>
<div class="field">
<label for="accept-name">${esc(t(lang, 'quote.accept.name'))}</label>
<input class="input" id="accept-name" type="text" maxlength="120" autocomplete="name" required>
</div>
<label class="check-row"><input type="checkbox" id="accept-agree"><span>${esc(t(lang, 'quote.accept.agree'))}</span></label>
<p class="form-error" id="accept-error" role="alert" hidden></p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>${esc(t(lang, 'quote.cancel'))}</button>
<button type="submit" class="btn btn-primary" id="accept-submit">${esc(t(lang, 'quote.accept.button'))}</button>
</div>
</form>
</dialog>
<dialog class="dialog" id="decline-dialog" aria-labelledby="decline-title">
<form class="dialog-form" id="decline-form">
<h2 class="dialog-title" id="decline-title">${esc(t(lang, 'quote.decline.title'))}</h2>
<p class="dialog-text">${esc(t(lang, 'quote.decline.text'))}</p>
<div class="field">
<label for="decline-reason">${esc(t(lang, 'quote.decline.reason'))} <span class="muted">${esc(t(lang, 'ed.common.optional'))}</span></label>
<textarea class="input" id="decline-reason" rows="3" maxlength="500" placeholder="${esc(t(lang, 'quote.decline.reason_ph'))}"></textarea>
</div>
<p class="form-error" id="decline-error" role="alert" hidden></p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>${esc(t(lang, 'quote.cancel'))}</button>
<button type="submit" class="btn btn-danger" id="decline-submit">${esc(t(lang, 'quote.decline.button'))}</button>
</div>
</form>
</dialog>`;
}

export function renderPublicQuote({ quote, totals, branding = null, showBadge = true, lang = 'en', path = '' } = {}) {
  if (!quote) {
    const resolvedPath = path || '/';
    const body = `<div class="doc-wrap"><div class="doc doc-missing">
<h1 class="doc-title">${esc(t(lang, 'quote.missing.title'))}</h1>
<p class="doc-text">${esc(t(lang, 'quote.missing.text'))}</p>
<a class="btn btn-primary" href="/">${esc(t(lang, 'quote.missing.cta'))}</a>
<footer class="doc-foot no-print">${langSwitch(lang, resolvedPath)}</footer>
</div></div>`;
    return layout({
      lang,
      path: resolvedPath,
      title: `${t(lang, 'quote.missing.title')} — QuoteMint`,
      body,
      nav: 'none',
      bodyClass: 'page-public',
      noindex: true,
    });
  }

  const resolvedPath = path || `/q/${String(quote.public_token || '')}`;
  const currency = String(quote.currency || 'USD');
  const sums = totals || computeTotals(quote.items, quote.discount_pct, quote.tax_pct);
  // Defense in depth: the article's --brand is CSS context, so it must be a validated
  // hex color even if a bad value slipped past API validation.
  const brand = branding?.brand_color ? sanitizeBrandColor(branding.brand_color) : '';
  const name = issuerName(branding);
  const monogram = name ? issuerMonogram(name) : '';
  const status = String(quote.status || 'draft');
  const isDraft = status === 'draft';
  const isOpen = status === 'sent' || status === 'viewed';
  const discountPct = Number(quote.discount_pct) || 0;
  const taxPct = Number(quote.tax_pct) || 0;
  const issuer = name || 'QuoteMint';

  const pageTitle = `${quote.title || t(lang, 'quote.title_fallback')} — ${issuer}`;

  const issuerBlock = name
    ? `<div class="doc-issuer">
<span class="doc-logo" aria-hidden="true">${esc(monogram)}</span>
<div>
<div class="doc-issuer-name">${esc(branding?.logo_text || name)}</div>
${branding?.logo_text && branding?.company ? `<div class="doc-issuer-sub">${esc(branding.company)}</div>` : ''}
</div>
</div>`
    : `<div class="doc-issuer"><div><div class="doc-issuer-name">${esc(t(lang, 'quote.issuer_fallback'))}</div></div></div>`;

  const actions = isOpen
    ? `<div class="doc-actions no-print">
<button type="button" class="btn btn-primary btn-lg" id="accept-btn">${esc(t(lang, 'quote.accept.button'))}</button>
<button type="button" class="btn btn-secondary btn-lg" id="decline-btn">${esc(t(lang, 'quote.decline.short'))}</button>
<button type="button" class="btn btn-ghost" id="print-btn" aria-label="${esc(t(lang, 'quote.print_aria'))}">${icon('printer', 17)} ${esc(t(lang, 'quote.print'))}</button>
</div>`
    : `<div class="doc-actions no-print">
<button type="button" class="btn btn-secondary" id="print-btn" aria-label="${esc(t(lang, 'quote.print_aria'))}">${icon('printer', 17)} ${esc(t(lang, 'quote.print'))}</button>
</div>`;

  const draftNotice = isDraft
    ? `<div class="draft-notice no-print" role="status">${icon('alert', 17)}<span>${esc(t(lang, 'quote.draft_notice'))}</span></div>`
    : '';

  const notesBlock = quote.notes
    ? `<section class="doc-section"><h2 class="doc-section-title">${esc(t(lang, 'quote.notes'))}</h2><p class="doc-text">${esc(quote.notes)}</p></section>`
    : '';
  const termsBlock = quote.terms
    ? `<section class="doc-section"><h2 class="doc-section-title">${esc(t(lang, 'quote.terms'))}</h2><p class="doc-text">${esc(quote.terms)}</p></section>`
    : '';

  const metaRows = [
    quote.id ? `<div class="doc-meta-item"><dt>${esc(t(lang, 'quote.meta.number'))}</dt><dd>#${Number(quote.id) || 0}</dd></div>` : '',
    quote.created_at ? `<div class="doc-meta-item"><dt>${esc(t(lang, 'quote.meta.issued'))}</dt><dd>${esc(formatDate(quote.created_at, lang))}</dd></div>` : '',
    quote.valid_until ? `<div class="doc-meta-item"><dt>${esc(t(lang, 'quote.meta.valid_until'))}</dt><dd>${esc(formatDate(quote.valid_until, lang))}</dd></div>` : '',
  ].filter(Boolean).join('');

  const foot = `<footer class="doc-foot no-print">
${showBadge ? `<a class="powered" href="/" target="_blank" rel="noopener">${t(lang, 'quote.powered_by')}</a>` : ''}
${footerMeta(lang)}
${langSwitch(lang, resolvedPath)}
</footer>`;

  const boot = bootScript({ token: String(quote.public_token || ''), status });

  const body = `
<div class="doc-wrap">
<article class="doc"${brand ? ` style="--brand:${esc(brand)}"` : ''}>
${isDraft ? `<div class="ribbon" aria-hidden="true">${esc(t(lang, 'status.draft'))}</div>` : ''}
<header class="doc-head">
${issuerBlock}
<div class="doc-meta">
<dl class="doc-meta-list">${metaRows}</dl>
${stamp(quote, lang)}
</div>
</header>
<div class="doc-title-block">
<h1 class="doc-title">${esc(quote.title || t(lang, 'quote.title_fallback'))}</h1>
<p class="doc-for">${t(lang, 'quote.prepared_for')}<strong>${esc(quote.client_name || '')}</strong>${quote.client_email ? ` <span class="muted">${esc(quote.client_email)}</span>` : ''}</p>
</div>
${draftNotice}
${itemsTable(quote, currency, lang)}
<div class="doc-sums">
<div class="doc-sum-row"><span>${esc(t(lang, 'quote.subtotal'))}</span><span class="doc-sum-num">${esc(formatMoney(sums.subtotal_cents, currency))}</span></div>
${discountPct > 0 ? `<div class="doc-sum-row"><span>${esc(t(lang, 'quote.discount', { n: discountPct }))}</span><span class="doc-sum-num">−${esc(formatMoney(sums.discount_cents, currency))}</span></div>` : ''}
${taxPct > 0 ? `<div class="doc-sum-row"><span>${esc(t(lang, 'quote.tax', { n: taxPct }))}</span><span class="doc-sum-num">+${esc(formatMoney(sums.tax_cents, currency))}</span></div>` : ''}
<div class="doc-sum-row doc-sum-grand"><span>${esc(t(lang, 'quote.total'))}</span><span class="doc-sum-num">${esc(formatMoney(sums.total_cents, currency))}</span></div>
</div>
${notesBlock}
${termsBlock}
${actions}
${foot}
</article>
</div>
${dialogs(lang)}
${boot}`;

  return layout({
    lang,
    path: resolvedPath,
    title: pageTitle,
    description: t(lang, 'quote.meta.desc', { issuer, client: quote.client_name || t(lang, 'quote.meta.you') }),
    body,
    nav: 'none',
    bodyClass: 'page-public',
    noindex: true,
    brandColor: brand || null,
    scripts: ['/publicquote.js'],
  });
}
