export const FREE_MONTHLY_QUOTES = 3;

export function isPro(user, now = Date.now()) {
  if (!user || user.plan !== 'pro') return false;
  if (!user.plan_renews_at) return true;
  const renews = Date.parse(user.plan_renews_at);
  return Number.isFinite(renews) && renews > now;
}

export function monthBoundsUtc(reference = new Date()) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString(), resetsAt: end.toISOString() };
}

export async function countQuotesThisMonth(db, userId, reference = new Date()) {
  const { startIso, endIso } = monthBoundsUtc(reference);
  const row = await db.get(
    'SELECT COUNT(*) AS n FROM quotes WHERE user_id = ? AND created_at >= ? AND created_at < ?',
    userId,
    startIso,
    endIso
  );
  return row.n;
}

export async function quotaFor(db, user, reference = new Date()) {
  const { resetsAt } = monthBoundsUtc(reference);
  const used = await countQuotesThisMonth(db, user.id, reference);
  return {
    used,
    max: isPro(user) ? null : FREE_MONTHLY_QUOTES,
    resets_at: resetsAt
  };
}

export async function canCreateQuote(db, user) {
  if (isPro(user)) return true;
  return (await countQuotesThisMonth(db, user.id)) < FREE_MONTHLY_QUOTES;
}
