// Auth pages (GET /login, GET /signup). Forms POST to /api/auth/* via fetch (public/auth.js).

import { esc, layout } from './layout.js';

export function renderAuth({ mode = 'login' } = {}) {
  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create your account — QuoteMint' : 'Log in — QuoteMint';
  const description = isSignup
    ? 'Create a free QuoteMint account and send your first quote in minutes.'
    : 'Log in to your QuoteMint account.';

  const form = isSignup
    ? `<div class="field">
<label for="auth-name">Your name</label>
<input id="auth-name" name="name" type="text" autocomplete="name" maxlength="80" required>
</div>
<div class="field">
<label for="auth-email">Email</label>
<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>
</div>
<div class="field">
<label for="auth-password">Password</label>
<input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required>
<p class="hint">8+ characters</p>
</div>`
    : `<div class="field">
<label for="auth-email">Email</label>
<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>
</div>
<div class="field">
<label for="auth-password">Password</label>
<input id="auth-password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
</div>`;

  const body = `
<div class="auth-wrap">
<div class="auth-card">
<a class="auth-brand brand" href="/"><span class="brand-name">QuoteMint</span></a>
<h1 class="auth-title">${isSignup ? 'Create your account' : 'Welcome back'}</h1>
<p class="auth-sub">${isSignup ? 'Send your first quote in minutes. Free for 3 quotes a month.' : 'Log in to manage your quotes.'}</p>
<form id="auth-form" class="auth-form" data-mode="${isSignup ? 'signup' : 'login'}" novalidate>
<p class="form-error" id="auth-error" role="alert" hidden></p>
${form}
<button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-submit">${isSignup ? 'Create account' : 'Log in'}</button>
</form>
<p class="auth-switch">${isSignup
    ? 'Already have an account? <a href="/login">Log in</a>'
    : 'New to QuoteMint? <a href="/signup">Create an account</a>'}</p>
</div>
</div>`;

  return layout({
    title,
    description,
    body,
    nav: 'none',
    bodyClass: 'page-auth',
    scripts: ['/auth.js'],
  });
}
