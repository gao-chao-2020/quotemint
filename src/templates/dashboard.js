// Dashboard (GET /app). Stats row, quote list with actions, plan usage meter.

import { bootScript, esc, formatDate, formatMoney, icon, layout, statusPill } from './layout.js';
import { t } from './i18n.js';

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

function usageCard(quota, lang) {
  if (!quota || quota.max === null || quota.max === undefined) {
    return `<div class="stat">
<div class="stat-top"><span class="stat-label">${esc(t(lang, 'dash.stat.usage'))}</span><span class="stat-icon">${icon('bolt', 18)}</span></div>
<div class="stat-value">${esc(t(lang, 'dash.usage.unlimited'))}</div>
<p class="stat-sub">${t(lang, 'dash.usage.pro_plan')}</p>
</div>`;
  }
  const used = Number(quota.used) || 0;
  const max = Number(quota.max) || 1;
  const pct = Math.min(100, Math.round((used / max) * 100));
  const atLimit = used >= max;
  const nearLimit = !atLimit && used >= max - 1;
  const resets = quota.resets_at ? esc(t(lang, 'dash.usage.resets', { date: formatDate(quota.resets_at, lang) })) : '';
  return `<div class="stat${atLimit ? ' stat-danger' : nearLimit ? ' stat-warn' : ''}">
<div class="stat-top"><span class="stat-label">${esc(t(lang, 'dash.stat.usage'))}</span><span class="stat-icon">${icon('bolt', 18)}</span></div>
<div class="stat-value">${esc(t(lang, 'dash.usage.of', { used, max }))}</div>
<div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(t(lang, 'dash.usage.meter_aria'))}"><span class="meter-fill" style="width:${pct}%"></span></div>
${atLimit
    ? `<p class="stat-sub">${t(lang, 'dash.usage.at_limit')}</p>`
    : nearLimit
      ? `<p class="stat-sub">${t(lang, 'dash.usage.near_limit')}</p>`
      : `<p class="stat-sub">${resets}</p>`}
</div>`;
}

function quoteRow(quote, lang) {
  const id = Number(quote.id) || 0;
  const token = String(quote.public_token || '');
  const status = String(quote.status || 'draft');
  const isDraft = status === 'draft';
  const views = Number(quote.views) || 0;
  const meta = [
    quote.client_name ? esc(quote.client_name) : '',
    quote.created_at ? esc(t(lang, 'dash.created', { date: formatDate(quote.created_at, lang) })) : '',
    `${icon('eye', 14)}<span>${views}</span>`,
  ].filter(Boolean).join('<span class="dot" aria-hidden="true"></span>');

  return `<li class="quote-row" data-id="${id}">
<div class="quote-main">
<a class="quote-title" href="/app/quotes/${id}/edit">${esc(quote.title || t(lang, 'dash.untitled'))}</a>
<p class="quote-meta">${meta}</p>
</div>
<span class="quote-status">${statusPill(status, lang)}</span>
<span class="quote-total">${esc(formatMoney(quote.total_cents, quote.currency))}</span>
<div class="quote-actions">
<a class="icon-btn" href="/q/${esc(token)}" target="_blank" rel="noopener" aria-label="${esc(t(lang, 'dash.row.open_page'))}" title="${esc(t(lang, 'dash.row.open_link'))}">${icon('external', 17)}</a>
<button type="button" class="icon-btn" data-copy-quote="${id}" aria-label="${esc(t(lang, 'dash.row.copy_link'))}" title="${esc(t(lang, 'dash.row.copy_title'))}">${icon('copy', 17)}</button>
${isDraft ? `<a class="icon-btn" href="/app/quotes/${id}/edit" aria-label="${esc(t(lang, 'dash.row.edit'))}" title="${esc(t(lang, 'dash.row.edit_title'))}">${icon('pencil', 17)}</a>` : ''}
${isDraft ? `<button type="button" class="icon-btn icon-btn-danger" data-delete-quote="${id}" aria-label="${esc(t(lang, 'dash.row.delete'))}" title="${esc(t(lang, 'dash.row.delete_title'))}">${icon('trash', 17)}</button>` : ''}
</div>
</li>`;
}

function emptyState(lang) {
  return `<div class="empty">
<span class="empty-icon">${icon('file', 26)}</span>
<h2 class="empty-title">${esc(t(lang, 'dash.empty.title'))}</h2>
<p class="empty-sub">${esc(t(lang, 'dash.empty.sub'))}</p>
<a class="btn btn-primary" href="/app/quotes/new">${esc(t(lang, 'dash.empty.cta'))}</a>
</div>`;
}

export function renderDashboard({ user, quotes = [], quota = null, lang = 'en', path = '/app' } = {}) {
  const list = Array.isArray(quotes) ? quotes : [];
  const engaged = list.filter((q) => ['sent', 'viewed', 'accepted', 'declined'].includes(q.status));
  const accepted = list.filter((q) => q.status === 'accepted').length;
  const rate = engaged.length > 0 ? accepted / engaged.length : null;
  const pipelineQuotes = list.filter((q) => q.status === 'sent' || q.status === 'viewed');
  const pipelineTotal = pipelineQuotes.reduce((sum, q) => sum + (Number(q.total_cents) || 0), 0);
  const pipelineCurrencies = new Set(pipelineQuotes.map((q) => q.currency).filter(Boolean));
  const pipelineMixed = pipelineCurrencies.size > 1;
  const pipelineValue = pipelineMixed
    ? t(lang, 'dash.pipeline.mixed')
    : formatMoney(pipelineTotal, [...pipelineCurrencies][0] || 'USD');

  const countSub = list.length === 1
    ? t(lang, 'dash.count.one')
    : t(lang, 'dash.count.many', { n: list.length });
  const rateSub = engaged.length === 0
    ? t(lang, 'dash.rate.none')
    : engaged.length === 1
      ? t(lang, 'dash.rate.one')
      : t(lang, 'dash.rate.many', { n: engaged.length });
  const pipelineSub = pipelineQuotes.length === 0
    ? t(lang, 'dash.pipeline.none')
    : pipelineQuotes.length === 1
      ? t(lang, 'dash.pipeline.one')
      : t(lang, 'dash.pipeline.many', { n: pipelineQuotes.length });

  const stats = `<div class="stats">
${statCard(t(lang, 'dash.stat.total'), String(list.length), countSub, 'file')}
${statCard(t(lang, 'dash.stat.rate'), rate === null ? '—' : formatRate(rate), rateSub, 'check-circle')}
${statCard(t(lang, 'dash.stat.pipeline'), pipelineValue, pipelineSub, 'dollar')}
${usageCard(quota, lang)}
</div>`;

  const boot = bootScript({
    quotes: list.map((q) => ({ id: Number(q.id) || 0, public_token: String(q.public_token || ''), status: String(q.status || 'draft') })),
    quota: quota || null,
  });

  const body = `
<div class="container app-main">
<div class="page-head">
<div>
<h1 class="page-title">${esc(t(lang, 'dash.head.title'))}</h1>
<p class="page-sub">${esc(t(lang, 'dash.head.sub'))}</p>
</div>
<a class="btn btn-primary" href="/app/quotes/new">${icon('plus', 17)} ${esc(t(lang, 'dash.head.new'))}</a>
</div>
${stats}
<section class="panel" aria-label="${esc(t(lang, 'dash.list.aria'))}">
${list.length === 0 ? emptyState(lang) : `<ul class="quote-list">${list.map((q) => quoteRow(q, lang)).join('')}</ul>`}
</section>
</div>
${boot}`;

  return layout({
    lang,
    path,
    title: t(lang, 'dash.meta.title'),
    description: t(lang, 'dash.meta.description'),
    body,
    nav: 'app',
    active: 'dashboard',
    user,
    bodyClass: 'page-app',
    scripts: ['/dashboard.js'],
  });
}
