// Error page for unmatched routes and unhandled errors.

import { esc, layout } from './layout.js';

const DEFAULT_MESSAGES = {
  400: 'That request could not be processed.',
  403: 'You do not have access to this page.',
  404: 'We could not find that page. It may have been moved or deleted.',
  500: 'Something went wrong on our end. Please try again in a moment.',
};

export function renderError({ status = 404, message = '' } = {}) {
  const code = Number(status) || 404;
  const text = message || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES[500];
  const body = `
<div class="error-wrap">
<div class="error-card">
<p class="error-code">${esc(code)}</p>
<h1 class="error-title">${code === 404 ? 'Page not found' : 'Something went wrong'}</h1>
<p class="error-text">${esc(text)}</p>
<div class="error-actions">
<a class="btn btn-primary" href="/">Back to home</a>
<a class="btn btn-secondary" href="/app">Go to dashboard</a>
</div>
</div>
</div>`;

  return layout({
    title: `${code} — QuoteMint`,
    description: text,
    body,
    nav: 'marketing',
    bodyClass: 'page-error',
    noindex: true,
  });
}
