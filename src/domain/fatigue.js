import { LABOUR } from './sectors.js';
import { DAY, HOUR, dayKey } from './time.js';
import { shiftHours } from './pay.js';

/** Fatigue warnings from shifts started in the last 7 days. An open shift counts up to `now`. */
export function fatigueFlags(shifts, now = Date.now()) {
  const recent = shifts
    .filter((s) => s.start > now - 7 * DAY)
    .sort((a, b) => a.start - b.start);

  const flags = new Set();
  let total = 0;
  recent.forEach((shift, i) => {
    const hours = shiftHours(shift, now);
    total += hours;
    if (hours > LABOUR.maxShiftHours) flags.add('long_shift');

    // A gap inside one day is a break; only gaps between days count as rest.
    const prev = recent[i - 1];
    const restHours = prev?.end ? (shift.start - prev.end) / HOUR : Infinity;
    if (dayKey(prev?.start ?? 0) !== dayKey(shift.start) && restHours < LABOUR.minRestHours) {
      flags.add('short_rest');
    }
  });
  if (total > LABOUR.weeklyHours) flags.add('weekly_limit');
  if (workStreak(shifts, now) > LABOUR.maxConsecutiveDays) flags.add('no_rest_day');
  return [...flags];
}

/** Consecutive days worked, ending today (or yesterday if not yet worked today). */
export function workStreak(shifts, now = Date.now()) {
  const days = new Set(shifts.map((s) => dayKey(s.start)));
  let cursor = days.has(dayKey(now)) ? now : now - DAY;
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}
