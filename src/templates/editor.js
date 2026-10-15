// Quote editor (GET /app/quotes/new, GET /app/quotes/:id/edit). Live totals mirror
// the §2 money math in integer cents; non-draft quotes render read-only.

import { bootScript, computeTotals, esc, formatDate, formatDateTime, formatMoney, icon, layout, statusLabel, statusPill } from './layout.js';
import { t } from './i18n.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CNY'];

function defaultItems(quote) {
  if (quote && Array.isArray(quote.items) && quote.items.length > 0) return quote.items;
  return [{ desc: '', qty: 1, unit_price_cents: 0 }];
}

function itemRow(item, index, editable, currency, lang) {
  const qty = Number(item?.qty);
  const unit = Number(item?.unit_price_cents);
  const lineCents = Math.round((Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0));
  const disabled = editable ? '' : ' disabled';
  return `<tr class="item-row">
<td class="col-desc"><input class="input item-desc" type="text" maxlength="500" placeholder="${esc(t(lang, 'ed.items.desc_ph'))}" aria-label="${esc(t(lang, 'ed.item.aria_desc', { n: index + 1 }))}" value="${esc(item?.desc ?? '')}"${disabled}></td>
<td class="col-qty"><input class="input item-qty" type="number" min="0" step="any" inputmode="decimal" aria-label="${esc(t(lang, 'ed.item.aria_qty', { n: index + 1 }))}" value="${esc(Number.isFinite(qty) ? qty : '')}"${disabled}></td>
<td class="col-price"><input class="input item-price" type="number" min="0" step="0.01" inputmode="decimal" aria-label="${esc(t(lang, 'ed.item.aria_price', { n: index + 1 }))}" value="${esc(Number.isFinite(unit) ? (unit / 100).toFixed(2) : '')}"${disabled}></td>
<td class="col-amount"><span class="line-total">${esc(formatMoney(lineCents, currency))}</span></td>
<td class="col-remove">${editable ? `<button type="button" class="icon-btn icon-btn-danger item-remove" aria-label="${esc(t(lang, 'ed.item.aria_remove', { n: index + 1 }))}">${icon('x', 16)}</button>` : ''}</td>
</tr>`;
}

function readOnlyBanner(quote, lang) {
  const status = String(quote.status || 'draft');
  let text;
  if (status === 'accepted') {
    const key = quote.accepted_name && quote.accepted_at
      ? 'ed.banner.accepted_both'
      : quote.accepted_name
        ? 'ed.banner.accepted_by'
        : quote.accepted_at
          ? 'ed.banner.accepted_at'
          : 'ed.banner.accepted';
    text = t(lang, key, {
      name: quote.accepted_name || '',
      date: quote.accepted_at ? formatDate(quote.accepted_at, lang) : '',
    });
  } else if (status === 'declined') {
    text = quote.declined_at
      ? t(lang, 'ed.banner.declined_at', { date: formatDate(quote.declined_at, lang) })
      : t(lang, 'ed.banner.declined');
  } else if (status === 'viewed') {
    text = t(lang, 'ed.banner.viewed');
  } else {
    text = t(lang, 'ed.banner.sent');
  }
  return `<div class="banner banner-${esc(status)}" role="status">${icon('alert', 18)}<div><strong>${esc(text)}</strong><p>${esc(t(lang, 'ed.banner.followup'))}</p></div></div>`;
}

const ACTIVITY_TYPES = { sent: 'sent', view: 'viewed', accept: 'accepted', decline: 'declined' };
const ACTIVITY_ICONS = { sent: 'send', view: 'eye', accept: 'check-circle', decline: 'x' };

function activityItem(event, lang) {
  const type = String(event?.type || '');
  const status = ACTIVITY_TYPES[type];
  const label = status ? statusLabel(status, lang) : type;
  const reason = type === 'decline' && event?.meta
    ? `<p class="activity-reason">${esc(event.meta)}</p>`
    : '';
  return `<li class="activity-item">
<span class="activity-mark activity-mark-${esc(type)}">${icon(ACTIVITY_ICONS[type] || 'eye', 15)}</span>
<div>
<p class="activity-label">${esc(label)}<span class="activity-time">${esc(formatDateTime(event?.at, lang))}</span></p>
${reason}
</div>
</li>`;
}

function activityPanel(events, lang) {
  const title = esc(t(lang, 'ed.activity.title'));
  if (Array.isArray(events)) {
    const body = events.length > 0
      ? `<ol class="activity-list">${[...events].reverse().map((event) => activityItem(event, lang)).join('')}</ol>`
      : `<p class="side-text">${esc(t(lang, 'ed.activity.empty'))}</p>`;
    return `<div class="panel side-panel" aria-label="${title}">
<h2 class="side-title">${icon('chart', 17)} ${title}</h2>
${body}
</div>`;
  }
  return `<div class="panel side-panel" aria-label="${title}">
<h2 class="side-title">${icon('chart', 17)} ${title}</h2>
<p class="side-text">${t(lang, 'ed.activity.upgrade')}</p>
</div>`;
}

export function renderEditor({ user, quote = null, quota = null, events = null, lang = 'en', path = '' } = {}) {
  const editable = !quote || quote.status === 'draft';
  const currency = esc(quote?.currency || 'USD');
  const items = defaultItems(quote);
  const discountPct = Number(quote?.discount_pct) || 0;
  const taxPct = Number(quote?.tax_pct) || 0;
  const totals = quote?.totals || computeTotals(items, discountPct, taxPct);
  const isNew = !quote;
  const newAtLimit = isNew && quota && quota.max !== null && quota.max !== undefined && Number(quota.used) >= Number(quota.max);
  const resolvedPath = path || (quote ? `/app/quotes/${Number(quote.id) || 0}/edit` : '/app/quotes/new');

  const title = isNew
    ? t(lang, 'ed.meta.new_title')
    : t(lang, 'ed.meta.title', { title: quote.title || t(lang, 'ed.quote_fallback') });

  const currencyOptions = CURRENCIES
    .map((code) => `<option value="${code}"${(quote?.currency || 'USD') === code ? ' selected' : ''}>${code}</option>`)
    .join('');

  const quotaBanner = newAtLimit
    ? `<div class="banner banner-warn" role="status">${icon('bolt', 18)}<div><strong>${esc(t(lang, 'ed.quota.title', { max: quota.max }))}</strong><p>${t(lang, 'ed.quota.body')}</p></div></div>`
    : '';

  const limitDialog = `<dialog class="dialog" id="limit-dialog" aria-labelledby="limit-dialog-title">
<form class="dialog-form" method="dialog">
<h2 class="dialog-title" id="limit-dialog-title">${esc(t(lang, 'ed.limit.title'))}</h2>
<p class="dialog-text">${esc(t(lang, 'ed.limit.body', { max: quota?.max ?? 3 }))}</p>
<div class="dialog-actions">
<button type="button" class="btn btn-secondary" data-dialog-close>${esc(t(lang, 'ed.limit.not_now'))}</button>
<a class="btn btn-primary" href="/app/billing">${esc(t(lang, 'ed.limit.view_plans'))}</a>
</div>
</form>
</dialog>`;

  const sendPanel = quote && quote.status === 'draft'
    ? `<div class="panel side-panel" id="send-panel">
<h2 class="side-title">${icon('send', 17)} ${esc(t(lang, 'ed.send.title'))}</h2>
<p class="side-text">${esc(t(lang, 'ed.send.sub'))}</p>
<button type="button" class="btn btn-primary btn-block" id="send-btn" data-quote-id="${Number(quote.id) || 0}">${esc(t(lang, 'ed.send.button'))}</button>
</div>`
    : '';

  const linkPanel = quote && quote.status !== 'draft'
    ? `<div class="panel side-panel">
<h2 class="side-title">${icon('link', 17)} ${esc(t(lang, 'ed.link.public'))}</h2>
<p class="side-text">${esc(t(lang, 'ed.link.sub'))}</p>
<div class="copy-row">
<input class="input" id="send-url" type="text" readonly aria-label="${esc(t(lang, 'ed.link.aria'))}" value="${esc(`/q/${quote.public_token || ''}`)}">
<button type="button" class="btn btn-secondary" id="send-copy">${icon('copy', 16)} ${esc(t(lang, 'ed.copy'))}</button>
</div>
<a class="btn btn-secondary btn-block" id="send-open" href="/q/${esc(quote.public_token || '')}" target="_blank" rel="noopener">${icon('external', 16)} ${esc(t(lang, 'ed.open_link'))}</a>
</div>`
    : '';

  const savePanel = editable
    ? `<div class="panel side-panel">
<button type="button" class="btn btn-primary btn-block btn-lg" id="save-btn">${esc(t(lang, isNew ? 'ed.save.quote' : 'ed.save.changes'))}</button>
<p class="side-text">${esc(t(lang, isNew ? 'ed.save.sub_new' : 'ed.save.sub_edit'))}</p>
</div>`
    : '';

  const statusMeta = quote
    ? `<p class="side-text">${esc(t(lang, 'ed.status.prefix'))}${statusPill(quote.status, lang)}${quote.updated_at ? esc(t(lang, 'ed.status.updated', { date: formatDate(quote.updated_at, lang) })) : ''}</p>`
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
<h1 class="page-title">${isNew ? esc(t(lang, 'ed.head.new')) : esc(quote.title || t(lang, 'ed.quote_fallback'))}</h1>
<p class="page-sub">${isNew ? esc(t(lang, 'ed.head.fill')) : esc(t(lang, 'ed.head.for', { client: quote.client_name || t(lang, 'ed.head.your_client'), date: formatDate(quote.created_at, lang) }))}</p>
</div>
<a class="btn btn-secondary" href="/app">${icon('arrow-right', 16)} ${esc(t(lang, 'ed.head.back'))}</a>
</div>
${quote && !editable ? readOnlyBanner(quote, lang) : ''}
${quotaBanner}
<div class="editor-grid">
<div class="editor-main">
<section class="panel" aria-label="${esc(t(lang, 'ed.details.aria'))}">
<h2 class="panel-title">${esc(t(lang, 'ed.details.title'))}</h2>
<div class="field-grid">
<div class="field span-2">
<label for="quote-title">${esc(t(lang, 'ed.field.title'))}</label>
<input class="input" id="quote-title" type="text" maxlength="200" placeholder="${esc(t(lang, 'ed.field.title_ph'))}" value="${esc(quote?.title ?? '')}"${editable ? '' : ' disabled'} required>
</div>
<div class="field">
<label for="client-name">${esc(t(lang, 'ed.field.client'))}</label>
<input class="input" id="client-name" type="text" maxlength="120" placeholder="${esc(t(lang, 'ed.field.client_ph'))}" value="${esc(quote?.client_name ?? '')}"${editable ? '' : ' disabled'} required>
</div>
<div class="field">
<label for="client-email">${esc(t(lang, 'ed.field.email'))} <span class="muted">${esc(t(lang, 'ed.common.optional'))}</span></label>
<input class="input" id="client-email" type="email" maxlength="254" placeholder="${esc(t(lang, 'ed.field.email_ph'))}" value="${esc(quote?.client_email ?? '')}"${editable ? '' : ' disabled'}>
</div>
<div class="field">
<label for="currency">${esc(t(lang, 'ed.field.currency'))}</label>
<select class="input" id="currency"${editable ? '' : ' disabled'}>${currencyOptions}</select>
</div>
<div class="field">
<label for="valid-until">${esc(t(lang, 'ed.field.valid_until'))} <span class="muted">${esc(t(lang, 'ed.common.optional'))}</span></label>
<input class="input" id="valid-until" type="date" value="${esc(quote?.valid_until ?? '')}"${editable ? '' : ' disabled'}>
</div>
</div>
</section>

<section class="panel" aria-label="${esc(t(lang, 'ed.items.aria'))}">
<h2 class="panel-title">${esc(t(lang, 'ed.items.title'))}</h2>
<div class="table-scroll">
<table class="items-table">
<thead>
<tr>
<th scope="col" class="col-desc">${esc(t(lang, 'ed.items.desc'))}</th>
<th scope="col" class="col-qty">${esc(t(lang, 'ed.items.qty'))}</th>
<th scope="col" class="col-price">${esc(t(lang, 'ed.items.price'))}</th>
<th scope="col" class="col-amount">${esc(t(lang, 'ed.items.amount'))}</th>
<th scope="col" class="col-remove"><span class="sr-only">${esc(t(lang, 'ed.items.remove_sr'))}</span></th>
</tr>
</thead>
<tbody id="items-body">
${items.map((item, index) => itemRow(item, index, editable, quote?.currency || 'USD', lang)).join('')}
</tbody>
</table>
</div>
${editable ? `<button type="button" class="btn btn-secondary btn-sm" id="add-item">${icon('plus', 16)} ${esc(t(lang, 'ed.items.add'))}</button>` : ''}
<div class="totals">
<div class="totals-row"><span>${esc(t(lang, 'ed.totals.subtotal'))}</span><span class="num" id="sum-subtotal">${esc(formatMoney(totals.subtotal_cents, quote?.currency || 'USD'))}</span></div>
<div class="totals-row">
<span class="totals-label">${esc(t(lang, 'ed.totals.discount'))}
${editable
    ? `<span class="pct-input"><input class="input input-pct" id="discount-pct" type="number" min="0" max="100" step="any" inputmode="decimal" aria-label="${esc(t(lang, 'ed.totals.discount_aria'))}" value="${esc(discountPct)}"><span class="pct-suffix">%</span></span>`
    : `<span class="muted">(${esc(discountPct)}%)</span>`}
</span>
<span class="num" id="sum-discount">−${esc(formatMoney(totals.discount_cents, quote?.currency || 'USD'))}</span>
</div>
<div class="totals-row">
<span class="totals-label">${esc(t(lang, 'ed.totals.tax'))}
${editable
    ? `<span class="pct-input"><input class="input input-pct" id="tax-pct" type="number" min="0" max="100" step="any" inputmode="decimal" aria-label="${esc(t(lang, 'ed.totals.tax_aria'))}" value="${esc(taxPct)}"><span class="pct-suffix">%</span></span>`
    : `<span class="muted">(${esc(taxPct)}%)</span>`}
</span>
<span class="num" id="sum-tax">+${esc(formatMoney(totals.tax_cents, quote?.currency || 'USD'))}</span>
</div>
<div class="totals-row totals-grand"><span>${esc(t(lang, 'ed.totals.total'))}</span><span class="num" id="sum-total">${esc(formatMoney(totals.total_cents, quote?.currency || 'USD'))}</span></div>
</div>
</section>

<section class="panel" aria-label="${esc(t(lang, 'ed.notes.aria'))}">
<h2 class="panel-title">${t(lang, 'ed.notes.title')}</h2>
<div class="field">
<label for="notes">${esc(t(lang, 'ed.notes.label'))} <span class="muted">${esc(t(lang, 'ed.notes.shown'))}</span></label>
<textarea class="input" id="notes" rows="3" maxlength="2000" placeholder="${esc(t(lang, 'ed.notes.ph'))}"${editable ? '' : ' disabled'}>${esc(quote?.notes ?? '')}</textarea>
</div>
<div class="field">
<label for="terms">${esc(t(lang, 'ed.terms.label'))} <span class="muted">${esc(t(lang, 'ed.terms.agreed'))}</span></label>
<textarea class="input" id="terms" rows="3" maxlength="2000" placeholder="${esc(t(lang, 'ed.terms.ph'))}"${editable ? '' : ' disabled'}>${esc(quote?.terms ?? '')}</textarea>
</div>
</section>
</div>

<aside class="editor-side">
${savePanel}
${sendPanel}
${linkPanel}
<div class="panel side-panel">
<h2 class="side-title">${esc(t(lang, 'ed.status.panel'))}</h2>
${statusMeta}
<p class="side-text">${esc(t(lang, isNew ? 'ed.status.not_saved' : editable ? 'ed.status.draft_note' : 'ed.status.locked_note'))}</p>
</div>
${quote ? activityPanel(events, lang) : ''}
</aside>
</div>
</div>
<template id="item-row-template">${itemRow({ desc: '', qty: 1, unit_price_cents: 0 }, 0, true, quote?.currency || 'USD', lang)}</template>
${limitDialog}
${boot}`;

  return layout({
    lang,
    path: resolvedPath,
    title,
    description: t(lang, 'ed.meta.description'),
    body,
    nav: 'app',
    active: isNew ? 'new' : '',
    user,
    bodyClass: 'page-app page-editor',
    scripts: ['/editor.js'],
  });
}
