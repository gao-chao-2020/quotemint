import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, parseCookies } from '../../src/lib/http.js';

function req(headers = {}, remoteAddress = '10.0.0.1') {
  return { headers, socket: remoteAddress ? { remoteAddress } : null };
}

function withTrustProxy(value, fn) {
  const saved = process.env.TRUST_PROXY;
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  }
}

test('clientIp ignores X-Forwarded-For unless TRUST_PROXY=1', () => {
  withTrustProxy(undefined, () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.1');
  });
  withTrustProxy('true', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.1');
  });
  withTrustProxy('0', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.1');
  });
});

test('clientIp honors the first hop of X-Forwarded-For when TRUST_PROXY=1', () => {
  withTrustProxy('1', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '1.2.3.4');
    assert.equal(clientIp(req({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' })), '1.2.3.4');
    assert.equal(clientIp(req({})), '10.0.0.1');
    assert.equal(clientIp(req({ 'x-forwarded-for': '' })), '10.0.0.1');
  });
});

test('clientIp falls back to unknown when no socket address exists', () => {
  withTrustProxy(undefined, () => {
    assert.equal(clientIp(req({}, null)), 'unknown');
  });
});

test('parseCookies decodes values and keeps later cookies', () => {
  const jar = parseCookies(req({ cookie: 'a=1; qm_session=abc123; spaced=hello%20world' }));
  assert.deepEqual(jar, { a: '1', qm_session: 'abc123', spaced: 'hello world' });
});

test('parseCookies falls back to raw value on malformed percent-encoding', () => {
  const jar = parseCookies(req({ cookie: 'qm_session=%E0%A4%A; keep=1' }));
  assert.equal(jar.qm_session, '%E0%A4%A');
  assert.equal(jar.keep, '1');
});

test('parseCookies skips nameless parts and handles no cookie header', () => {
  assert.deepEqual(parseCookies(req({})), {});
  assert.deepEqual(parseCookies(req({ cookie: '=nope; ok=1' })), { ok: '1' });
});
