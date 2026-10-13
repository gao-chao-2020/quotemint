import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const running = new Set();

process.on('exit', () => {
  for (const child of running) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* best effort */ }
}

export async function boot({ port, env = {} } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'qm-int-'));
  const child = spawn(process.execPath, ['--no-warnings', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_URL: `http://localhost:${port}`,
      DATA_DIR: dataDir,
      DEMO_MODE: 'true',
      NODE_ENV: 'test',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_PRICE_ID: '',
      CREEM_API_KEY: '',
      CREEM_PRODUCT_ID: '',
      CREEM_WEBHOOK_SECRET: '',
      CREEM_API_BASE: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  running.add(child);

  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  let exitCode = null;
  child.on('exit', (code) => { exitCode = code; });

  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      running.delete(child);
      removeDir(dataDir);
      throw new Error(`server on :${port} exited early (code ${exitCode})\n${log}`);
    }
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.status === 200 && (await res.text()) === 'ok' && exitCode === null) {
        return {
          port,
          base,
          dataDir,
          url: (path) => `${base}${path}`,
          log: () => log,
          async close() {
            if (exitCode === null) {
              child.kill();
              const gone = Date.now() + 5000;
              while (exitCode === null && Date.now() < gone) await sleep(50);
              if (exitCode === null) child.kill('SIGKILL');
            }
            running.delete(child);
            await sleep(100);
            removeDir(dataDir);
          }
        };
      }
    } catch { /* not accepting connections yet */ }
    await sleep(150);
  }
  child.kill('SIGKILL');
  running.delete(child);
  removeDir(dataDir);
  throw new Error(`server on :${port} did not become healthy within 20s\n${log}`);
}

export async function api(server, method, path, opts = {}) {
  const { body, raw, cookie, headers = {}, csrf = true } = opts;
  const requestHeaders = { ...headers };
  if (csrf) requestHeaders['X-Requested-With'] = 'XMLHttpRequest';
  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    if (!requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json';
  }
  if (cookie) requestHeaders.Cookie = cookie;

  const res = await fetch(server.url(path), {
    method,
    headers: requestHeaders,
    body: payload,
    redirect: 'manual'
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response (HTML) */ }
  return {
    status: res.status,
    body: json,
    text,
    headers: res.headers,
    setCookie: res.headers.get('set-cookie') || '',
    location: res.headers.get('location') || ''
  };
}

export function sessionCookie(setCookie) {
  const match = /qm_session=([^;]+)/.exec(setCookie || '');
  return match ? `qm_session=${match[1]}` : '';
}

let emailSeq = 0;
export function uniqueEmail(prefix = 'user') {
  emailSeq += 1;
  return `${prefix}.${Date.now()}.${emailSeq}@test.local`;
}

export async function signup(server, { email = uniqueEmail(), password = 'password123', name = 'Test User' } = {}) {
  const res = await api(server, 'POST', '/api/auth/signup', { body: { email, password, name } });
  assert.equal(res.status, 201, `signup failed: ${res.text}`);
  return { res, cookie: sessionCookie(res.setCookie), email, password, user: res.body.data.user };
}

export function quoteBody(overrides = {}) {
  return {
    title: 'Website redesign',
    client_name: 'Jane Client',
    client_email: 'jane@client.example',
    currency: 'USD',
    items: [{ desc: 'Design work', qty: 10, unit_price_cents: 15000 }],
    discount_pct: 0,
    tax_pct: 0,
    notes: '',
    terms: '',
    valid_until: null,
    ...overrides
  };
}

export async function createQuote(server, cookie, overrides = {}) {
  return api(server, 'POST', '/api/quotes', { cookie, body: quoteBody(overrides) });
}

export async function sendQuote(server, cookie, id) {
  return api(server, 'POST', `/api/quotes/${id}/send`, { cookie });
}

export function assertOk(res, status = 200) {
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${res.text}`);
  assert.equal(res.body?.ok, true, `expected ok:true envelope: ${res.text}`);
  return res.body.data;
}

export function assertErr(res, status, code) {
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${res.text}`);
  assert.equal(res.body?.ok, false, `expected ok:false envelope: ${res.text}`);
  assert.equal(res.body?.error?.code, code, `expected error.code=${code}, got ${res.body?.error?.code}: ${res.text}`);
  return res.body.error;
}
