// Login / signup / forgot-password / reset-password form handling.

import { $, api, errorText, flash, setBusy } from './common.js';

const S = window.__I18N__?.t || {};

// Auth-form copy that intentionally differs from the shared errcode.* wording.
const ERROR_OVERRIDES = {
  rate_limited: S['auth.err.rate_limited'] || 'Too many attempts. Wait a minute and try again.',
};

const BUSY_LABELS = {
  signup: S['auth.busy.signup'] || 'Creating account…',
  login: S['auth.busy.login'] || 'Logging in…',
  forgot: S['auth.busy.forgot'] || 'Sending reset link…',
  reset: S['auth.busy.reset'] || 'Resetting password…',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showError(form, message) {
  const box = $('#auth-error');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  const field = form.querySelector('input:not([type="hidden"])');
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
  if (mode === 'forgot') {
    if (!EMAIL_RE.test(data.email)) return S['errcode.invalid_email'] || 'Enter a valid email address.';
    return null;
  }
  if (mode === 'reset') {
    if (!data.password || data.password.length < 8) {
      return S['errcode.invalid_password'] || 'Password must be at least 8 characters.';
    }
    if (data.password !== data.confirm) {
      return S['auth.err.password_mismatch'] || 'Passwords do not match.';
    }
    return null;
  }
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
    const rawMode = form.dataset.mode;
    const mode = rawMode === 'signup' || rawMode === 'forgot' || rawMode === 'reset' ? rawMode : 'login';
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
      if (mode === 'reset') {
        data.confirm = String($('#auth-password-confirm', form)?.value || '');
        data.token = String($('#reset-token', form)?.value || '');
      }

      const problem = validate(mode, data);
      if (problem) {
        showError(form, problem);
        return;
      }

      setBusy(submit, true, BUSY_LABELS[mode]);
      try {
        if (mode === 'forgot') {
          await api('/api/auth/forgot', { method: 'POST', body: { email: data.email } });
          // The API answers 200 for unknown emails too, so the same message is
          // shown either way — no account enumeration from the client.
          form.hidden = true;
          const success = $('#auth-success');
          if (success) {
            success.textContent =
              S['auth.forgot.success'] || "If an account exists for that email, we've sent a reset link.";
            success.hidden = false;
          }
          setBusy(submit, false);
          return;
        }
        if (mode === 'reset') {
          await api('/api/auth/reset', { method: 'POST', body: { token: data.token, password: data.password } });
          flash(S['auth.reset.flash'] || 'Password updated — log in with your new password.');
          location.assign('/login');
          return;
        }
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
