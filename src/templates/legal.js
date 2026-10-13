// Legal pages (GET /privacy, GET /terms). Static public pages on the marketing shell,
// bilingual via the §16 dictionary. No user input is interpolated anywhere.

import { esc, layout, SUPPORT_EMAIL } from './layout.js';
import { t } from './i18n.js';

const LAST_UPDATED = '2026-10-10';

const PAGE_SECTIONS = {
  privacy: ['collection', 'use', 'cookies', 'payments', 'analytics', 'retention'],
  terms: ['service', 'account', 'acceptable_use', 'billing', 'refunds', 'liability', 'law', 'changes'],
};

function contactParagraph(lang) {
  const text = t(lang, 'legal.contact.body', { email: SUPPORT_EMAIL });
  const [before, after = ''] = text.split(SUPPORT_EMAIL);
  return `<p class="legal-text">${esc(before)}<a href="mailto:${SUPPORT_EMAIL}">${esc(SUPPORT_EMAIL)}</a>${esc(after)}</p>`;
}

export function renderLegal({ page = 'privacy', lang = 'en', path = null } = {}) {
  const which = page === 'terms' ? 'terms' : 'privacy';
  const resolvedPath = path || `/${which}`;

  const sections = PAGE_SECTIONS[which]
    .map((id) => `<section class="legal-section">
<h2 class="legal-heading">${esc(t(lang, `legal.${which}.${id}.head`))}</h2>
<p class="legal-text">${esc(t(lang, `legal.${which}.${id}.body`, { email: SUPPORT_EMAIL }))}</p>
</section>`)
    .join('\n');

  const body = `
<div class="legal-wrap">
<div class="container container-narrow">
<header class="legal-head">
<h1 class="legal-title">${esc(t(lang, `legal.${which}.title`))}</h1>
<p class="legal-updated">${esc(t(lang, 'legal.last_updated', { date: LAST_UPDATED }))}</p>
</header>
<p class="legal-intro">${esc(t(lang, `legal.${which}.intro`))}</p>
${sections}
<section class="legal-section legal-contact">
<h2 class="legal-heading">${esc(t(lang, 'legal.contact.head'))}</h2>
${contactParagraph(lang)}
</section>
</div>
</div>`;

  return layout({
    lang,
    path: resolvedPath,
    title: t(lang, `legal.${which}.meta.title`),
    description: t(lang, `legal.${which}.meta.description`),
    body,
    nav: 'marketing',
    bodyClass: 'page-legal',
  });
}
