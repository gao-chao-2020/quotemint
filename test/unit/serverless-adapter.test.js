import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'qm-adapter-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = '1';
process.env.BASE_URL = 'http://localhost:3000';
delete process.env.DATABASE_URL;

const { adapt, createResponseCollector } = await import('../../src/lib/serverless-adapter.js');

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite file locked while the module-level handle is open.
  }
});

let ipCounter = 0;
let emailCounter = 0;

function event({ method = 'GET', path = '/', headers = {}, body, isBase64Encoded = false } = {}) {
  ipCounter += 1;
  return {
    httpMethod: method,
    path,
    rawUrl: `http://localhost${path}`,
    headers: { host: 'localhost', 'x-forwarded-for': `10.9.9.${ipCounter}`, ...headers },
    ...(body !== undefined ? { body, isBase64Encoded } : {})
  };
}

function decode(response) {
  return Buffer.from(response.body, 'base64').toString('utf8');
}

function uniqueEmail() {
  emailCounter += 1;
  return `adapter-${Date.now()}-${emailCounter}@test.dev`;
}

test('GET / returns 200 HTML with security headers', async () => {
  const response = await adapt(event({ path: '/' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.isBase64Encoded, true);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  const html = decode(response);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /QuoteMint/);
});

test('GET /healthz returns 200 ok', async () => {
  const response = await adapt(event({ path: '/healthz' }));
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/plain/);
  assert.equal(decode(response), 'ok');
});

test('GET /api/auth/me without session returns 401 JSON envelope', async () => {
  const response = await adapt(event({ path: '/api/auth/me' }));
  assert.equal(response.statusCode, 401);
  assert.match(response.headers['content-type'], /^application\/json/);
  const payload = JSON.parse(decode(response));
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'not_authenticated');
});

test('POST /api/auth/signup with base64 body creates the account', async () => {
  const email = uniqueEmail();
  const json = JSON.stringify({ email, password: 'hunter2hunter2', name: 'Adapter Test' });
  const response = await adapt(
    event({
      method: 'POST',
      path: '/api/auth/signup',
      // Canonical header casing, like real Netlify/Lambda v1 events carry.
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: Buffer.from(json, 'utf8').toString('base64'),
      isBase64Encoded: true
    })
  );
  assert.equal(response.statusCode, 201);
  const payload = JSON.parse(decode(response));
  assert.equal(payload.ok, true);
  assert.equal(payload.data.user.email, email);
  assert.match(response.headers['set-cookie'], /^qm_session=/);
  assert.equal(response.multiValueHeaders, undefined);
});

test('POST /api/auth/signup without X-Requested-With is rejected by CSRF', async () => {
  const response = await adapt(
    event({ method: 'POST', path: '/api/auth/signup', headers: { 'Content-Type': 'application/json' } })
  );
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(decode(response)).error.code, 'csrf');
});

test('GET /lang/zh redirects and sets the lang cookie', async () => {
  const response = await adapt(event({ path: '/lang/zh' }));
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/');
  assert.match(response.headers['set-cookie'], /^lang=zh;/);
});

test('GET /styles.css serves the static file from public/', async () => {
  const response = await adapt(event({ path: '/styles.css' }));
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/css/);
  assert.ok(decode(response).length > 0);
});

test('unknown routes 404 as JSON for the API and HTML for pages', async () => {
  const api = await adapt(event({ path: '/api/nope' }));
  assert.equal(api.statusCode, 404);
  assert.equal(JSON.parse(decode(api)).error.code, 'not_found');

  const page = await adapt(event({ path: '/nope' }));
  assert.equal(page.statusCode, 404);
  assert.match(page.headers['content-type'], /^text\/html/);
});

test('response collector passes multiple Set-Cookie values via multiValueHeaders', () => {
  const collector = createResponseCollector();
  collector.res.setHeader('Set-Cookie', 'a=1; Path=/');
  collector.res.setHeader('Set-Cookie', 'b=2; Path=/');
  collector.res.writeHead(200, { 'Content-Type': 'text/plain' });
  collector.res.end('ok');

  const response = collector.toResponse();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.multiValueHeaders, { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] });
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['content-type'], 'text/plain');

  const single = createResponseCollector();
  single.res.setHeader('Set-Cookie', 'c=3; Path=/');
  single.res.writeHead(204, {});
  single.res.end();
  const singleResponse = single.toResponse();
  assert.equal(singleResponse.headers['set-cookie'], 'c=3; Path=/');
  assert.equal(singleResponse.multiValueHeaders, undefined);
});
