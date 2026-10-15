// Landing page (GET /). Marketing sections: hero, how it works, features, pricing, FAQ.
// All copy resolves through the §16 dictionary; EN values are the audited originals.

import { esc, icon, layout } from './layout.js';
import { t } from './i18n.js';

function heroMock(lang) {
  return `<div class="mock" aria-hidden="true">
<div class="mock-card">
<div class="mock-head">
<div class="mock-issuer"><span class="mock-logo"></span><span class="mock-issuer-name">${esc(t(lang, 'landing.mock.issuer'))}</span></div>
<span class="pill pill-sent">${esc(t(lang, 'status.sent'))}</span>
</div>
<div class="mock-title">${esc(t(lang, 'landing.mock.title'))}</div>
<div class="mock-client">${esc(t(lang, 'landing.mock.client'))}</div>
<div class="mock-items">
<div class="mock-row"><span class="mock-bar" style="width:72%"></span><span class="mock-amt">$2,400.00</span></div>
<div class="mock-row"><span class="mock-bar" style="width:48%"></span><span class="mock-amt">$1,250.00</span></div>
<div class="mock-row"><span class="mock-bar" style="width:60%"></span><span class="mock-amt">$1,200.00</span></div>
</div>
<div class="mock-total"><span>${esc(t(lang, 'landing.mock.total'))}</span><strong>$4,850.00</strong></div>
<div class="mock-actions"><span class="mock-btn">${esc(t(lang, 'landing.mock.accept'))}</span><span class="mock-btn mock-btn-ghost">${esc(t(lang, 'landing.mock.decline'))}</span></div>
<div class="mock-stamp">${esc(t(lang, 'landing.mock.stamp'))}</div>
</div>
<div class="mock-chip mock-chip-view">${icon('eye', 15)}<span>${esc(t(lang, 'landing.mock.viewed'))}</span></div>
<div class="mock-chip mock-chip-sign">${icon('check-circle', 15)}<span>${esc(t(lang, 'landing.mock.signed'))}</span></div>
</div>`;
}

function stepCard(number, title, iconName, body) {
  return `<li class="step">
<div class="step-top"><span class="step-num">${esc(number)}</span><span class="step-icon">${icon(iconName, 22)}</span></div>
<h3 class="step-title">${esc(title)}</h3>
<p class="step-body">${esc(body)}</p>
</li>`;
}

function featureCard(iconName, title, body, tag = '') {
  return `<li class="feature">
<span class="feature-icon">${icon(iconName, 21)}</span>
<h3 class="feature-title">${esc(title)}${tag ? ` <span class="pill pill-pro">${esc(tag)}</span>` : ''}</h3>
<p class="feature-body">${esc(body)}</p>
</li>`;
}

function checkItem(text) {
  return `<li class="check-item">${icon('check', 16)}<span>${esc(text)}</span></li>`;
}

function faqItem(question, answer, open = false) {
  return `<details class="faq-item"${open ? ' open' : ''}>
<summary class="faq-question">${esc(question)}</summary>
<p class="faq-answer">${esc(answer)}</p>
</details>`;
}

export function renderLanding({ lang = 'en', path = '/' } = {}) {
  const title = t(lang, 'landing.meta.title');
  const description = t(lang, 'landing.meta.description');
  const period = esc(t(lang, 'landing.pricing.period'));
  const proTag = t(lang, 'nav.plan.pro');

  const body = `
<section class="hero">
<div class="container hero-grid">
<div class="hero-copy">
<p class="eyebrow">${esc(t(lang, 'landing.hero.eyebrow'))}</p>
<h1 class="hero-title">${t(lang, 'landing.hero.title')}</h1>
<p class="hero-sub">${t(lang, 'landing.hero.sub')}</p>
<div class="hero-actions">
<a class="btn btn-primary btn-lg" href="/signup">${esc(t(lang, 'landing.hero.cta'))}</a>
<a class="btn btn-secondary btn-lg" href="#how">${esc(t(lang, 'landing.hero.cta_secondary'))}</a>
</div>
<p class="hero-note">${t(lang, 'landing.hero.note')}</p>
</div>
${heroMock(lang)}
</div>
</section>

<section class="section" id="how">
<div class="container">
<div class="section-head">
<h2 class="section-title">${esc(t(lang, 'landing.how.title'))}</h2>
<p class="section-sub">${esc(t(lang, 'landing.how.sub'))}</p>
</div>
<ol class="steps">
${stepCard('1', t(lang, 'landing.step1.title'), 'file', t(lang, 'landing.step1.body'))}
${stepCard('2', t(lang, 'landing.step2.title'), 'link', t(lang, 'landing.step2.body'))}
${stepCard('3', t(lang, 'landing.step3.title'), 'check-circle', t(lang, 'landing.step3.body'))}
</ol>
</div>
</section>

<section class="section section-soft" id="features">
<div class="container">
<div class="section-head">
<h2 class="section-title">${esc(t(lang, 'landing.features.title'))}</h2>
<p class="section-sub">${esc(t(lang, 'landing.features.sub'))}</p>
</div>
<ul class="features">
${featureCard('eye', t(lang, 'landing.feature1.title'), t(lang, 'landing.feature1.body'))}
${featureCard('pen', t(lang, 'landing.feature2.title'), t(lang, 'landing.feature2.body'))}
${featureCard('printer', t(lang, 'landing.feature3.title'), t(lang, 'landing.feature3.body'))}
${featureCard('palette', t(lang, 'landing.feature4.title'), t(lang, 'landing.feature4.body'), proTag)}
${featureCard('link', t(lang, 'landing.feature5.title'), t(lang, 'landing.feature5.body'))}
${featureCard('chart', t(lang, 'landing.feature6.title'), t(lang, 'landing.feature6.body'), proTag)}
</ul>
</div>
</section>

<section class="section" id="pricing">
<div class="container">
<div class="section-head">
<h2 class="section-title">${esc(t(lang, 'landing.pricing.title'))}</h2>
<p class="section-sub">${esc(t(lang, 'landing.pricing.sub'))}</p>
</div>
<div class="pricing">
<article class="price-card">
<h3 class="price-name">${esc(t(lang, 'landing.pricing.free.name'))}</h3>
<p class="price-amount"><span class="price-value">$0</span><span class="price-period">${period}</span></p>
<p class="price-desc">${esc(t(lang, 'landing.pricing.free.desc'))}</p>
<ul class="check-list">
${checkItem(t(lang, 'landing.pricing.check.3quotes'))}
${checkItem(t(lang, 'landing.pricing.check.links'))}
${checkItem(t(lang, 'landing.pricing.check.esign'))}
${checkItem(t(lang, 'landing.pricing.check.views'))}
${checkItem(t(lang, 'landing.pricing.check.badge'))}
</ul>
<a class="btn btn-secondary btn-block" href="/signup">${esc(t(lang, 'landing.pricing.free.cta'))}</a>
</article>
<article class="price-card price-card-featured">
<p class="price-badge">${esc(t(lang, 'landing.pricing.pro.badge'))}</p>
<h3 class="price-name">${esc(t(lang, 'landing.pricing.pro.name'))}</h3>
<p class="price-amount"><span class="price-value">$9</span><span class="price-period">${period}</span></p>
<p class="price-desc">${esc(t(lang, 'landing.pricing.pro.desc'))}</p>
<ul class="check-list check-list-strong">
${checkItem(t(lang, 'landing.pricing.check.unlimited'))}
${checkItem(t(lang, 'landing.pricing.check.analytics'))}
${checkItem(t(lang, 'landing.pricing.check.branding'))}
${checkItem(t(lang, 'landing.pricing.check.nobadge'))}
${checkItem(t(lang, 'landing.pricing.check.everything'))}
</ul>
<a class="btn btn-primary btn-block" href="/signup">${esc(t(lang, 'landing.pricing.pro.cta_choose'))}</a>
<p class="price-alt">${t(lang, 'landing.pricing.pro.alt')}</p>
</article>
</div>
<p class="pricing-note">${esc(t(lang, 'landing.pricing.note'))}</p>
</div>
</section>

<section class="section section-soft" id="faq">
<div class="container container-narrow">
<div class="section-head">
<h2 class="section-title">${esc(t(lang, 'landing.faq.title'))}</h2>
</div>
<div class="faq">
${faqItem(t(lang, 'landing.faq.q1'), t(lang, 'landing.faq.a1'), true)}
${faqItem(t(lang, 'landing.faq.q2'), t(lang, 'landing.faq.a2'))}
${faqItem(t(lang, 'landing.faq.q3'), t(lang, 'landing.faq.a3'))}
${faqItem(t(lang, 'landing.faq.q4'), t(lang, 'landing.faq.a4'))}
${faqItem(t(lang, 'landing.faq.q5'), t(lang, 'landing.faq.a5'))}
${faqItem(t(lang, 'landing.faq.q6'), t(lang, 'landing.faq.a6'))}
</div>
</div>
</section>

<section class="cta-band">
<div class="container cta-band-inner">
<h2 class="cta-title">${t(lang, 'landing.cta.title')}</h2>
<p class="cta-sub">${esc(t(lang, 'landing.cta.sub'))}</p>
<a class="btn btn-primary btn-lg" href="/signup">${esc(t(lang, 'landing.cta.button'))}</a>
</div>
</section>`;

  return layout({
    lang,
    path,
    title,
    description,
    body,
    nav: 'marketing',
    bodyClass: 'page-landing',
    scripts: ['/landing.js'],
  });
}
