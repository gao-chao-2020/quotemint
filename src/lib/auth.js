import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'qm_session';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  let expected;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const derived = scryptSync(String(password), salt, 64);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    sha256Hex(token),
    userId,
    expires.toISOString(),
    now.toISOString()
  );
  return token;
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
}

export function resolveSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .get(sha256Hex(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
    return null;
  }
  return row.user_id;
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    brand_color: row.brand_color,
    logo_text: row.logo_text,
    plan: row.plan,
    plan_renews_at: row.plan_renews_at ?? null,
    created_at: row.created_at
  };
}
