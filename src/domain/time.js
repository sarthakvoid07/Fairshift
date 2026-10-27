export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ponytail: one fixed offset (IST). Store an offset per organisation when expanding beyond India.
export const TZ_OFFSET = 330 * 60_000;

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
export const dayKey = (ts) => new Date(ts + TZ_OFFSET).toISOString().slice(0, 10);

/** Local date of the Monday that starts the timestamp's week. */
export function weekKey(ts) {
  const mondayOffset = (new Date(ts + TZ_OFFSET).getUTCDay() + 6) % 7;
  return dayKey(ts - mondayOffset * DAY);
}

/** UTC timestamp of local midnight for the timestamp's day. */
export const startOfDay = (ts) => Math.floor((ts + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;

export const oneDecimal = (n) => Math.round(n * 10) / 10;
