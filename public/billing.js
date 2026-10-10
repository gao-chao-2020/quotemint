// Billing: Stripe checkout redirect, demo upgrade, and the post-checkout success banner.

import { $, api, errorText, setBusy, toast } from './common.js';

const S = window.__I18N__?.t || {};

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
      title.textContent = S['bill.banner.title'] || 'Welcome to Pro!';
      const body = document.createElement('p');
      body.textContent = S['bill.banner.body'] || 'Unlimited quotes, custom branding, and full analytics are now active.';
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
  setBusy(btn, true, S['bill.busy.checkout'] || 'Starting checkout…');
  try {
    const data = await api('/api/billing/checkout', { method: 'POST' });
    if (data && data.url) {
      location.assign(data.url);
      return;
    }
    toast(S['bill.checkout_failed'] || 'Could not start checkout. Try again shortly.', 'error');
  } catch (error) {
    toast(errorText(error), 'error');
  }
  setBusy(btn, false);
});

$('#demo-upgrade-btn')?.addEventListener('click', async () => {
  const btn = $('#demo-upgrade-btn');
  setBusy(btn, true, S['bill.busy.upgrade'] || 'Upgrading…');
  try {
    await api('/api/billing/demo-upgrade', { method: 'POST' });
    toast(S['bill.upgraded_toast'] || 'Upgraded to Pro.');
    setTimeout(() => location.reload(), 600);
  } catch (error) {
    setBusy(btn, false);
    toast(errorText(error), 'error');
  }
});
