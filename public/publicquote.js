// Public quote page: accept / decline dialogs, print.

import { $, api, flash, setBusy, toast } from './common.js';

const boot = window.__BOOT__ || {};
const token = String(boot.token || '');

const ERROR_COPY = {
  invalid_name: 'Enter your full name (up to 120 characters).',
  not_agreed: 'Please agree to the terms to accept.',
  invalid_reason: 'Keep the reason under 500 characters.',
  rate_limited: 'Too many requests. Wait a few minutes and try again.',
  not_found: 'This quote is no longer available.',
};

function showInline(id, message) {
  const box = $(id);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

function clearInline(id) {
  const box = $(id);
  if (box) {
    box.hidden = true;
    box.textContent = '';
  }
}

function handleFailure(error, inlineId, submitBtn, busyLabel) {
  if (error.code === 'already_final' || error.code === 'not_found') {
    toast(error.code === 'already_final' ? 'This quote was already answered.' : error.message, 'error');
    setTimeout(() => location.reload(), 1200);
    return;
  }
  setBusy(submitBtn, false);
  showInline(inlineId, ERROR_COPY[error.code] || error.message || `Could not complete that. ${busyLabel}`);
}

$('#accept-btn')?.addEventListener('click', () => {
  const dialog = $('#accept-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    clearInline('#accept-error');
    dialog.showModal();
    $('#accept-name')?.focus();
  }
});

$('#decline-btn')?.addEventListener('click', () => {
  const dialog = $('#decline-dialog');
  if (dialog && typeof dialog.showModal === 'function') {
    clearInline('#decline-error');
    dialog.showModal();
  }
});

$('#print-btn')?.addEventListener('click', () => window.print());

$('#accept-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInline('#accept-error');
  const name = String($('#accept-name')?.value || '').trim();
  if (!name || name.length > 120) {
    showInline('#accept-error', 'Enter your full name to accept.');
    $('#accept-name')?.focus();
    return;
  }
  if (!$('#accept-agree')?.checked) {
    showInline('#accept-error', 'Please agree to the terms to accept.');
    return;
  }
  const btn = $('#accept-submit');
  setBusy(btn, true, 'Accepting…');
  try {
    await api(`/api/public/quotes/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: { name, agree: true },
    });
    flash('Quote accepted — your e-signature was recorded.');
    location.reload();
  } catch (error) {
    handleFailure(error, '#accept-error', btn, 'Try again.');
  }
});

$('#decline-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInline('#decline-error');
  const reason = String($('#decline-reason')?.value || '').trim();
  if (reason.length > 500) {
    showInline('#decline-error', 'Keep the reason under 500 characters.');
    return;
  }
  const btn = $('#decline-submit');
  setBusy(btn, true, 'Declining…');
  try {
    await api(`/api/public/quotes/${encodeURIComponent(token)}/decline`, {
      method: 'POST',
      body: reason ? { reason } : {},
    });
    flash('Quote declined. The sender has been notified in their dashboard.');
    location.reload();
  } catch (error) {
    handleFailure(error, '#decline-error', btn, 'Try again.');
  }
});
