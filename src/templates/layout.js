// Shared layout, escaping, formatting and page chrome for all QuoteMint pages.
// Contract (docs/API-CONTRACT.md §12): this module exports esc() and layout().
// Backend routes import templates through the barrel (./index.js) only.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const DEFAULT_BRAND = '#4F46E5';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function jsonForScript(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function bootScript(data) {
  return `<script>window.__BOOT__ = ${jsonForScript(data)};</script>`;
}

export function formatMoney(cents, currency = 'USD') {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  }).format(date);
}

// Mirrors the §2 totals math exactly; used only when a route did not attach totals.
export function computeTotals(items, discountPct = 0, taxPct = 0) {
  const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));
  const lines = (Array.isArray(items) ? items : []).map((item) => {
    const line = Math.round(Number(item?.qty) * Number(item?.unit_price_cents));
    return Number.isFinite(line) ? line : 0;
  });
  const subtotal = lines.reduce((sum, line) => sum + line, 0);
  const discount = Math.round((subtotal * clamp(discountPct)) / 100);
  const tax = Math.round(((subtotal - discount) * clamp(taxPct)) / 100);
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: subtotal - discount + tax };
}

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', accepted: 'Accepted', declined: 'Declined' };

export function statusLabel(status) {
  return STATUS_LABELS[status] || 'Unknown';
}

export function statusPill(status) {
  return `<span class="pill pill-${esc(status)}">${esc(statusLabel(status))}</span>`;
}

export function sanitizeBrandColor(value) {
  const color = String(value ?? '');
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_BRAND;
}

function contrastInk(hex) {
  const channel = (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(channel(1)) + 0.7152 * linear(channel(3)) + 0.0722 * linear(channel(5));
  return luminance > 0.2 ? '#111827' : '#ffffff';
}

const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  check: '<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="11.5" r="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5"/>',
  gift: '<rect x="4" y="9.5" width="16" height="11" rx="1.5"/><path d="M2.5 6.5h19V10h-19z"/><path d="M12 6.5v14"/><path d="M12 6.5S10.5 2.5 8 3.5s0 3 4 3zM12 6.5s1.5-4 4-3 0 3-4 3z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  printer: '<path d="M6 9V3h12v6"/><path d="M6 14H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
  dollar: '<path d="M12 2.5v19"/><path d="M16.8 6.6c-.9-1.4-2.7-2.1-4.8-2.1-2.6 0-4.6 1.4-4.6 3.6 0 4.3 9.4 2.4 9.4 6.9 0 2.2-2 3.6-4.8 3.6-2.3 0-4.2-.9-5.2-2.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
  chart: '<path d="M5 20v-6M11 20V6M17 20v-9"/><path d="M3 20h18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.4 3.4-5.5 6.5-5.5s5.8 2.1 6.5 5.5"/><path d="M16.5 5a3.5 3.5 0 0 1 0 6.6"/><path d="M18.5 14.9c2 .8 3.4 2.5 4 5.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.2v.01"/>',
  'arrow-right': '<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/>',
  pen: '<path d="M12 19l7-7 2 2-7 7-2-2z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
};

export function icon(name, size = 18) {
  const paths = ICONS[name] || ICONS.check;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

function logoMark() {
  return '<svg class="logo-mark" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M9.5 17.4l4.6 4.4c3-6.8 6.4-9.9 8.6-11.2" fill="none" stroke="var(--brand-ink, #fff)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function planPill(user) {
  return user.plan === 'pro'
    ? '<span class="pill pill-pro">Pro</span>'
    : '<span class="pill pill-free">Free</span>';
}

function userMenu(user) {
  const initial = String(user.name || user.email || '?').trim().charAt(0).toUpperCase() || '?';
  return `<details class="user-menu">
<summary class="user-menu-trigger" aria-label="Account menu">
<span class="avatar" aria-hidden="true">${esc(initial)}</span>
<span class="user-menu-name">${esc(user.name)}</span>
</summary>
<div class="user-menu-pop">
<div class="user-menu-meta">
<div class="user-menu-full">${esc(user.name)}</div>
<div class="muted user-menu-email">${esc(user.email)}</div>
<div class="user-menu-plan">${planPill(user)}</div>
</div>
<button type="button" class="btn btn-secondary btn-sm btn-block" data-logout>Log out</button>
</div>
</details>`;
}

function marketingNav(user) {
  const actions = user
    ? '<a class="btn btn-primary btn-sm" href="/app">Dashboard</a>'
    : '<a class="btn btn-ghost btn-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Start free</a>';
  const mobileActions = user
    ? '<a class="nav-mobile-link" href="/app">Dashboard</a>'
    : '<a class="nav-mobile-link" href="/login">Log in</a><a class="nav-mobile-link nav-mobile-cta" href="/signup">Start free</a>';
  return `<header class="site-header" data-header>
<nav class="container nav" aria-label="Main">
<a class="brand" href="/">${logoMark()}<span class="brand-name">QuoteMint</span></a>
<div class="nav-links">
<a class="nav-link" href="/#features">Features</a>
<a class="nav-link" href="/#pricing">Pricing</a>
<a class="nav-link" href="/#faq">FAQ</a>
</div>
<div class="nav-actions">${actions}</div>
<details class="nav-mobile">
<summary aria-label="Open menu">${icon('menu', 22)}</summary>
<div class="nav-mobile-pop">
<a class="nav-mobile-link" href="/#features">Features</a>
<a class="nav-mobile-link" href="/#pricing">Pricing</a>
<a class="nav-mobile-link" href="/#faq">FAQ</a>
${mobileActions}
</div>
</details>
</nav>
</header>`;
}

function appNav(user, active) {
  const link = (href, label, key) =>
    `<a class="nav-link${active === key ? ' is-active' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const links = link('/app', 'Dashboard', 'dashboard') + link('/app/quotes/new', 'New quote', 'new') + link('/app/billing', 'Billing', 'billing');
  return `<header class="site-header app-header" data-header>
<nav class="container nav" aria-label="Main">
<a class="brand" href="/app">${logoMark()}<span class="brand-name">QuoteMint</span></a>
<div class="nav-links">${links}</div>
<div class="nav-actions">${userMenu(user)}</div>
<details class="nav-mobile">
<summary aria-label="Open menu">${icon('menu', 22)}</summary>
<div class="nav-mobile-pop">
${links}
<div class="nav-mobile-user muted">${esc(user.email)}</div>
<button type="button" class="btn btn-secondary btn-sm btn-block" data-logout>Log out</button>
</div>
</details>
</nav>
</header>`;
}

function siteFooter() {
  return `<footer class="site-footer">
<div class="container footer-grid">
<div class="footer-brand">
<a class="brand" href="/">${logoMark()}<span class="brand-name">QuoteMint</span></a>
<p class="footer-tagline">Send a quote. Know the moment it&rsquo;s opened. Built for freelancers and studios of one.</p>
</div>
<nav class="footer-col" aria-label="Product">
<h2 class="footer-heading">Product</h2>
<a href="/#features">Features</a>
<a href="/#pricing">Pricing</a>
<a href="/#faq">FAQ</a>
</nav>
<nav class="footer-col" aria-label="Account">
<h2 class="footer-heading">Account</h2>
<a href="/login">Log in</a>
<a href="/signup">Create account</a>
</nav>
</div>
<div class="container footer-bottom">
<p>© 2026 QuoteMint. All rights reserved.</p>
</div>
</footer>`;
}

function appFooter() {
  return `<footer class="app-footer">
<div class="container app-footer-inner">
<span>© 2026 QuoteMint</span>
<span class="muted">Send a quote. Know the moment it&rsquo;s opened.</span>
</div>
</footer>`;
}

export function layout({
  title = 'QuoteMint — Send a quote. Know the moment it\'s opened.',
  description = 'Send a quote as a link, see when your client opens it, and get it accepted online with their typed name.',
  body = '',
  nav = 'marketing',
  active = '',
  user = null,
  scripts = [],
  bodyClass = '',
  brandColor = null,
  noindex = false,
} = {}) {
  const brand = sanitizeBrandColor(brandColor);
  const styleAttr = brandColor ? ` style="--brand:${brand};--brand-ink:${contrastInk(brand)}"` : '';
  const useApp = nav === 'app' && user;
  const header = nav === 'none' ? '' : useApp ? appNav(user, active) : marketingNav(user);
  const footer = nav === 'none' ? '' : useApp ? appFooter() : siteFooter();
  const scriptTags = scripts.map((src) => `<script type="module" src="${esc(src)}"></script>`).join('\n');
  return `<!doctype html>
<html lang="en"${styleAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${brandColor ? brand : DEFAULT_BRAND}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:site_name" content="QuoteMint">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/styles.css">
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
${header}
<main id="main">
${body}
</main>
${footer}
<div id="toast-region" class="toast-region" aria-live="polite" role="status"></div>
${scriptTags}
</body>
</html>`;
}
