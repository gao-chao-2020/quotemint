// Billing page (GET /app/billing). Plan card, Pro benefits, checkout / demo upgrade.

import { esc, formatDate, icon, layout } from './layout.js';

function checkItem(text) {
  return `<li class="check-item">${icon('check', 16)}<span>${esc(text)}</span></li>`;
}

export function renderBilling({ user, billingEnabled = false, demoMode = false, upgraded = false } = {}) {
  const isPro = user?.plan === 'pro';
  const renews = user?.plan_renews_at ? esc(formatDate(user.plan_renews_at)) : '';

  const upgradedBanner = upgraded
    ? `<div class="banner banner-success" id="upgraded-banner" role="status">${icon('check-circle', 18)}<div><strong>Welcome to Pro!</strong><p>Unlimited quotes, custom branding, and full analytics are now active.</p></div></div>`
    : '';

  const planCard = isPro
    ? `<article class="plan-card plan-card-pro">
<div class="plan-head">
<div><p class="plan-eyebrow">Current plan</p><h2 class="plan-name">Pro</h2></div>
<span class="pill pill-pro">Active</span>
</div>
<p class="plan-price">$9<span class="price-period">/month</span></p>
${renews ? `<p class="plan-note">Renews on ${renews}</p>` : ''}
<ul class="check-list check-list-strong">
${checkItem('Unlimited quotes')}
${checkItem('Full view analytics with timestamps')}
${checkItem('Custom branding: company, wordmark, color')}
${checkItem('No QuoteMint badge on public quotes')}
</ul>
</article>`
    : `<article class="plan-card">
<div class="plan-head">
<div><p class="plan-eyebrow">Current plan</p><h2 class="plan-name">Free</h2></div>
<span class="pill pill-free">Active</span>
</div>
<p class="plan-price">$0<span class="price-period">/month</span></p>
<ul class="check-list">
${checkItem('3 quotes per month')}
${checkItem('Shareable quote links')}
${checkItem('E-sign acceptance with timestamp')}
${checkItem('View counts on your dashboard')}
</ul>
</article>`;

  const upgradeCard = isPro
    ? `<article class="plan-card plan-card-upgrade">
<div class="plan-head">
<div><p class="plan-eyebrow">Pro plan</p><h2 class="plan-name">You are on Pro</h2></div>
</div>
<p class="plan-note">Thanks for supporting QuoteMint. Your plan renews automatically.</p>
<ul class="check-list check-list-strong">
${checkItem('Unlimited quotes')}
${checkItem('Full view analytics')}
${checkItem('Custom branding')}
${checkItem('No QuoteMint badge')}
</ul>
</article>`
    : `<article class="plan-card plan-card-upgrade">
<div class="plan-head">
<div><p class="plan-eyebrow">Upgrade</p><h2 class="plan-name">Pro</h2></div>
<span class="pill pill-pro">Recommended</span>
</div>
<p class="plan-price">$9<span class="price-period">/month</span></p>
<ul class="check-list check-list-strong">
${checkItem('Unlimited quotes')}
${checkItem('Full view analytics with timestamps')}
${checkItem('Custom branding: company, wordmark, color')}
${checkItem('No QuoteMint badge on public quotes')}
</ul>
${billingEnabled
      ? `<button type="button" class="btn btn-primary btn-block btn-lg" id="upgrade-btn">Upgrade to Pro</button>`
      : `<button type="button" class="btn btn-primary btn-block btn-lg" id="upgrade-btn" disabled aria-disabled="true">Upgrade to Pro</button>
<p class="plan-note plan-note-warn">${icon('alert', 15)} Billing is not configured yet (Stripe keys missing).</p>`}
${demoMode ? `<button type="button" class="btn btn-secondary btn-block" id="demo-upgrade-btn">Demo upgrade (dev only)</button>` : ''}
</article>`;

  const body = `
<div class="container app-main">
<div class="page-head">
<div>
<h1 class="page-title">Billing &amp; plan</h1>
<p class="page-sub">Manage your QuoteMint subscription.</p>
</div>
</div>
${upgradedBanner}
<div class="plans">
${planCard}
${upgradeCard}
</div>
<p class="billing-foot muted">Payments are handled by Stripe. Cancel anytime — your quotes stay live.</p>
</div>`;

  return layout({
    title: 'Billing — QuoteMint',
    description: 'Manage your QuoteMint plan.',
    body,
    nav: 'app',
    active: 'billing',
    user,
    bodyClass: 'page-app',
    noindex: true,
    scripts: ['/billing.js'],
  });
}
