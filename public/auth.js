// Login / signup form handling.

import { $, api, errorText, setBusy } from './common.js';

const S = window.__I18N__?.t || {};

// Auth-form copy that intentionally differs from the shared errcode.* wording.
const ERROR_OVERRIDES = {
  rate_limited: S['auth.err.rate_limited'] || 'Too many attempts. Wait a minute and try again.',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showError(form, message) {
  const box = $('#auth-error');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  const field = form.querySelector('input');
  if (field) field.focus();
}

function clearError() {
  const box = $('#auth-error');
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

function validate(mode, data) {
  if (!EMAIL_RE.test(data.email)) return S['errcode.invalid_email'] || 'Enter a valid email address.';
  if (mode === 'signup') {
    if (!data.name || !data.name.trim()) return S['errcode.invalid_name'] || 'Enter your name.';
    if (!data.password || data.password.length < 8) {
      return S['errcode.invalid_password'] || 'Password must be at least 8 characters.';
    }
  } else if (!data.password) {
    return S['auth.err.enter_password'] || 'Enter your password.';
  }
  return null;
}

{
  const form = $('#auth-form');
  if (form) {
    const mode = form.dataset.mode === 'signup' ? 'signup' : 'login';
    const submit = $('#auth-submit');

    form.addEventListener('input', clearError);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError();

      const data = {
        email: String($('#auth-email', form)?.value || '').trim(),
        password: String($('#auth-password', form)?.value || ''),
      };
      if (mode === 'signup') data.name = String($('#auth-name', form)?.value || '').trim();

      const problem = validate(mode, data);
      if (problem) {
        showError(form, problem);
        return;
      }

      setBusy(submit, true, mode === 'signup' ? S['auth.busy.signup'] || 'Creating account…' : S['auth.busy.login'] || 'Logging in…');
      try {
        await api(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
          method: 'POST',
          body: mode === 'signup' ? { name: data.name, email: data.email, password: data.password } : { email: data.email, password: data.password },
        });
        location.assign('/app');
      } catch (error) {
        setBusy(submit, false);
        showError(form, errorText(error, ERROR_OVERRIDES));
      }
    });
  }
}
