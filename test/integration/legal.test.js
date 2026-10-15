import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, assertOk, boot, signup } from './helpers.js';

const PORT = 3241;
const SUPPORT_EMAIL = 'support@quotemint.dpdns.org';

let server;

const htmlLang = (html) => /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1];

before(async () => {
  server = await boot({
    port: PORT,
    env: {
      CREEM_API_KEY: 'creem_test_dummy',
      CREEM_PRODUCT_ID: 'prod_test',
      CREEM_API_BASE: 'http://localhost:3249'
    }
  });
});

after(async () => {
  await server?.close();
});

test('GET /privacy -> 200 public, EN default, support email present (§17)', async () => {
  const res = await api(server, 'GET', '/privacy');
  assert.equal(res.status, 200);
  assert.equal(htmlLang(res.text), 'en');
  assert.match(res.text, /Privacy Policy/);
  assert.ok(res.text.includes(SUPPORT_EMAIL), `support email missing on /privacy: ${res.text.slice(0, 400)}`);
});

test('GET /privacy with lang=zh -> Chinese content + support email', async () => {
  const res = await api(server, 'GET', '/privacy', { cookie: 'lang=zh' });
  assert.equal(res.status, 200);
  assert.equal(htmlLang(res.text), 'zh');
  assert.ok(res.text.includes('隐私政策'), 'zh privacy heading "隐私政策" not found');
  assert.ok(res.text.includes(SUPPORT_EMAIL), 'support email missing on zh /privacy');
});

test('GET /terms -> 200 public, EN default; lang=zh renders 服务条款', async () => {
  const en = await api(server, 'GET', '/terms');
  assert.equal(en.status, 200);
  assert.equal(htmlLang(en.text), 'en');
  assert.match(en.text, /terms of service/i);
  assert.ok(en.text.includes(SUPPORT_EMAIL), `support email missing on /terms: ${en.text.slice(0, 400)}`);

  const zh = await api(server, 'GET', '/terms', { cookie: 'lang=zh' });
  assert.equal(zh.status, 200);
  assert.equal(htmlLang(zh.text), 'zh');
  assert.ok(zh.text.includes('服务条款'), 'zh terms heading "服务条款" not found');
  assert.ok(zh.text.includes(SUPPORT_EMAIL), 'support email missing on zh /terms');
});

test('legal pages carry the language switcher (§16 nav on every page)', async () => {
  const en = await api(server, 'GET', '/privacy');
  assert.match(en.text, /\/lang\/zh\?next=/, 'EN /privacy must link to /lang/zh');
  const zh = await api(server, 'GET', '/terms', { cookie: 'lang=zh' });
  assert.match(zh.text, /\/lang\/en\?next=/, 'zh /terms must link to /lang/en');
});

test('landing footer links to /privacy, /terms and the support email (§17)', async () => {
  const res = await api(server, 'GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/privacy"/, 'footer must link /privacy');
  assert.match(res.text, /href="\/terms"/, 'footer must link /terms');
  assert.ok(res.text.includes(SUPPORT_EMAIL), 'footer must show the support email');
});

test('shared head carries the og share-card meta and upgraded twitter card', async () => {
  const res = await api(server, 'GET', '/');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('<meta property="og:image" content="https://quotemint.dpdns.org/og.png">'), 'og:image missing');
  assert.ok(res.text.includes('<meta property="og:image:width" content="1200">'), 'og:image:width missing');
  assert.ok(res.text.includes('<meta property="og:image:height" content="630">'), 'og:image:height missing');
  assert.ok(res.text.includes('<meta name="twitter:card" content="summary_large_image">'), 'twitter:card must be summary_large_image');
});

test('GET /og.png -> 200 image/png (share card asset is served)', async () => {
  const res = await api(server, 'GET', '/og.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(res.text.length > 1024, 'share card should be a real image, not an error stub');
});

test('app shell footer links to /privacy, /terms and the support email (§17 both shells)', async () => {
  const user = await signup(server, { name: 'Legal Footer' });
  const res = await api(server, 'GET', '/app', { cookie: user.cookie });
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/privacy"/, 'app shell footer must link /privacy');
  assert.match(res.text, /href="\/terms"/, 'app shell footer must link /terms');
  assert.ok(res.text.includes(SUPPORT_EMAIL), 'app shell footer must show the support email');
});

test('billing page names the active provider when CREEM env is set (§17)', async () => {
  const user = await signup(server, { name: 'Provider Line' });
  const res = await api(server, 'GET', '/app/billing', { cookie: user.cookie });
  assert.equal(res.status, 200);
  assert.match(res.text, /[Hh]andled by Creem/, 'billing page must show the Creem trust line');
});
