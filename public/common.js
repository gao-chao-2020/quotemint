// Shared client-side helpers: API fetch wrapper, toasts, flash messages, clipboard.

const FLASH_KEY = 'qm_flash';

// Server-injected strings (contract §16); EN literals below are the no-JS fallback.
const S = window.__I18N__?.t || {};

export class ApiError extends Error {
  constructor(code, message) {
    super(message || S['errcode.unknown'] || 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.code = code || 'unknown';
  }
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', S['errcode.network'] || 'Network error — check your connection and try again.');
  }

  if (response.status === 401) {
    const onAuthPage = /^\/(login|signup)/.test(location.pathname);
    if (!onAuthPage) {
      location.assign('/login');
      throw new ApiError('not_authenticated', S['errcode.not_authenticated'] || 'Please sign in to continue.');
    }
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!payload || payload.ok !== true) {
    const error = payload && payload.error ? payload.error : {};
    throw new ApiError(error.code || `http_${response.status}`, error.message || S['errcode.unknown'] || 'Something went wrong. Please try again.');
  }
  return payload.data === undefined ? null : payload.data;
}

// Resolution chain: page-context override -> errcode.<code> -> server EN message -> generic.
export function errorText(error, overrides = null) {
  const code = error?.code || 'unknown';
  if (overrides && overrides[code]) return overrides[code];
  const localized = S[`errcode.${code}`];
  if (localized) return localized;
  return error?.message || S['errcode.unknown'] || 'Something went wrong. Please try again.';
}

export function toast(message, type = 'info') {
  const region = $('#toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.append(dot, text);
  region.append(el);
  const life = type === 'error' ? 6000 : 4000;
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, life);
}

export function flash(message, type = 'success') {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type }));
  } catch {
    /* storage unavailable — toast is best-effort */
  }
}

export function showPendingFlash() {
  let raw = null;
  try {
    raw = sessionStorage.getItem(FLASH_KEY);
    if (raw) sessionStorage.removeItem(FLASH_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const { message, type } = JSON.parse(raw);
    if (message) toast(message, type || 'success');
  } catch {
    /* ignore malformed flash */
  }
}

export async function copyText(value) {
  const text = String(value ?? '');
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    area.remove();
  }
}

export function absoluteUrl(path) {
  return new URL(path, location.origin).href;
}

export function setBusy(button, busy, busyLabel = S['common.working'] || 'Working…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
}

// ---- Global delegated behaviors (run on every page that imports common.js) ----

document.addEventListener('click', (event) => {
  const closeBtn = event.target.closest('[data-dialog-close]');
  if (closeBtn) {
    const dialog = closeBtn.closest('dialog');
    if (dialog) dialog.close();
    return;
  }
});

document.addEventListener('click', async (event) => {
  const logoutBtn = event.target.closest('[data-logout]');
  if (!logoutBtn) return;
  event.preventDefault();
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* redirect regardless — session may already be gone */
  }
  location.assign('/');
});

{
  const header = $('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
}

showPendingFlash();
