// Billing page (GET /app/billing). Plan card, Pro benefits, checkout / demo upgrade.

import { esc, formatDate, icon, layout } from './layout.js';
import { t } from './i18n.js';

function checkItem(text) {
  return `<li class="check-item">${icon('check', 16)}<span>${esc(text)}</span></li>`;
}

export function renderBilling({ user, billingEnabled = false, demoMode = false, upgraded = false, lang = 'en', path = '/app/billing' } = {}) {
  const isPro = user?.plan === 'pro';
  const period = esc(t(lang, 'bill.period'));

  const upgradedBanner = upgraded
    ? `<div class="banner banner-success" id="upgraded-banner" role="status">${icon('check-circle', 18)}<div><strong>${esc(t(lang, 'bill.banner.title'))}</strong><p>${esc(t(lang, 'bill.banner.body'))}</p></div></div>`
    : '';

  const planCard = isPro
    ? `<article class="plan-card plan-card-pro">
<div class="plan-head">
<div><p class="plan-eyebrow">${esc(t(lang, 'bill.current_plan'))}</p><h2 class="plan-name">${esc(t(lang, 'bill.plan.pro'))}</h2></div>
<span class="pill pill-pro">${esc(t(lang, 'bill.active'))}</span>
</div>
<p class="plan-price">$9<span class="price-period">${period}</span></p>
${user?.plan_renews_at ? `<p class="plan-note">${esc(t(lang, 'bill.renews', { date: formatDate(user.plan_renews_at, lang) }))}</p>` : ''}
<ul class="check-list check-list-strong">
${checkItem(t(lang, 'bill.check.unlimited'))}
${checkItem(t(lang, 'bill.check.analytics'))}
${checkItem(t(lang, 'bill.check.branding'))}
${checkItem(t(lang, 'bill.check.nobadge'))}
</ul>
</article>`
    : `<article class="plan-card">
<div class="plan-head">
<div><p class="plan-eyebrow">${esc(t(lang, 'bill.current_plan'))}</p><h2 class="plan-name">${esc(t(lang, 'bill.plan.free'))}</h2></div>
<span class="pill pill-free">${esc(t(lang, 'bill.active'))}</span>
</div>
<p class="plan-price">$0<span class="price-period">${period}</span></p>
<ul class="check-list">
${checkItem(t(lang, 'bill.check.3quotes'))}
${checkItem(t(lang, 'bill.check.links'))}
${checkItem(t(lang, 'bill.check.esign'))}
${checkItem(t(lang, 'bill.check.views'))}
${checkItem(t(lang, 'bill.check.badge'))}
</ul>
</article>`;

  const upgradeCard = isPro
    ? `<article class="plan-card plan-card-upgrade">
<div class="plan-head">
<div><p class="plan-eyebrow">${esc(t(lang, 'bill.upgrade.eyebrow'))}</p><h2 class="plan-name">${esc(t(lang, 'bill.upgrade.on_pro'))}</h2></div>
</div>
<p class="plan-note">${esc(t(lang, 'bill.upgrade.thanks'))}</p>
<ul class="check-list check-list-strong">
${checkItem(t(lang, 'bill.check.unlimited'))}
${checkItem(t(lang, 'bill.check.analytics_short'))}
${checkItem(t(lang, 'bill.check.branding_short'))}
${checkItem(t(lang, 'bill.check.nobadge_short'))}
</ul>
</article>`
    : `<article class="plan-card plan-card-upgrade">
<div class="plan-head">
<div><p class="plan-eyebrow">${esc(t(lang, 'bill.upgrade.title'))}</p><h2 class="plan-name">${esc(t(lang, 'bill.plan.pro'))}</h2></div>
<span class="pill pill-pro">${esc(t(lang, 'bill.recommended'))}</span>
</div>
<p class="plan-price">$9<span class="price-period">${period}</span></p>
<ul class="check-list check-list-strong">
${checkItem(t(lang, 'bill.check.unlimited'))}
${checkItem(t(lang, 'bill.check.analytics'))}
${checkItem(t(lang, 'bill.check.branding'))}
${checkItem(t(lang, 'bill.check.nobadge'))}
</ul>
${billingEnabled
      ? `<button type="button" class="btn btn-primary btn-block btn-lg" id="upgrade-btn">${esc(t(lang, 'bill.upgrade.button'))}</button>`
      : `<button type="button" class="btn btn-primary btn-block btn-lg" id="upgrade-btn" disabled aria-disabled="true">${esc(t(lang, 'bill.upgrade.button'))}</button>
<p class="plan-note plan-note-warn">${icon('alert', 15)} ${esc(t(lang, 'bill.upgrade.unavailable'))}</p>`}
${demoMode ? `<button type="button" class="btn btn-secondary btn-block" id="demo-upgrade-btn">${esc(t(lang, 'bill.demo'))}</button>` : ''}
</article>`;

  const body = `
<div class="container app-main">
<div class="page-head">
<div>
<h1 class="page-title">${t(lang, 'bill.head.title')}</h1>
<p class="page-sub">${esc(t(lang, 'bill.head.sub'))}</p>
</div>
</div>
${upgradedBanner}
<div class="plans">
${planCard}
${upgradeCard}
</div>
<p class="billing-foot muted">${esc(t(lang, 'bill.foot'))}</p>
</div>`;

  return layout({
    lang,
    path,
    title: t(lang, 'bill.meta.title'),
    description: t(lang, 'bill.meta.description'),
    body,
    nav: 'app',
    active: 'billing',
    user,
    bodyClass: 'page-app',
    noindex: true,
    scripts: ['/billing.js'],
  });
}
