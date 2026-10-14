// Manual Pro grant/revoke for the server host (Alipay manual-upgrade flow).
// Usage:
//   node scripts/grant.js grant <email> [months]   Grant Pro (default 12 months; stacks onto an active renewal date)
//   node scripts/grant.js revoke <email>           Revoke Pro and clear the renewal date
// Runs against SQLite in DATA_DIR (default ./data); with DATABASE_URL set it targets Postgres
// instead — that is how production (Neon) users are granted: DATABASE_URL=postgres://... npm run grant <email> 12
// The web admin panel applies the same grantPro/revokePro core from src/lib/admin.js.

import { openDb, resolveDataDir } from '../src/lib/db.js';
import { grantPro, revokePro } from '../src/lib/admin.js';
import { HttpError } from '../src/lib/http.js';

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

// grantPro validates the user first and months second, matching the original
// script's error order; the catches below keep the same output and exit codes.
function fail(err) {
  if (err instanceof HttpError && err.code === 'user_not_found') {
    console.error(`No account found for ${email}.`);
    process.exit(1);
  }
  if (err instanceof HttpError && err.code === 'invalid_months') {
    console.error('months must be a whole number between 1 and 120.');
    process.exit(1);
  }
  throw err;
}

const db = openDb(resolveDataDir());
try {
  if (command === 'grant') {
    const months = rawMonths === undefined ? 12 : Number(rawMonths);
    const result = await grantPro(db, email, months);
    console.log(`grant: ${email} is now Pro until ${result.renews_at}${result.extended ? ` (extended from ${result.previous_renews_at})` : ''}`);
  } else {
    await revokePro(db, email);
    console.log(`revoke: ${email} is now Free`);
  }
} catch (err) {
  fail(err);
}
await db.close();
