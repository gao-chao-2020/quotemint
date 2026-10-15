import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { clientIp, parseCookies, readBody, readJson, setSessionCookie } from '../../src/lib/http.js';

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

function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
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

test('clientIp honors the last hop of X-Forwarded-For when TRUST_PROXY=1', () => {
  withTrustProxy('1', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '1.2.3.4');
    assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' })), '5.6.7.8');
    assert.equal(clientIp(req({ 'x-forwarded-for': ' 6.6.6.6 , 5.6.7.8 ' })), '5.6.7.8');
    assert.equal(clientIp(req({})), '10.0.0.1');
    assert.equal(clientIp(req({ 'x-forwarded-for': '' })), '10.0.0.1');
  });
});

test('clientIp falls back to unknown when no socket address exists', () => {
  withTrustProxy(undefined, () => {
    assert.equal(clientIp(req({}, null)), 'unknown');
  });
});

test('setSessionCookie always marks Secure in production', () => {
  const makeRes = () => ({ header: '', setHeader(name, value) { this.header = value; } });

  const local = makeRes();
  setSessionCookie(local, 'tok', 'http://localhost:3000');
  assert.equal(local.header.includes('; Secure'), false);

  const https = makeRes();
  setSessionCookie(https, 'tok', 'https://quotemint.dpdns.org');
  assert.equal(https.header.includes('; Secure'), true);

  withEnv('NODE_ENV', 'production', () => {
    const prod = makeRes();
    setSessionCookie(prod, 'tok', 'http://localhost:3000');
    assert.equal(prod.header.includes('; Secure'), true);
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

test('readBody returns the raw buffer; readJson parses the same bytes', async () => {
  const body = await readBody(Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]));
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.toString('utf8'), '{"a":1}');

  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"a":1}')])), { a: 1 });
  assert.deepEqual(await readJson(Readable.from([])), {}, 'empty body parses to {}');
});

test('readBody rejects bodies over 1MB with 413 (readJson inherits the limit)', async () => {
  const isTooLarge = (err) => err.status === 413 && err.code === 'payload_too_large';
  await assert.rejects(readBody(Readable.from([Buffer.alloc(1024 * 1024 + 1, 0x61)])), isTooLarge);
  await assert.rejects(readJson(Readable.from([Buffer.alloc(1024 * 1024 + 1, 0x61)])), isTooLarge);
});
