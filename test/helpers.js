/** Timestamp for a local (IST) date and hour, e.g. at('2026-10-26', 8.5) is 08:30 IST. */
export const at = (date, hour) => Date.parse(`${date}T00:00:00+05:30`) + hour * 3_600_000;

let n = 0;
export const shift = (date, from, to, workerId = 'w1') => ({
  id: `s${(n += 1)}`,
  workerId,
  start: at(date, from),
  end: to === null ? null : at(date, to),
});

/** Consecutive dates starting at `first` (YYYY-MM-DD). */
export function dates(first, count) {
  const start = Date.parse(`${first}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}
