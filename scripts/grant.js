// Manual Pro grant/revoke for the server host (Alipay manual-upgrade flow).
// Usage:
//   node scripts/grant.js grant <email> [months]   Grant Pro (default 12 months; stacks onto an active renewal date)
//   node scripts/grant.js revoke <email>           Revoke Pro and clear the renewal date
// Runs against SQLite in DATA_DIR (default ./data); with DATABASE_URL set it targets Postgres
// instead — that is how production (Neon) users are granted: DATABASE_URL=postgres://... npm run grant <email> 12

import { openDb, resolveDataDir } from '../src/lib/db.js';

const USAGE = `Usage:
  node scripts/grant.js grant <email> [months]   Grant Pro (default 12 months, stacks onto an active renewal date)
  node scripts/grant.js revoke <email>           Revoke Pro and clear the renewal date
Runs against DATA_DIR (default ./data) — use the same DATA_DIR as your server (e.g. DATA_DIR=./data node scripts/grant.js grant user@example.com). Set DATABASE_URL to target Postgres (production/Neon) instead.`;

const [command, rawEmail, rawMonths] = process.argv.slice(2);
const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

function usageError(message) {
  console.error(message);
  console.error('');
  console.error(USAGE);
  process.exit(1);
}

if (command !== 'grant' && command !== 'revoke') {
  usageError('Expected command "grant" or "revoke".');
}
if (!email || !email.includes('@')) {
  usageError('Provide the account email as the second argument.');
}

const db = openDb(resolveDataDir());
const user = await db.get('SELECT id, email, plan, plan_renews_at FROM users WHERE email = ?', email);
if (!user) {
  console.error(`No account found for ${email}.`);
  process.exit(1);
}

if (command === 'grant') {
  const months = rawMonths === undefined ? 12 : Number(rawMonths);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    console.error('months must be a whole number between 1 and 120.');
    process.exit(1);
  }
  const now = Date.now();
  const current = user.plan_renews_at ? Date.parse(user.plan_renews_at) : NaN;
  const active = Number.isFinite(current) && current > now;
  const base = new Date(active ? current : now);
  base.setUTCMonth(base.getUTCMonth() + months);
  const renewsAt = base.toISOString();
  await db.run(`UPDATE users SET plan = 'pro', plan_renews_at = ? WHERE id = ?`, renewsAt, user.id);
  console.log(`grant: ${email} is now Pro until ${renewsAt}${active ? ` (extended from ${user.plan_renews_at})` : ''}`);
} else {
  await db.run(`UPDATE users SET plan = 'free', plan_renews_at = NULL WHERE id = ?`, user.id);
  console.log(`revoke: ${email} is now Free`);
}
await db.close();
