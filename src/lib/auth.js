import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'qm_session';
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

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

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await db.run(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    sha256Hex(token),
    userId,
    expires.toISOString(),
    now.toISOString()
  );
  return token;
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE id = ?', sha256Hex(token));
}

export async function resolveSession(db, token) {
  if (!token) return null;
  const row = await db.get('SELECT user_id, expires_at FROM sessions WHERE id = ?', sha256Hex(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run('DELETE FROM sessions WHERE id = ?', sha256Hex(token));
    return null;
  }
  return row.user_id;
}

// Only the sha256 of the raw token is stored, mirroring sessions. Any previous
// unused token for the user is dropped so a leaked older link cannot compete.
export async function createPasswordReset(db, userId) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await db.transaction(async () => {
    await db.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', userId);
    await db.run(
      'INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
      userId,
      sha256Hex(token),
      new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      now.toISOString()
    );
  });
  return token;
}

export async function resolvePasswordReset(db, rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0 || rawToken.length > 200) return null;
  const row = await db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256Hex(rawToken));
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

// Claims the token before touching the password (conditional update = atomic
// single-use in both drivers), hashes the new password, and kills every
// session of the user so all devices are forced to log in again.
export async function consumePasswordReset(db, resetRow, newPassword) {
  const passwordHash = hashPassword(newPassword);
  const now = new Date().toISOString();
  return db.transaction(async () => {
    const claimed = await db.run(
      'UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL',
      now,
      resetRow.id
    );
    if (claimed.changes !== 1) return false;
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, resetRow.user_id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', resetRow.user_id);
    return true;
  });
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
