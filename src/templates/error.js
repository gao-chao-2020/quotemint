// Error page for unmatched routes and unhandled errors.

import { esc, layout } from './layout.js';
import { t } from './i18n.js';

// Backend pages.js passes fixed English messages; map them to dictionary keys.
const SERVER_MESSAGE_KEYS = {
  'Quote not found': 'error.server.quote_not_found',
  'Page not found': 'error.server.page_not_found',
  'Something went wrong': 'error.server.generic',
};

const DEFAULT_MESSAGE_CODES = [400, 403, 404, 500];

export function renderError({ status = 404, message = '', lang = 'en', path = '/' } = {}) {
  const code = Number(status) || 404;
  let text;
  if (message) {
    const key = SERVER_MESSAGE_KEYS[message];
    text = key ? t(lang, key) : message;
  } else {
    text = t(lang, DEFAULT_MESSAGE_CODES.includes(code) ? `error.msg.${code}` : 'error.msg.500');
  }
  const body = `
<div class="error-wrap">
<div class="error-card">
<p class="error-code">${esc(code)}</p>
<h1 class="error-title">${esc(t(lang, code === 404 ? 'error.title.404' : 'error.title.generic'))}</h1>
<p class="error-text">${esc(text)}</p>
<div class="error-actions">
<a class="btn btn-primary" href="/">${esc(t(lang, 'error.back_home'))}</a>
<a class="btn btn-secondary" href="/app">${esc(t(lang, 'error.go_dashboard'))}</a>
</div>
</div>
</div>`;

  return layout({
    lang,
    path,
    title: `${code} — QuoteMint`,
    description: text,
    body,
    nav: 'marketing',
    bodyClass: 'page-error',
    noindex: true,
  });
}
