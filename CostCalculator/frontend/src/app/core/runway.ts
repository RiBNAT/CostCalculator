const DAY_MS = 86_400_000;

/** UTC midnight epoch for a date, ignoring time-of-day. */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Days remaining in a period counting today through the end date inclusive.
 * Before the period starts, counts the whole period; after it ends, 0.
 */
export function daysLeftInclusive(start: Date, end: Date, today: Date): number {
  const s = utcDay(start);
  const e = utcDay(end);
  const t = utcDay(today);
  if (t > e) return 0;
  const from = Math.max(t, s);
  return Math.floor((e - from) / DAY_MS) + 1;
}

/** Whole-paisa amount safe to spend each remaining day; 0 if nothing/no days left. */
export function safeToSpendPerDay(remainingPaisa: number, daysLeft: number): number {
  if (daysLeft <= 0 || remainingPaisa <= 0) return 0;
  return Math.floor(remainingPaisa / daysLeft);
}
