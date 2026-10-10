import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/db.js';
import { createSession, destroySession, hashPassword, resolveSession, sha256Hex, verifyPassword } from '../../src/lib/auth.js';

const dir = mkdtempSync(join(tmpdir(), 'qm-auth-'));
const db = openDb(dir);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

db.prepare('INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)').run(
  'a@b.co',
  hashPassword('demo1234!'),
  'A',
  new Date().toISOString()
);

test('hashPassword/verifyPassword roundtrip', () => {
  const stored = hashPassword('demo1234!');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('demo1234!', stored), true);
});

test('verifyPassword rejects wrong password', () => {
  const stored = hashPassword('demo1234!');
  assert.equal(verifyPassword('Demo1234!', stored), false);
  assert.equal(verifyPassword('', stored), false);
  assert.equal(verifyPassword('demo1234! ', stored), false);
});

test('verifyPassword rejects malformed stored values', () => {
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(verifyPassword('x', 'scrypt$deadbeef'), false);
  assert.equal(verifyPassword('x', 'bcrypt$aa$bb'), false);
  assert.equal(verifyPassword('x', null), false);
});

test('hashes use unique salts', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('session lifecycle: create, resolve, destroy', () => {
  const token = createSession(db, 1);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(resolveSession(db, token), 1);
  destroySession(db, token);
  assert.equal(resolveSession(db, token), null);
  assert.equal(resolveSession(db, 'deadbeef'), null);
  assert.equal(resolveSession(db, null), null);
});

test('session id is the sha256 of the token, never the token', () => {
  const token = createSession(db, 1);
  const expected = createHash('sha256').update(token).digest('hex');
  assert.equal(sha256Hex(token), expected);
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(expected);
  assert.ok(row);
  assert.equal(db.prepare('SELECT id FROM sessions WHERE id = ?').get(token), undefined);
});

test('expired sessions resolve to null and are deleted', () => {
  const token = createSession(db, 1);
  const id = sha256Hex(token);
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
  assert.equal(resolveSession(db, token), null);
  assert.equal(db.prepare('SELECT id FROM sessions WHERE id = ?').get(id), undefined);
});
