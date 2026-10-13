// End-to-end smoke test for the Postgres deploy path. Talks to a real
// Postgres (e.g. Neon free tier) and exercises migrate + seed + the full
// quote lifecycle over HTTP. Exits non-zero if any check fails.
//
// Usage:
//   npm run smoke:pg                      # migrate + seed + HTTP lifecycle
//   npm run smoke:pg -- --migrate-only    # just apply/verify the schema

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/lib/db.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT || 4390);
const BASE = `http://localhost:${PORT}`;
const MIGRATE_ONLY = process.argv.includes('--migrate-only');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

if (!process.env.DATABASE_URL) {
  console.error(`smoke-pg: DATABASE_URL is not set, so there is no Postgres to test.

This script exercises the Postgres driver end to end and only runs when the
server would use Postgres. Set DATABASE_URL to a Postgres connection string,
for example from the Neon dashboard (free tier):

  postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require

Then run:
  npm run smoke:pg                     # migrate + seed + full HTTP lifecycle
  npm run smoke:pg -- --migrate-only   # just apply and verify the schema

Without DATABASE_URL the app runs on local SQLite; use "npm test" for that.`);
  process.exit(1);
}

function extractSession(setCookie) {
  const match = /qm_session=([^;]+)/.exec(setCookie || '');
  return match ? `qm_session=${match[1]}` : '';
}

async function request(method, path, { body, cookie } = {}) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML page, not JSON.
  }
  return { status: res.status, body: json, text, setCookie: res.headers.get('set-cookie') || '' };
}

const db = openDb();
let serverChild = null;

process.on('exit', () => {
  if (serverChild) {
    try {
      serverChild.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
});

try {
  const tables = await db.get(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'quotes', 'quote_events')`
  );
  record('migrate: all 4 tables exist', tables.n === 4, `${tables.n}/4`);
  const users = await db.get('SELECT COUNT(*) AS n FROM users');
  record('migrate: users table is queryable', Number.isInteger(users.n), `${users.n} rows`);

  if (MIGRATE_ONLY) {
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`smoke-pg summary: ${results.length - failed.length}/${results.length} passed`);
    await db.close();
    process.exit(failed.length ? 1 : 0);
  }

  if (results.some((r) => !r.ok)) {
    console.log('');
    console.log('smoke-pg: migration failed; skipping boot and lifecycle checks.');
    await db.close();
    process.exit(1);
  }

  const childEnv = {
    ...process.env,
    PORT: String(PORT),
    BASE_URL: BASE,
    DEMO_MODE: 'true',
    NODE_ENV: 'test',
    STRIPE_WEBHOOK_SECRET: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_PRICE_ID: '',
    CREEM_API_KEY: '',
    CREEM_PRODUCT_ID: '',
    CREEM_WEBHOOK_SECRET: '',
    CREEM_API_BASE: ''
  };
  delete childEnv.DATA_DIR;
  delete childEnv.TRUST_PROXY;

  async function runChild(args) {
    const child = spawn(process.execPath, ['--no-warnings', ...args], {
      cwd: ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    return { code, out };
  }

  const seed = await runChild(['scripts/seed.js']);
  const seedLine = seed.out.trim().split('\n').pop() || '';
  record('seed: demo data seeded (idempotent)', seed.code === 0, seed.code === 0 ? seedLine : seed.out.trim());

  if (seed.code !== 0) {
    console.log('');
    console.log('smoke-pg: seed failed; skipping boot and lifecycle checks.');
    await db.close();
    process.exit(1);
  }

  try {
    await fetch(`${BASE}/healthz`);
    record('boot: port is free', false, `something is already listening on ${PORT}`);
  } catch {
    // Port is free, as expected.
  }
  if (results.some((r) => !r.ok)) {
    await db.close();
    process.exit(1);
  }

  serverChild = spawn(process.execPath, ['--no-warnings', 'src/server.js'], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  let serverExit = null;
  serverChild.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  serverChild.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });
  serverChild.on('exit', (code) => {
    serverExit = code;
  });

  let healthy = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && serverExit === null) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.status === 200 && (await res.text()) === 'ok') {
        healthy = true;
        break;
      }
    } catch {
      // Not accepting connections yet.
    }
    await sleep(150);
  }
  record('boot: server becomes healthy', healthy, serverExit === null ? '' : `server exited (code ${serverExit})\n${serverLog}`);
  if (!healthy) {
    console.log('');
    console.log('smoke-pg: server did not boot; skipping lifecycle checks.');
    await db.close();
    process.exit(1);
  }

  const email = `smoke+${Date.now()}@quotemint.dev`;

  const signup = await request('POST', '/api/auth/signup', {
    body: { email, password: 'smoke-pass-123', name: 'Smoke Test' }
  });
  const cookie = extractSession(signup.setCookie);
  record('signup returns 201 with a session cookie', signup.status === 201 && cookie !== '', `HTTP ${signup.status}`);

  let quoteId = null;
  if (cookie) {
    const created = await request('POST', '/api/quotes', {
      cookie,
      body: {
        title: 'Smoke Test Quote',
        client_name: 'Smoke Client',
        client_email: '',
        currency: 'USD',
        items: [{ desc: 'Smoke line item', qty: 1, unit_price_cents: 12345 }],
        discount_pct: 0,
        tax_pct: 0,
        notes: '',
        terms: '',
        valid_until: null
      }
    });
    quoteId = created.body?.data?.quote?.id ?? null;
    record('create quote returns 201 with an integer id', created.status === 201 && Number.isInteger(quoteId), `HTTP ${created.status}, id ${quoteId}`);
  }

  let token = '';
  if (quoteId !== null) {
    const sent = await request('POST', `/api/quotes/${quoteId}/send`, { cookie });
    token = String(sent.body?.data?.public_url || '').split('/q/')[1] || '';
    record('send quote returns a public_url', sent.status === 200 && token !== '', `HTTP ${sent.status}`);
  }

  if (token !== '') {
    const page = await request('GET', `/q/${token}`);
    record('public quote page renders', page.status === 200 && page.text.includes('Smoke Test Quote'), `HTTP ${page.status}`);

    const accepted = await request('POST', `/api/public/quotes/${token}/accept`, {
      body: { name: 'Smoke Signer', agree: true }
    });
    record('public accept returns accepted', accepted.status === 200 && accepted.body?.data?.status === 'accepted', `HTTP ${accepted.status}`);
  }

  if (quoteId !== null) {
    const fetched = await request('GET', `/api/quotes/${quoteId}`, { cookie });
    record(
      'owner reads back status accepted (persisted)',
      fetched.status === 200 && fetched.body?.data?.quote?.status === 'accepted',
      `status ${fetched.body?.data?.quote?.status}`
    );
  }

  const login = await request('POST', '/api/auth/login', {
    body: { email: 'demo@quotemint.dev', password: 'demo1234!' }
  });
  record('seeded demo account can log in', login.status === 200, `HTTP ${login.status}`);

  if (serverChild && serverExit === null) {
    serverChild.kill();
    const gone = Date.now() + 5000;
    while (serverExit === null && Date.now() < gone) await sleep(50);
    if (serverExit === null) serverChild.kill('SIGKILL');
  }
  serverChild = null;

  try {
    const smokeUser = await db.get('SELECT id FROM users WHERE email = ?', email);
    if (smokeUser) {
      await db.run('DELETE FROM quote_events WHERE quote_id IN (SELECT id FROM quotes WHERE user_id = ?)', smokeUser.id);
      await db.run('DELETE FROM quotes WHERE user_id = ?', smokeUser.id);
      await db.run('DELETE FROM sessions WHERE user_id = ?', smokeUser.id);
      await db.run('DELETE FROM users WHERE id = ?', smokeUser.id);
      console.log(`cleanup: removed smoke user ${email}`);
    }
  } catch (err) {
    console.log(`cleanup: could not remove smoke user (${err.message})`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(
    `smoke-pg summary: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` - FAILED: ${failed.map((r) => r.name).join('; ')}` : '')
  );
  await db.close();
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  if (serverChild) {
    try {
      serverChild.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  console.error(`smoke-pg: unexpected error - ${err.message}`);
  try {
    await db.close();
  } catch {
    // pool may already be closed
  }
  process.exit(1);
}
