// Verifies scripts/grant.js keeps its CLI contract while delegating to the
// shared grantPro/revokePro core from src/lib/admin.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/lib/db.js';
import { hashPassword } from '../../src/lib/auth.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EMAIL = 'cliuser@test.local';

let dataDir;

function runCli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', 'scripts/grant.js', ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: '', DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function withDb(fn) {
  const db = new DatabaseSync(join(dataDir, 'app.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'qm-cli-'));
  const db = openDb(dataDir);
  await db.run(
    'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)',
    EMAIL,
    hashPassword('irrelevant'),
    'CLI User',
    new Date().toISOString()
  );
  await db.close();
});

after(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('grant CLI prints the original message shape and records the audit row', async () => {
  const res = await runCli('grant', EMAIL);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, new RegExp(`^grant: ${EMAIL} is now Pro until \\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z\\n$`));
  assert.ok(!res.stdout.includes('extended from'), 'first grant must not claim an extension');

  const row = withDb((db) => db.prepare('SELECT plan, plan_renews_at FROM users WHERE email = ?').get(EMAIL));
  assert.equal(row.plan, 'pro');
  assert.ok(Number.isFinite(Date.parse(row.plan_renews_at)));
  const monthsAhead = (Date.parse(row.plan_renews_at) - Date.now()) / 86_400_000;
  assert.ok(monthsAhead > 360 && monthsAhead < 371, `default grant is 12 months, got ${monthsAhead.toFixed(1)} days`);

  const event = withDb((db) => db.prepare('SELECT action, target_email, detail FROM admin_events ORDER BY id DESC').get());
  assert.deepEqual({ ...event }, { action: 'grant', target_email: EMAIL, detail: '12' });
});

test('grant CLI stacks onto the active renewal date (case-insensitive email)', async () => {
  const previous = withDb((db) => db.prepare('SELECT plan_renews_at FROM users WHERE email = ?').get(EMAIL)).plan_renews_at;
  const res = await runCli('grant', 'CLIUser@TEST.LOCAL', '3');
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, new RegExp(`^grant: ${EMAIL} is now Pro until .+ \\(extended from ${previous.replace(/[.\\+*?^$()|[\]{}]/g, '\\$&')}\\)\\n$`));

  const next = withDb((db) => db.prepare('SELECT plan_renews_at FROM users WHERE email = ?').get(EMAIL)).plan_renews_at;
  const addedDays = (Date.parse(next) - Date.parse(previous)) / 86_400_000;
  assert.ok(addedDays > 88 && addedDays < 94, `expected +3 months from the active date, got +${addedDays.toFixed(1)} days`);
});

test('revoke CLI clears the plan and records the audit row', async () => {
  const res = await runCli('revoke', EMAIL);
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, `revoke: ${EMAIL} is now Free\n`);

  const row = withDb((db) => db.prepare('SELECT plan, plan_renews_at FROM users WHERE email = ?').get(EMAIL));
  assert.equal(row.plan, 'free');
  assert.equal(row.plan_renews_at, null);
  const event = withDb((db) => db.prepare('SELECT action, target_email FROM admin_events ORDER BY id DESC').get());
  assert.deepEqual({ ...event }, { action: 'revoke', target_email: EMAIL });
});

test('CLI error paths keep the original messages and exit codes', async () => {
  const unknown = await runCli('grant', 'nobody@test.local');
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stderr.split('\n')[0], 'No account found for nobody@test.local.');

  const badMonths = await runCli('grant', EMAIL, '0');
  assert.equal(badMonths.code, 1);
  assert.equal(badMonths.stderr.split('\n')[0], 'months must be a whole number between 1 and 120.');

  const badCommand = await runCli('frobnicate', EMAIL);
  assert.equal(badCommand.code, 1);
  assert.equal(badCommand.stderr.split('\n')[0], 'Expected command "grant" or "revoke".');
});
