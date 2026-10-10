// Auth pages (GET /login, GET /signup). Forms POST to /api/auth/* via fetch (public/auth.js).

import { esc, langSwitch, layout } from './layout.js';
import { t } from './i18n.js';

export function renderAuth({ mode = 'login', lang = 'en', path = '' } = {}) {
  const isSignup = mode === 'signup';
  const switchPath = path || (isSignup ? '/signup' : '/login');
  const title = t(lang, isSignup ? 'auth.signup.title' : 'auth.login.title');
  const description = t(lang, isSignup ? 'auth.signup.description' : 'auth.login.description');

  const form = isSignup
    ? `<div class="field">
<label for="auth-name">${esc(t(lang, 'auth.label.name'))}</label>
<input id="auth-name" name="name" type="text" autocomplete="name" maxlength="80" required>
</div>
<div class="field">
<label for="auth-email">${esc(t(lang, 'auth.label.email'))}</label>
<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>
</div>
<div class="field">
<label for="auth-password">${esc(t(lang, 'auth.label.password'))}</label>
<input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required>
<p class="hint">${esc(t(lang, 'auth.hint.password'))}</p>
</div>`
    : `<div class="field">
<label for="auth-email">${esc(t(lang, 'auth.label.email'))}</label>
<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>
</div>
<div class="field">
<label for="auth-password">${esc(t(lang, 'auth.label.password'))}</label>
<input id="auth-password" name="password" type="password" autocomplete="current-password" maxlength="200" required>
</div>`;

  const body = `
<div class="auth-wrap">
<div class="auth-card">
<div class="auth-lang">${langSwitch(lang, switchPath)}</div>
<a class="auth-brand brand" href="/"><span class="brand-name">QuoteMint</span></a>
<h1 class="auth-title">${esc(t(lang, isSignup ? 'auth.signup.heading' : 'auth.login.heading'))}</h1>
<p class="auth-sub">${esc(t(lang, isSignup ? 'auth.signup.sub' : 'auth.login.sub'))}</p>
<form id="auth-form" class="auth-form" data-mode="${isSignup ? 'signup' : 'login'}" novalidate>
<p class="form-error" id="auth-error" role="alert" hidden></p>
${form}
<button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-submit">${esc(t(lang, isSignup ? 'auth.signup.submit' : 'auth.login.submit'))}</button>
</form>
<p class="auth-switch">${t(lang, isSignup ? 'auth.signup.switch' : 'auth.login.switch')}</p>
</div>
</div>`;

  return layout({
    lang,
    path: switchPath,
    title,
    description,
    body,
    nav: 'none',
    bodyClass: 'page-auth',
    scripts: ['/auth.js'],
  });
}
