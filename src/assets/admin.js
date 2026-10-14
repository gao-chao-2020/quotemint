// Admin panel client: login form, grant/revoke actions, logout.
// Standalone on purpose — admin 401s must redirect to /admin/login (the shared
// common.js api() would send users to the customer login page instead).

const S = window.__I18N__?.t || {};

function $(selector, root = document) {
  return root.querySelector(selector);
}

// redirectOn401 is off for the login call itself: there a 401 means "wrong
// password", not an expired session.
async function call(path, body, { redirectOn401 = true } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error(S['errcode.network'] || 'Network error — check your connection and try again.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 401 && redirectOn401) {
    location.assign('/admin/login');
    throw new Error('unauthorized');
  }
  if (!payload || payload.ok !== true) {
    const error = payload?.error || {};
    throw new Error(S[`errcode.${error.code}`] || error.message || S['errcode.unknown'] || 'Something went wrong.');
  }
  return payload;
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (busyLabel) button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
}

function showStatus(message) {
  const box = $('#admin-status');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

{
  const form = $('#admin-login-form');
  if (form) {
    const errorBox = $('#admin-login-error');
    const submit = $('#admin-login-submit');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (errorBox) {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
      setBusy(submit, true, S['admin.login.busy'] || 'Signing in…');
      try {
        await call('/admin/login', { password: String($('#admin-password')?.value || '') }, { redirectOn401: false });
        location.assign('/admin');
      } catch (error) {
        setBusy(submit, false);
        if (error.message === 'unauthorized') return;
        if (errorBox) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
        }
        $('#admin-password')?.focus();
      }
    });
  }
}

document.addEventListener('click', async (event) => {
  const logoutBtn = event.target.closest('[data-admin-logout]');
  if (logoutBtn) {
    event.preventDefault();
    try {
      await call('/admin/logout');
    } catch {
      /* redirect regardless — the cookie may already be gone */
    }
    location.assign('/admin/login');
    return;
  }

  const actionBtn = event.target.closest('[data-admin-grant], [data-admin-revoke]');
  if (!actionBtn) return;
  event.preventDefault();

  const isGrant = actionBtn.hasAttribute('data-admin-grant');
  const email = actionBtn.getAttribute(isGrant ? 'data-admin-grant' : 'data-admin-revoke');
  if (!isGrant) {
    const prompt = String(S['admin.confirm_revoke'] || 'Revoke Pro for {email}?').replace('{email}', email);
    if (!window.confirm(prompt)) return;
  }

  const row = actionBtn.closest('tr');
  const monthsInput = row ? $('.admin-months', row) : null;
  const months = monthsInput && monthsInput.value !== '' ? Number(monthsInput.value) : undefined;

  setBusy(actionBtn, true, S[isGrant ? 'admin.busy.grant' : 'admin.busy.revoke'] || '');
  try {
    await call(isGrant ? '/admin/grant' : '/admin/revoke', isGrant ? { email, months } : { email });
    location.reload();
  } catch (error) {
    setBusy(actionBtn, false);
    if (error.message !== 'unauthorized') showStatus(error.message);
  }
});
