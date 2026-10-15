// Auth pages (GET /login, GET /signup, GET /forgot, GET /reset). Forms POST to
// /api/auth/* via fetch (public/auth.js).

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
${isSignup ? '' : `<p class="auth-switch">${t(lang, 'auth.login.forgot')}</p>`}
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

export function renderForgot({ lang = 'en', path = '/forgot' } = {}) {
  const body = `
<div class="auth-wrap">
<div class="auth-card">
<div class="auth-lang">${langSwitch(lang, path)}</div>
<a class="auth-brand brand" href="/"><span class="brand-name">QuoteMint</span></a>
<h1 class="auth-title">${esc(t(lang, 'auth.forgot.heading'))}</h1>
<p class="auth-sub">${esc(t(lang, 'auth.forgot.sub'))}</p>
<form id="auth-form" class="auth-form" data-mode="forgot" novalidate>
<p class="form-error" id="auth-error" role="alert" hidden></p>
<div class="field">
<label for="auth-email">${esc(t(lang, 'auth.label.email'))}</label>
<input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required>
</div>
<button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-submit">${esc(t(lang, 'auth.forgot.submit'))}</button>
</form>
<p class="auth-sub" id="auth-success" role="status" hidden></p>
<p class="auth-switch">${t(lang, 'auth.forgot.switch')}</p>
</div>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'auth.forgot.title'),
    description: t(lang, 'auth.forgot.description'),
    body,
    nav: 'none',
    bodyClass: 'page-auth',
    scripts: ['/auth.js'],
  });
}

export function renderReset({ lang = 'en', path = '/reset', token = '', invalid = false } = {}) {
  const form = invalid
    ? `<p class="form-error" role="alert">${esc(t(lang, 'auth.reset.invalid'))}</p>
<p class="auth-sub">${t(lang, 'auth.reset.retry')}</p>`
    : `<form id="auth-form" class="auth-form" data-mode="reset" novalidate>
<input type="hidden" id="reset-token" name="token" value="${esc(token)}">
<p class="form-error" id="auth-error" role="alert" hidden></p>
<div class="field">
<label for="auth-password">${esc(t(lang, 'auth.label.password'))}</label>
<input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required>
<p class="hint">${esc(t(lang, 'auth.hint.password'))}</p>
</div>
<div class="field">
<label for="auth-password-confirm">${esc(t(lang, 'auth.label.confirm_password'))}</label>
<input id="auth-password-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="200" required>
</div>
<button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-submit">${esc(t(lang, 'auth.reset.submit'))}</button>
</form>`;

  const body = `
<div class="auth-wrap">
<div class="auth-card">
<div class="auth-lang">${langSwitch(lang, path)}</div>
<a class="auth-brand brand" href="/"><span class="brand-name">QuoteMint</span></a>
<h1 class="auth-title">${esc(t(lang, 'auth.reset.heading'))}</h1>
<p class="auth-sub">${esc(t(lang, 'auth.reset.sub'))}</p>
${form}
</div>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'auth.reset.title'),
    description: t(lang, 'auth.reset.description'),
    body,
    nav: 'none',
    bodyClass: 'page-auth',
    scripts: ['/auth.js'],
  });
}
