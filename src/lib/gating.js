export const FREE_MONTHLY_QUOTES = 3;

export function monthBoundsUtc(reference = new Date()) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString(), resetsAt: end.toISOString() };
}

export function countQuotesThisMonth(db, userId, reference = new Date()) {
  const { startIso, endIso } = monthBoundsUtc(reference);
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM quotes WHERE user_id = ? AND created_at >= ? AND created_at < ?')
    .get(userId, startIso, endIso);
  return row.n;
}

export function quotaFor(db, user, reference = new Date()) {
  const { resetsAt } = monthBoundsUtc(reference);
  const used = countQuotesThisMonth(db, user.id, reference);
  return {
    used,
    max: user.plan === 'pro' ? null : FREE_MONTHLY_QUOTES,
    resets_at: resetsAt
  };
}

export function canCreateQuote(db, user) {
  if (user.plan === 'pro') return true;
  return countQuotesThisMonth(db, user.id) < FREE_MONTHLY_QUOTES;
}
