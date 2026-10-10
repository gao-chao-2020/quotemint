import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLang, safeNext } from '../../src/lib/lang.js';

function req(headers = {}) {
  return { headers };
}

test('resolveLang prefers a valid lang cookie over Accept-Language', () => {
  assert.equal(resolveLang(req({ cookie: 'lang=zh', 'accept-language': 'en-US' })), 'zh');
  assert.equal(resolveLang(req({ cookie: 'lang=en', 'accept-language': 'zh-CN' })), 'en');
  assert.equal(resolveLang(req({ cookie: 'qm_session=abc123; lang=zh' })), 'zh');
});

test('resolveLang ignores invalid cookie values and falls through to the header', () => {
  assert.equal(resolveLang(req({ cookie: 'lang=xx', 'accept-language': 'zh-CN' })), 'zh');
  assert.equal(resolveLang(req({ cookie: 'lang=xx' })), 'en');
  assert.equal(resolveLang(req({ cookie: 'lang=zh-CN' })), 'en');
  assert.equal(resolveLang(req({ cookie: 'lang=ZH' })), 'en');
});

test('resolveLang picks the highest-q tag; zh iff the winner is zh-prefixed', () => {
  assert.equal(resolveLang(req({ 'accept-language': 'zh' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'zh-CN' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'zh-Hans' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'ZH-cn' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'zh-TW;q=0.7' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'zh,en;q=0.9' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'en-US,zh;q=0.9' })), 'en');
  assert.equal(resolveLang(req({ 'accept-language': 'zh;q=0.9,en' })), 'en');
  assert.equal(resolveLang(req({ 'accept-language': 'en;q=0.8,zh;q=0.9' })), 'zh');
  assert.equal(resolveLang(req({ 'accept-language': 'en;q=0.9,zh;q=0.9' })), 'en');
});

test('resolveLang defaults to en', () => {
  assert.equal(resolveLang(req({ 'accept-language': 'en-US,en;q=0.9' })), 'en');
  assert.equal(resolveLang(req({ 'accept-language': 'fr-FR,de;q=0.7' })), 'en');
  assert.equal(resolveLang(req({ 'accept-language': 'garbage' })), 'en');
  assert.equal(resolveLang(req({ 'accept-language': '' })), 'en');
  assert.equal(resolveLang(req()), 'en');
});

test('safeNext allows same-origin absolute paths', () => {
  assert.equal(safeNext('/'), '/');
  assert.equal(safeNext('/app'), '/app');
  assert.equal(safeNext('/app/quotes/3/edit'), '/app/quotes/3/edit');
  assert.equal(safeNext('/lang/zh?next=/app'), '/lang/zh?next=/app');
});

test('safeNext rejects external, protocol-relative, and backslash targets', () => {
  assert.equal(safeNext('https://evil.com'), '/');
  assert.equal(safeNext('http://evil.com/app'), '/');
  assert.equal(safeNext('//evil.com'), '/');
  assert.equal(safeNext('\\evil.com'), '/');
  assert.equal(safeNext('\\\\evil.com'), '/');
  assert.equal(safeNext('/a\\b'), '/');
  assert.equal(safeNext('javascript:alert(1)'), '/');
  assert.equal(safeNext('app'), '/');
});

test('safeNext falls back to / for empty and non-string input', () => {
  assert.equal(safeNext(''), '/');
  assert.equal(safeNext(undefined), '/');
  assert.equal(safeNext(null), '/');
});
