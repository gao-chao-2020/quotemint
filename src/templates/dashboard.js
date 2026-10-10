// Dashboard (GET /app). Stats row, quote list with actions, plan usage meter.

import { bootScript, esc, formatDate, formatMoney, icon, layout, statusPill } from './layout.js';

function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

function statCard(label, value, sub, iconName, tone = '') {
  return `<div class="stat${tone ? ` stat-${tone}` : ''}">
<div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon">${icon(iconName, 18)}</span></div>
<div class="stat-value">${esc(value)}</div>
<p class="stat-sub">${esc(sub)}</p>
</div>`;
}

function usageCard(quota) {
  if (!quota || quota.max === null || quota.max === undefined) {
    return `<div class="stat">
<div class="stat-top"><span class="stat-label">Plan usage</span><span class="stat-icon">${icon('bolt', 18)}</span></div>
<div class="stat-value">Unlimited</div>
<p class="stat-sub">Pro plan · <a href="/app/billing">Billing</a></p>
</div>`;
  }
  const used = Number(quota.used) || 0;
  const max = Number(quota.max) || 1;
  const pct = Math.min(100, Math.round((used / max) * 100));
  const atLimit = used >= max;
  const nearLimit = !atLimit && used >= max - 1;
  const resets = quota.resets_at ? `Resets ${formatDate(quota.resets_at)}` : '';
  return `<div class="stat${atLimit ? ' stat-danger' : nearLimit ? ' stat-warn' : ''}">
<div class="stat-top"><span class="stat-label">Plan usage</span><span class="stat-icon">${icon('bolt', 18)}</span></div>
<div class="stat-value">${used} of ${max} quotes</div>
<div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Monthly quote usage"><span class="meter-fill" style="width:${pct}%"></span></div>
${atLimit
    ? '<p class="stat-sub">Limit reached — <a href="/app/billing">Upgrade to Pro</a></p>'
    : nearLimit
      ? '<p class="stat-sub">Almost out — <a href="/app/billing">Upgrade to Pro</a></p>'
      : `<p class="stat-sub">${esc(resets)}</p>`}
</div>`;
}

function quoteRow(quote) {
  const id = Number(quote.id) || 0;
  const token = String(quote.public_token || '');
  const status = String(quote.status || 'draft');
  const isDraft = status === 'draft';
  const views = Number(quote.views) || 0;
  const meta = [
    quote.client_name ? esc(quote.client_name) : '',
    quote.created_at ? esc(`Created ${formatDate(quote.created_at)}`) : '',
    `${icon('eye', 14)}<span>${views}</span>`,
  ].filter(Boolean).join('<span class="dot" aria-hidden="true"></span>');

  return `<li class="quote-row" data-id="${id}">
<div class="quote-main">
<a class="quote-title" href="/app/quotes/${id}/edit">${esc(quote.title || 'Untitled quote')}</a>
<p class="quote-meta">${meta}</p>
</div>
<span class="quote-status">${statusPill(status)}</span>
<span class="quote-total">${esc(formatMoney(quote.total_cents, quote.currency))}</span>
<div class="quote-actions">
<a class="icon-btn" href="/q/${esc(token)}" target="_blank" rel="noopener" aria-label="Open public quote page" title="Open public link">${icon('external', 17)}</a>
<button type="button" class="icon-btn" data-copy-quote="${id}" aria-label="Copy quote link" title="Copy link">${icon('copy', 17)}</button>
${isDraft ? `<a class="icon-btn" href="/app/quotes/${id}/edit" aria-label="Edit quote" title="Edit">${icon('pencil', 17)}</a>` : ''}
${isDraft ? `<button type="button" class="icon-btn icon-btn-danger" data-delete-quote="${id}" aria-label="Delete quote" title="Delete">${icon('trash', 17)}</button>` : ''}
</div>
</li>`;
}

function emptyState() {
  return `<div class="empty">
<span class="empty-icon">${icon('file', 26)}</span>
<h2 class="empty-title">No quotes yet</h2>
<p class="empty-sub">Create your first quote and share it as a link. It takes about a minute.</p>
<a class="btn btn-primary" href="/app/quotes/new">New quote</a>
</div>`;
}

export function renderDashboard({ user, quotes = [], quota = null } = {}) {
  const list = Array.isArray(quotes) ? quotes : [];
  const engaged = list.filter((q) => ['sent', 'viewed', 'accepted', 'declined'].includes(q.status));
  const accepted = list.filter((q) => q.status === 'accepted').length;
  const rate = engaged.length > 0 ? accepted / engaged.length : null;
  const pipelineQuotes = list.filter((q) => q.status === 'sent' || q.status === 'viewed');
  const pipelineTotal = pipelineQuotes.reduce((sum, q) => sum + (Number(q.total_cents) || 0), 0);
  const pipelineCurrencies = new Set(pipelineQuotes.map((q) => q.currency).filter(Boolean));
  const pipelineMixed = pipelineCurrencies.size > 1;
  const pipelineValue = pipelineMixed
    ? 'Multi-currency'
    : formatMoney(pipelineTotal, [...pipelineCurrencies][0] || 'USD');

  const stats = `<div class="stats">
${statCard('Total quotes', String(list.length), list.length === 1 ? '1 quote created' : `${list.length} quotes created`, 'file')}
${statCard('Acceptance rate', rate === null ? '—' : formatRate(rate), engaged.length === 0 ? 'No sent quotes yet' : `Across ${engaged.length} sent ${engaged.length === 1 ? 'quote' : 'quotes'}`, 'check-circle')}
${statCard('Pipeline value', pipelineValue, pipelineQuotes.length === 0 ? 'Nothing pending' : `${pipelineQuotes.length} ${pipelineQuotes.length === 1 ? 'quote' : 'quotes'} awaiting a response`, 'dollar')}
${usageCard(quota)}
</div>`;

  const boot = bootScript({
    quotes: list.map((q) => ({ id: Number(q.id) || 0, public_token: String(q.public_token || ''), status: String(q.status || 'draft') })),
    quota: quota || null,
  });

  const body = `
<div class="container app-main">
<div class="page-head">
<div>
<h1 class="page-title">Quotes</h1>
<p class="page-sub">Everything you have sent and everything still on the table.</p>
</div>
<a class="btn btn-primary" href="/app/quotes/new">${icon('plus', 17)} New quote</a>
</div>
${stats}
<section class="panel" aria-label="Your quotes">
${list.length === 0 ? emptyState() : `<ul class="quote-list">${list.map(quoteRow).join('')}</ul>`}
</section>
</div>
${boot}`;

  return layout({
    title: 'Dashboard — QuoteMint',
    description: 'Your quotes, acceptance rate, and pipeline value.',
    body,
    nav: 'app',
    active: 'dashboard',
    user,
    bodyClass: 'page-app',
    scripts: ['/dashboard.js'],
  });
}
