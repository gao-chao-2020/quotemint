// Admin panel pages (GET /admin, GET /admin/login, GET /admin/users).
// Minimal standalone pages: layout({ nav: 'none' }) chrome + esc(); actions are
// wired by src/assets/admin.js (served at /admin/admin.js; fetch + X-Requested-With).

import { esc, formatDate, formatDateTime, formatMoney, icon, langSwitch, layout, statusPill } from './layout.js';
import { t } from './i18n.js';

function statCard(label, value, iconName) {
  return `<div class="stat">
<div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon">${icon(iconName, 18)}</span></div>
<div class="stat-value">${esc(value)}</div>
</div>`;
}

function userRow(user, lang) {
  const email = String(user.email || '');
  const isPro = user.plan === 'pro';
  return `<tr>
<td class="admin-col-email">${esc(email)}</td>
<td>${esc(user.name || '')}</td>
<td><span class="pill pill-${isPro ? 'pro' : 'free'}">${esc(t(lang, isPro ? 'nav.plan.pro' : 'nav.plan.free'))}</span></td>
<td>${user.plan_renews_at ? esc(formatDate(user.plan_renews_at, lang)) : '—'}</td>
<td>${user.created_at ? esc(formatDate(user.created_at, lang)) : '—'}</td>
<td>
<div class="admin-row-actions">
<input type="number" class="input admin-months" min="1" max="120" value="12" aria-label="${esc(t(lang, 'admin.col.months'))}">
<button type="button" class="btn btn-primary btn-sm" data-admin-grant="${esc(email)}">${esc(t(lang, 'admin.btn.grant'))}</button>
<button type="button" class="btn btn-secondary btn-sm" data-admin-revoke="${esc(email)}">${esc(t(lang, 'admin.btn.revoke'))}</button>
</div>
</td>
</tr>`;
}

function userTable(users, lang) {
  const rows = Array.isArray(users) ? users : [];
  if (rows.length === 0) return `<p class="admin-empty">${esc(t(lang, 'admin.users.empty'))}</p>`;
  return `<div class="table-scroll"><table class="admin-table">
<thead><tr>
<th>${esc(t(lang, 'admin.col.email'))}</th>
<th>${esc(t(lang, 'admin.col.name'))}</th>
<th>${esc(t(lang, 'admin.col.plan'))}</th>
<th>${esc(t(lang, 'admin.col.renews'))}</th>
<th>${esc(t(lang, 'admin.col.created'))}</th>
<th>${esc(t(lang, 'admin.col.actions'))}</th>
</tr></thead>
<tbody>${rows.map((user) => userRow(user, lang)).join('')}</tbody>
</table></div>`;
}

function auditTable(events, lang) {
  const rows = Array.isArray(events) ? events : [];
  if (rows.length === 0) return `<p class="admin-empty">${esc(t(lang, 'admin.audit.empty'))}</p>`;
  const body = rows
    .map((event) => {
      const label = event.action === 'grant' ? 'admin.action.grant' : event.action === 'revoke' ? 'admin.action.revoke' : '';
      return `<tr>
<td>${esc(formatDateTime(event.at, lang))}</td>
<td>${esc(label ? t(lang, label) : String(event.action || ''))}</td>
<td class="admin-col-email">${esc(event.target_email)}</td>
<td>${esc(event.detail || '')}</td>
</tr>`;
    })
    .join('');
  return `<div class="table-scroll"><table class="admin-table admin-table-audit">
<thead><tr>
<th>${esc(t(lang, 'admin.audit.at'))}</th>
<th>${esc(t(lang, 'admin.audit.action'))}</th>
<th>${esc(t(lang, 'admin.audit.user'))}</th>
<th>${esc(t(lang, 'admin.audit.detail'))}</th>
</tr></thead>
<tbody>${body}</tbody>
</table></div>`;
}

function searchForm(q, lang, action = '/admin/users', placeholderKey = 'admin.search.placeholder') {
  const placeholder = esc(t(lang, placeholderKey));
  return `<form class="admin-search" method="get" action="${action}">
<input class="input" type="search" name="q" value="${esc(q)}" maxlength="254" placeholder="${placeholder}" aria-label="${placeholder}">
<button type="submit" class="btn btn-secondary btn-sm">${esc(t(lang, 'admin.search.submit'))}</button>
</form>`;
}

function adminNav(lang, path) {
  const link = (href, key, current) =>
    `<a class="btn ${current ? 'btn-primary' : 'btn-secondary'} btn-sm" href="${href}"${current ? ' aria-current="page"' : ''}>${esc(t(lang, key))}</a>`;
  const onUsers = path === '/admin' || path === '/admin/users';
  return `<nav class="admin-nav">${link('/admin', 'admin.nav.users', onUsers)}${link('/admin/quotes', 'admin.nav.quotes', path === '/admin/quotes')}</nav>`;
}

function quoteRow(quote, lang) {
  const token = String(quote.public_token || '');
  return `<tr>
<td>${esc(quote.title || '')}</td>
<td>${esc(quote.client_name || '')}</td>
<td class="admin-col-email">${esc(quote.owner_email || '')}</td>
<td>${statusPill(quote.status, lang)}</td>
<td>${esc(formatMoney(quote.total_cents, quote.currency || 'USD'))}</td>
<td>${quote.created_at ? esc(formatDate(quote.created_at, lang)) : '—'}</td>
<td>${token ? `<a class="btn btn-secondary btn-sm" href="/q/${esc(token)}" target="_blank" rel="noopener">${esc(t(lang, 'admin.quotes.view'))}</a>` : '—'}</td>
</tr>`;
}

function quoteTable(quotes, lang) {
  const rows = Array.isArray(quotes) ? quotes : [];
  if (rows.length === 0) return `<p class="admin-empty">${esc(t(lang, 'admin.quotes.empty'))}</p>`;
  return `<div class="table-scroll"><table class="admin-table">
<thead><tr>
<th>${esc(t(lang, 'admin.col.title'))}</th>
<th>${esc(t(lang, 'admin.col.client'))}</th>
<th>${esc(t(lang, 'admin.col.owner'))}</th>
<th>${esc(t(lang, 'admin.col.status'))}</th>
<th>${esc(t(lang, 'admin.col.total'))}</th>
<th>${esc(t(lang, 'admin.col.created'))}</th>
<th>${esc(t(lang, 'admin.quotes.view'))}</th>
</tr></thead>
<tbody>${rows.map((quote) => quoteRow(quote, lang)).join('')}</tbody>
</table></div>`;
}

export function renderAdminLogin({ lang = 'en', path = '/admin/login' } = {}) {
  const body = `
<div class="auth-wrap">
<div class="auth-card">
<div class="auth-lang">${langSwitch(lang, path)}</div>
<h1 class="auth-title">${esc(t(lang, 'admin.login.heading'))}</h1>
<p class="auth-sub">${esc(t(lang, 'admin.login.sub'))}</p>
<form id="admin-login-form" class="auth-form" novalidate>
<p class="form-error" id="admin-login-error" role="alert" hidden></p>
<div class="field">
<label for="admin-password">${esc(t(lang, 'admin.login.label'))}</label>
<input id="admin-password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
</div>
<button type="submit" class="btn btn-primary btn-block btn-lg" id="admin-login-submit">${esc(t(lang, 'admin.login.submit'))}</button>
</form>
</div>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'admin.meta.login_title'),
    description: '',
    body,
    nav: 'none',
    bodyClass: 'page-admin',
    scripts: ['/admin/admin.js'],
    noindex: true,
  });
}

export function renderAdminDashboard({ stats = {}, users = [], events = [], lang = 'en', path = '/admin' } = {}) {
  const body = `
<div class="container admin-main">
<div class="page-head">
<div>
<h1 class="page-title">${esc(t(lang, 'admin.dash.title'))}</h1>
<p class="page-sub">${esc(t(lang, 'admin.dash.sub'))}</p>
</div>
<div class="admin-head-actions">
${langSwitch(lang, path)}
<button type="button" class="btn btn-secondary btn-sm" data-admin-logout>${esc(t(lang, 'admin.btn.logout'))}</button>
</div>
</div>
<p class="form-error" id="admin-status" role="alert" hidden></p>
${adminNav(lang, path)}
<div class="stats">
${statCard(t(lang, 'admin.stat.users'), String(Number(stats.total_users) || 0), 'users')}
${statCard(t(lang, 'admin.stat.quotes'), String(Number(stats.total_quotes) || 0), 'file')}
${statCard(t(lang, 'admin.stat.users_month'), String(Number(stats.users_month) || 0), 'calendar')}
${statCard(t(lang, 'admin.stat.quotes_month'), String(Number(stats.quotes_month) || 0), 'chart')}
</div>
<section class="panel admin-section" aria-label="${esc(t(lang, 'admin.users.title'))}">
<div class="admin-section-head">
<h2 class="panel-title">${esc(t(lang, 'admin.users.title'))}</h2>
${searchForm('', lang)}
</div>
${userTable(users, lang)}
</section>
<section class="panel admin-section" aria-label="${esc(t(lang, 'admin.audit.title'))}">
<div class="admin-section-head">
<h2 class="panel-title">${esc(t(lang, 'admin.audit.title'))}</h2>
</div>
${auditTable(events, lang)}
</section>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'admin.meta.dashboard_title'),
    description: '',
    body,
    nav: 'none',
    bodyClass: 'page-admin',
    scripts: ['/admin/admin.js'],
    noindex: true,
  });
}

export function renderAdminUsers({ q = '', users = [], lang = 'en', path = '/admin/users' } = {}) {
  const heading = q ? t(lang, 'admin.users.results', { q }) : t(lang, 'admin.users.latest');
  const body = `
<div class="container admin-main">
<div class="page-head">
<div>
<h1 class="page-title">${esc(t(lang, 'admin.users.heading'))}</h1>
<p class="page-sub">${esc(t(lang, 'admin.users.sub'))}</p>
</div>
<div class="admin-head-actions">
${langSwitch(lang, path)}
<a class="btn btn-secondary btn-sm" href="/admin">${esc(t(lang, 'admin.users.back'))}</a>
</div>
</div>
<p class="form-error" id="admin-status" role="alert" hidden></p>
${adminNav(lang, path)}
<section class="panel admin-section" aria-label="${esc(t(lang, 'admin.users.title'))}">
<div class="admin-section-head">
<h2 class="panel-title">${esc(heading)}</h2>
${searchForm(q, lang)}
</div>
${userTable(users, lang)}
</section>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'admin.meta.dashboard_title'),
    description: '',
    body,
    nav: 'none',
    bodyClass: 'page-admin',
    scripts: ['/admin/admin.js'],
    noindex: true,
  });
}

export function renderAdminQuotes({ q = '', quotes = [], lang = 'en', path = '/admin/quotes' } = {}) {
  const heading = q ? t(lang, 'admin.quotes.results', { q }) : t(lang, 'admin.quotes.latest');
  const body = `
<div class="container admin-main">
<div class="page-head">
<div>
<h1 class="page-title">${esc(t(lang, 'admin.quotes.heading'))}</h1>
<p class="page-sub">${esc(t(lang, 'admin.quotes.sub'))}</p>
</div>
<div class="admin-head-actions">
${langSwitch(lang, path)}
<a class="btn btn-secondary btn-sm" href="/admin">${esc(t(lang, 'admin.users.back'))}</a>
</div>
</div>
<p class="form-error" id="admin-status" role="alert" hidden></p>
${adminNav(lang, path)}
<section class="panel admin-section" aria-label="${esc(t(lang, 'admin.nav.quotes'))}">
<div class="admin-section-head">
<h2 class="panel-title">${esc(heading)}</h2>
${searchForm(q, lang, '/admin/quotes', 'admin.quotes.search_placeholder')}
</div>
${quoteTable(quotes, lang)}
</section>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'admin.meta.dashboard_title'),
    description: '',
    body,
    nav: 'none',
    bodyClass: 'page-admin',
    scripts: ['/admin/admin.js'],
    noindex: true,
  });
}
