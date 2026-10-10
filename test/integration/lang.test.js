import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertOk, boot, createQuote, sendQuote, signup } from './helpers.js';

const PORT = 3227;

// ---------------------------------------------------------------------------
// Language probes (src/templates dicts — plain text nodes, no interpolation).
const ZH = {
  landing: '从报价到收款，为自由职业者打造', // dict-landing: landing.hero.eyebrow
  acceptBtn: '接受报价',                    // dict-quote: quote.accept.button (#accept-btn)
};
// EN probes are stable: EN is the default language and the retrofit keeps it.
const EN = {
  landing: 'Know the moment', // hero copy on the landing page
  acceptBtn: 'Accept quote',  // #accept-btn on the public quote page
};

const htmlLang = (html) => /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1];

let server;

before(async () => {
  server = await boot({ port: PORT });
});

after(async () => {
  await server?.close();
});

test('/lang/zh?next=/app -> 302 /app + lang cookie flags (§16)', async () => {
  const res = await api(server, 'GET', '/lang/zh?next=/app');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/app');
  const cookie = res.setCookie;
  assert.match(cookie, /lang=zh/, `expected lang=zh cookie, got: ${cookie}`);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=31536000/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/HttpOnly/.test(cookie), 'lang cookie must NOT be HttpOnly (§16)');
  assert.ok(!/Secure/.test(cookie), 'no Secure flag when BASE_URL is http');
});

test('/lang/en?next=/login sets lang=en, and deep paths are allowed', async () => {
  const login = await api(server, 'GET', '/lang/en?next=/login');
  assert.equal(login.status, 302);
  assert.equal(login.location, '/login');
  assert.match(login.setCookie, /lang=en/);

  const deep = await api(server, 'GET', '/lang/zh?next=/app/quotes/new');
  assert.equal(deep.status, 302);
  assert.equal(deep.location, '/app/quotes/new');
});

test('open-redirect guard: bad next values all fall back to / (§16)', async () => {
  const badNexts = [
    'https://evil.com',
    '//evil.com',
    '\\evil.com',
    '\\\\evil.com',
    '/\\evil.com'
  ];
  for (const next of badNexts) {
    const res = await api(server, 'GET', `/lang/en?next=${encodeURIComponent(next)}`);
    assert.equal(res.status, 302, `next=${next}`);
    assert.equal(res.location, '/', `next=${next} must be rejected -> /`);
  }
  // Raw (unencoded) protocol-relative form must also be rejected.
  const raw = await api(server, 'GET', '/lang/en?next=//evil.com');
  assert.equal(raw.status, 302);
  assert.equal(raw.location, '/');
  // Cookie is still set on a rejected next: the guard only rewrites the target.
  assert.match(raw.setCookie, /lang=en/);
});

test('/lang/zh without next -> 302 / but cookie still set', async () => {
  const res = await api(server, 'GET', '/lang/zh');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/');
  assert.match(res.setCookie, /lang=zh/);
});

test('/lang/xx -> 302 / and no lang cookie set', async () => {
  const res = await api(server, 'GET', '/lang/xx?next=/app');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/');
  assert.ok(!res.setCookie.includes('lang='), `no lang cookie expected, got: ${res.setCookie}`);
});

test('landing renders zh from the lang cookie (<html lang="zh">, §16)', async () => {
  const res = await api(server, 'GET', '/', { cookie: 'lang=zh' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(ZH.landing), `zh landing probe "${ZH.landing}" not found`);
  assert.equal(htmlLang(res.text), 'zh');
});

test('Accept-Language fallback and resolution order (§16)', async () => {
  const zhHeader = await api(server, 'GET', '/', { headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  assert.ok(zhHeader.text.includes(ZH.landing), 'zh-CN Accept-Language must render zh');
  assert.equal(htmlLang(zhHeader.text), 'zh');

  const enHeader = await api(server, 'GET', '/', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  assert.ok(enHeader.text.includes(EN.landing), 'en-US Accept-Language must render en');
  assert.equal(htmlLang(enHeader.text), 'en');

  const noHeader = await api(server, 'GET', '/');
  assert.ok(noHeader.text.includes(EN.landing), 'no signals must default to en');

  // Cookie outranks Accept-Language.
  const cookieWins = await api(server, 'GET', '/', { cookie: 'lang=en', headers: { 'Accept-Language': 'zh-CN' } });
  assert.ok(cookieWins.text.includes(EN.landing), 'lang cookie must outrank Accept-Language');
  assert.equal(htmlLang(cookieWins.text), 'en');

  // Cookie with an unknown value is ignored, falls through to Accept-Language.
  const invalidCookie = await api(server, 'GET', '/', { cookie: 'lang=fr', headers: { 'Accept-Language': 'zh-CN' } });
  assert.ok(invalidCookie.text.includes(ZH.landing), 'lang=fr cookie must fall through to Accept-Language');
});

test('language switcher: EN pages link to /lang/zh?next=..., zh pages to /lang/en (§16)', async () => {
  const en = await api(server, 'GET', '/');
  assert.match(en.text, /href="\/lang\/zh\?next=(%2F|\/)[^"]*"/, 'missing /lang/zh switcher link with next param');
  assert.ok(en.text.includes('中文'), 'missing 中文 label on EN page');

  const zh = await api(server, 'GET', '/', { cookie: 'lang=zh' });
  assert.match(zh.text, /href="\/lang\/en\?next=(%2F|\/)[^"]*"/, 'missing /lang/en switcher link with next param');
});

test('public quote page follows the viewer language (lang=zh cookie)', async () => {
  const account = await signup(server, { name: 'I18N Owner' });
  const created = assertOk(await createQuote(server, account.cookie, { title: 'Localized quote' }), 201);
  assertOk(await sendQuote(server, account.cookie, created.quote.id));
  const token = created.quote.public_token;

  const zh = await api(server, 'GET', `/q/${token}`, { cookie: 'lang=zh' });
  assert.equal(zh.status, 200);
  assert.ok(zh.text.includes(ZH.acceptBtn), `zh accept-button probe "${ZH.acceptBtn}" not found`);
  assert.equal(htmlLang(zh.text), 'zh');

  const en = await api(server, 'GET', `/q/${token}`);
  assert.equal(en.status, 200);
  assert.ok(en.text.includes(EN.acceptBtn), 'en accept-button probe not found');
  assert.equal(htmlLang(en.text), 'en');

  // Date localization (#11): zh pages render zh-CN dates; EN stays en-US.
  const zhDash = await api(server, 'GET', '/app', { cookie: `lang=zh; ${account.cookie}` });
  assert.match(zhDash.text, /创建于 \d{4}年\d{1,2}月\d{1,2}日/, 'zh dashboard must render zh-CN dates');
  const enDash = await api(server, 'GET', '/app', { cookie: account.cookie });
  assert.match(enDash.text, /Created [A-Z][a-z]{2} \d{1,2}, \d{4}/, 'en dashboard must keep en-US dates');
});
