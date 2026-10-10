// Billing: Stripe checkout redirect, demo upgrade, and the post-checkout success banner.

import { $, api, setBusy, toast } from './common.js';

if (new URLSearchParams(location.search).get('upgraded') === '1') {
  if (!$('#upgraded-banner')) {
    const pageHead = $('.page-head');
    if (pageHead) {
      const banner = document.createElement('div');
      banner.className = 'banner banner-success';
      banner.id = 'upgraded-banner';
      banner.setAttribute('role', 'status');
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = 'Welcome to Pro!';
      const body = document.createElement('p');
      body.textContent = 'Unlimited quotes, custom branding, and full analytics are now active.';
      text.append(title, body);
      banner.append(text);
      pageHead.after(banner);
    }
  }
  history.replaceState(null, '', location.pathname);
}

$('#upgrade-btn')?.addEventListener('click', async () => {
  const btn = $('#upgrade-btn');
  if (btn.disabled) return;
  setBusy(btn, true, 'Starting checkout…');
  try {
    const data = await api('/api/billing/checkout', { method: 'POST' });
    if (data && data.url) {
      location.assign(data.url);
      return;
    }
    toast('Could not start checkout. Try again shortly.', 'error');
  } catch (error) {
    toast(error.message, 'error');
  }
  setBusy(btn, false);
});

$('#demo-upgrade-btn')?.addEventListener('click', async () => {
  const btn = $('#demo-upgrade-btn');
  setBusy(btn, true, 'Upgrading…');
  try {
    await api('/api/billing/demo-upgrade', { method: 'POST' });
    toast('Upgraded to Pro.');
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    setBusy(btn, false);
    toast(error.message, 'error');
  }
});
