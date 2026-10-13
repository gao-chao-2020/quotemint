// Billing page (GET /app/billing). Plan card, Pro benefits, checkout / demo upgrade,
// manual Alipay upgrade card (rendered when public/alipay-qr.png exists).

import { esc, formatDate, icon, layout, SUPPORT_EMAIL } from './layout.js';
import { isPro } from '../lib/gating.js';
import { t } from './i18n.js';

function checkItem(text) {
  return `<li class="check-item">${icon('check', 16)}<span>${esc(text)}</span></li>`;
}

function providerLabel(name) {
  const value = String(name ?? '').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

export function renderBilling({ user, billingEnabled = false, demoMode = false, upgraded = false, providerName = null, alipayQr = false, lang = 'en', path = '/app/billing' } = {}) {
  const pro = isPro(user);
  const period = esc(t(lang, 'bill.period'));
  const provider = providerLabel(providerName);
  const footLine = provider
    ? t(lang, 'bill.foot.provider', { provider })
    : t(lang, 'bill.upgrade.unavailable');

  const upgradedBanner = upgraded
    ? `<div class="banner banner-success" id="upgraded-banner" role="status">${icon('check-circle', 18)}<div><strong>${esc(t(lang, 'bill.banner.title'))}</strong><p>${esc(t(lang, 'bill.banner.body'))}</p></div></div>`
    : '';

  const planCard = pro
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

  const upgradeCard = pro
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

  const alipayCard = !pro && alipayQr
    ? `<article class="plan-card plan-card-alipay">
<div class="plan-head">
<div><p class="plan-eyebrow">${esc(t(lang, 'bill.alipay.eyebrow'))}</p><h2 class="plan-name">${esc(t(lang, 'bill.alipay.title'))}</h2></div>
</div>
<p class="plan-price">${esc(t(lang, 'bill.alipay.price'))}<span class="price-period">${esc(t(lang, 'bill.alipay.period'))}</span></p>
<div class="alipay-body">
<figure class="alipay-qr-wrap">
<img class="alipay-qr" src="/alipay-qr.png" alt="${esc(t(lang, 'bill.alipay.qr_alt'))}">
<figcaption class="alipay-caption">${esc(t(lang, 'bill.alipay.caption'))}</figcaption>
<p class="alipay-manual">${esc(t(lang, 'bill.alipay.manual_note'))}</p>
</figure>
<ol class="alipay-steps">
<li>${esc(t(lang, 'bill.alipay.step1'))}</li>
<li>${esc(t(lang, 'bill.alipay.step2', { email: SUPPORT_EMAIL }))}</li>
<li>${esc(t(lang, 'bill.alipay.step3'))}</li>
</ol>
</div>
</article>`
    : '';

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
${upgradeCard}${alipayCard ? `\n${alipayCard}` : ''}
</div>
<p class="billing-foot muted">${esc(footLine)}</p>
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
