// Landing page (GET /). Marketing sections: hero, how it works, features, pricing, FAQ.

import { esc, icon, layout } from './layout.js';

function heroMock() {
  return `<div class="mock" aria-hidden="true">
<div class="mock-card">
<div class="mock-head">
<div class="mock-issuer"><span class="mock-logo"></span><span class="mock-issuer-name">Northwind Studio</span></div>
<span class="pill pill-sent">Sent</span>
</div>
<div class="mock-title">Brand identity redesign</div>
<div class="mock-client">Prepared for Acme Co.</div>
<div class="mock-items">
<div class="mock-row"><span class="mock-bar" style="width:72%"></span><span class="mock-amt">$2,400.00</span></div>
<div class="mock-row"><span class="mock-bar" style="width:48%"></span><span class="mock-amt">$1,250.00</span></div>
<div class="mock-row"><span class="mock-bar" style="width:60%"></span><span class="mock-amt">$1,200.00</span></div>
</div>
<div class="mock-total"><span>Total</span><strong>$4,850.00</strong></div>
<div class="mock-actions"><span class="mock-btn">Accept quote</span><span class="mock-btn mock-btn-ghost">Decline</span></div>
<div class="mock-stamp">ACCEPTED</div>
</div>
<div class="mock-chip mock-chip-view">${icon('eye', 15)}<span>Viewed 2 minutes ago</span></div>
<div class="mock-chip mock-chip-sign">${icon('check-circle', 15)}<span>Signed by Jordan Lee</span></div>
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

export function renderLanding() {
  const title = 'QuoteMint — quotes that get accepted, faster';
  const description = 'Turn your freelance quotes into polished links clients can view and accept with a click. Track opens, collect e-sign acceptance, and win work faster. Free for 3 quotes a month.';

  const body = `
<section class="hero">
<div class="container hero-grid">
<div class="hero-copy">
<p class="eyebrow">Quote-to-cash for freelancers</p>
<h1 class="hero-title">Quotes that get accepted, <span class="accent">faster.</span></h1>
<p class="hero-sub">QuoteMint turns your quote into a polished link your client can view and accept with one click. Know the moment it is opened, collect a name-signed acceptance, and stop chasing &ldquo;did you get my email?&rdquo;</p>
<div class="hero-actions">
<a class="btn btn-primary btn-lg" href="/signup">Start free — 3 quotes a month</a>
<a class="btn btn-secondary btn-lg" href="#how">See how it works</a>
</div>
<p class="hero-note">Free plan included · Pro from $9/mo · No credit card required</p>
</div>
${heroMock()}
</div>
</section>

<section class="section" id="how">
<div class="container">
<div class="section-head">
<h2 class="section-title">From quote to yes in three steps</h2>
<p class="section-sub">No client accounts, no PDF attachments, no back-and-forth.</p>
</div>
<ol class="steps">
${stepCard('1', 'Build your quote', 'file', 'Add line items, quantities, discount, and tax. Totals update live — no spreadsheet detours.')}
${stepCard('2', 'Send a link', 'link', 'Share one link by email or chat. Your client opens it in any browser — nothing to install or sign up for.')}
${stepCard('3', 'Get a yes', 'check-circle', 'Your client reviews and accepts with their name. You see opens and acceptance the moment they happen.')}
</ol>
</div>
</section>

<section class="section section-soft" id="features">
<div class="container">
<div class="section-head">
<h2 class="section-title">Everything a quote needs to close</h2>
<p class="section-sub">Built for the quiet admin work that wins freelance deals.</p>
</div>
<ul class="features">
${featureCard('eye', 'Open tracking', 'Know the exact moment your quote is viewed, and follow up at the right time instead of guessing.')}
${featureCard('pen', 'One-click acceptance', 'Clients accept with their full name and a timestamped e-signature record. No printing, no scanning.')}
${featureCard('printer', 'Print-perfect PDFs', 'Every quote is laid out for clean A4 printing. Save as PDF straight from the browser.')}
${featureCard('palette', 'Your brand on every quote', 'Your company name, wordmark, and brand color on every page you send.', 'Pro')}
${featureCard('link', 'Links that never expire', 'Share a quote link anytime — it always shows the latest state: pending, accepted, or declined.')}
${featureCard('chart', 'Full view analytics', 'See every open with its timestamp, so you know which quotes are warm.', 'Pro')}
</ul>
</div>
</section>

<section class="section" id="pricing">
<div class="container">
<div class="section-head">
<h2 class="section-title">Simple pricing</h2>
<p class="section-sub">Start free. Upgrade when quotes are flowing.</p>
</div>
<div class="pricing">
<article class="price-card">
<h3 class="price-name">Free</h3>
<p class="price-amount"><span class="price-value">$0</span><span class="price-period">/month</span></p>
<p class="price-desc">For trying QuoteMint on real work.</p>
<ul class="check-list">
${checkItem('3 quotes per month')}
${checkItem('Shareable quote links')}
${checkItem('E-sign acceptance with timestamp')}
${checkItem('View counts on your dashboard')}
${checkItem('QuoteMint badge on public quotes')}
</ul>
<a class="btn btn-secondary btn-block" href="/signup">Start free</a>
</article>
<article class="price-card price-card-featured">
<p class="price-badge">Most popular with working freelancers</p>
<h3 class="price-name">Pro</h3>
<p class="price-amount"><span class="price-value">$9</span><span class="price-period">/month</span></p>
<p class="price-desc">For freelancers who quote every week.</p>
<ul class="check-list check-list-strong">
${checkItem('Unlimited quotes')}
${checkItem('Full view analytics with timestamps')}
${checkItem('Custom branding: company, wordmark, color')}
${checkItem('No QuoteMint badge')}
${checkItem('Everything in Free')}
</ul>
<a class="btn btn-primary btn-block" href="/signup">Get started</a>
<p class="price-alt">or $90/year — two months free</p>
</article>
</div>
<p class="pricing-note">Prices in USD. Cancel anytime.</p>
</div>
</section>

<section class="section section-soft" id="faq">
<div class="container container-narrow">
<div class="section-head">
<h2 class="section-title">Questions, answered</h2>
</div>
<div class="faq">
${faqItem('How do clients accept a quote?', 'They open the link, review the line items, and click Accept. They type their full name and agree to your terms — that acceptance is recorded with a timestamp and shown as a stamp on the quote.', true)}
${faqItem('Do my clients need an account?', 'No. The quote link opens in any browser. Your client can review and accept without installing anything or creating a login.')}
${faqItem('What happens when I hit the free limit?', 'Quotes you already sent stay live and your data stays intact. You just cannot create new quotes until the month resets or you upgrade to Pro for unlimited quotes.')}
${faqItem('Can I put my own branding on quotes?', 'Yes, on the Pro plan. Set your company name, a wordmark, and your brand color, and every quote page picks them up. The QuoteMint badge is also removed.')}
${faqItem('Do quote links expire?', 'No. You can add a valid-until date as helpful context for your client, but the link itself keeps working.')}
${faqItem('Can I export a quote as PDF?', 'Yes. Open the quote and use your browser\'s Print dialog and choose Save as PDF — the layout is designed for clean A4 printing.')}
</div>
</div>
</section>

<section class="cta-band">
<div class="container cta-band-inner">
<h2 class="cta-title">Send your next quote with QuoteMint</h2>
<p class="cta-sub">It takes about a minute — and your client will thank you for it.</p>
<a class="btn btn-primary btn-lg" href="/signup">Get started free</a>
</div>
</section>`;

  return layout({
    title,
    description,
    body,
    nav: 'marketing',
    bodyClass: 'page-landing',
    scripts: ['/landing.js'],
  });
}
