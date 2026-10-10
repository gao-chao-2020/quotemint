// Dashboard: copy quote links, delete drafts.

import { api, absoluteUrl, copyText, errorText, flash, toast } from './common.js';

const S = window.__I18N__?.t || {};
const boot = window.__BOOT__ || {};
const quoteById = new Map((boot.quotes || []).map((q) => [Number(q.id), q]));

function currentRow(event) {
  const el = event.target.closest('[data-id]');
  return el ? Number(el.dataset.id) : null;
}

document.addEventListener('click', async (event) => {
  const copyBtn = event.target.closest('[data-copy-quote]');
  if (!copyBtn) return;
  const id = currentRow(event);
  const quote = id !== null ? quoteById.get(id) : null;
  const token = copyBtn.dataset.token || (quote && quote.public_token);
  if (!token) return;
  try {
    await copyText(absoluteUrl(`/q/${token}`));
    toast(S['toast.link_copied'] || 'Link copied to clipboard.');
  } catch {
    toast(S['dash.copy_failed'] || 'Could not copy the link. Copy it from the quote page instead.', 'error');
  }
});

document.addEventListener('click', async (event) => {
  const deleteBtn = event.target.closest('[data-delete-quote]');
  if (!deleteBtn) return;
  const id = currentRow(event);
  if (id === null) return;
  if (!window.confirm(S['dash.confirm_delete'] || 'Delete this draft quote? This cannot be undone.')) return;
  deleteBtn.disabled = true;
  try {
    await api(`/api/quotes/${id}`, { method: 'DELETE' });
    flash(S['dash.deleted_flash'] || 'Quote deleted.');
    location.reload();
  } catch (error) {
    deleteBtn.disabled = false;
    if (error.code === 'not_draft') {
      toast(S['dash.not_deletable'] || 'This quote was already sent and cannot be deleted.', 'error');
      setTimeout(() => location.reload(), 1200);
    } else {
      toast(errorText(error), 'error');
    }
  }
});
