// i18n core (contract §16): t(lang, key, vars?) + LANGS + the client subset for window.__I18N__.
// Unknown language falls back to EN; unknown key returns the key itself. Never throws.

import dictCommon from './dict-common.js';
import dictLayout from './dict-layout.js';
import dictLanding from './dict-landing.js';
import dictAuth from './dict-auth.js';
import dictDashboard from './dict-dashboard.js';
import dictEditor from './dict-editor.js';
import dictBilling from './dict-billing.js';
import dictQuote from './dict-quote.js';
import dictLegal from './dict-legal.js';
import dictAdmin from './dict-admin.js';

export const LANGS = ['en', 'zh'];

const PARTS = [dictCommon, dictLayout, dictLanding, dictAuth, dictDashboard, dictEditor, dictBilling, dictQuote, dictLegal, dictAdmin];

const DICTS = { en: {}, zh: {} };
for (const part of PARTS) {
  Object.assign(DICTS.en, part.en);
  Object.assign(DICTS.zh, part.zh);
}

export function normalizeLang(lang) {
  return LANGS.includes(lang) ? lang : 'en';
}

export function t(lang, key, vars) {
  const dict = DICTS[normalizeLang(lang)];
  let value = dict[key];
  if (typeof value !== 'string') value = DICTS.en[key];
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    const v = vars[name];
    return v === undefined || v === null ? match : String(v);
  });
}

// Keys read by public/*.js. Every errcode.* is included automatically so client code can
// resolve `S['errcode.<code>']` for any API error code without touching this list.
const CLIENT_KEYS = [
  'common.working',
  'toast.link_copied',
  'dash.copy_failed',
  'dash.confirm_delete',
  'dash.deleted_flash',
  'dash.not_deletable',
  'auth.err.enter_password',
  'auth.err.password_mismatch',
  'auth.err.rate_limited',
  'auth.forgot.success',
  'auth.reset.flash',
  'auth.busy.signup',
  'auth.busy.login',
  'auth.busy.forgot',
  'auth.busy.reset',
  'ed.err.title_required',
  'ed.err.title_long',
  'ed.err.client_required',
  'ed.err.client_long',
  'ed.err.email_invalid',
  'ed.err.line_desc',
  'ed.err.line_qty_pos',
  'ed.err.line_qty_max',
  'ed.err.line_price',
  'ed.err.line_price_max',
  'ed.err.items_min',
  'ed.err.items_max',
  'ed.err.discount_range',
  'ed.err.tax_range',
  'ed.item.aria_desc',
  'ed.item.aria_qty',
  'ed.item.aria_price',
  'ed.item.aria_remove',
  'ed.busy.save',
  'ed.busy.send',
  'ed.toast.saved',
  'ed.flash.saved',
  'ed.flash.sent',
  'ed.toast.no_link',
  'ed.copy_failed',
  'bill.busy.checkout',
  'bill.checkout_failed',
  'bill.busy.upgrade',
  'bill.upgraded_toast',
  'bill.banner.title',
  'bill.banner.body',
  'qp.err.invalid_name',
  'qp.err.not_agreed',
  'qp.err.invalid_reason',
  'qp.err.rate_limited',
  'qp.err.not_found',
  'qp.already_answered',
  'qp.err.name_required',
  'qp.busy.accept',
  'qp.busy.decline',
  'qp.flash.accepted',
  'qp.flash.declined',
  'admin.login.busy',
  'admin.confirm_revoke',
  'admin.busy.grant',
  'admin.busy.revoke',
];

export function clientStrings(lang) {
  const lg = normalizeLang(lang);
  const out = {};
  for (const key of CLIENT_KEYS) out[key] = t(lg, key);
  for (const key of Object.keys(DICTS.en)) {
    if (key.startsWith('errcode.')) out[key] = t(lg, key);
  }
  return out;
}
