import { DAY, dayKey } from './time.js';
import { splitHours } from './pay.js';
import { fatigueFlags } from './fatigue.js';

/** Each signal adds points; reasons are shown to the employer so the score is never a black box. */
const WEIGHTS = {
  attendance_drop: 30,
  ignored_issue: 20,
  heavy_overtime: 15,
  fatigue: 15,
  new_joiner: 10,
  low_morale: 10,
};

const daysWorked = (shifts, from, to) =>
  new Set(shifts.filter((s) => s.start >= from && s.start < to).map((s) => dayKey(s.start))).size;

/**
 * Explainable early-attrition score (0-100).
 * ponytail: hand-tuned weights; fit a logistic model once real exit data exists.
 */
export function quitRisk({ worker, shifts, issues, siteMorale, now = Date.now() }) {
  const reasons = [];
  const lastWeek = daysWorked(shifts, now - 7 * DAY, now + 1);
  const weekBefore = daysWorked(shifts, now - 14 * DAY, now - 7 * DAY);

  if (weekBefore - lastWeek >= 2) reasons.push('attendance_drop');
  if (issues.some((i) => i.reporterId === worker.id && i.status !== 'resolved' && now - i.createdAt > 3 * DAY)) {
    reasons.push('ignored_issue');
  }
  if (splitHours(shifts.filter((s) => s.start >= now - 7 * DAY)).overtime > 12) reasons.push('heavy_overtime');
  if (fatigueFlags(shifts, now).length > 0) reasons.push('fatigue');
  if (now - worker.joinedAt < 60 * DAY) reasons.push('new_joiner');
  if (siteMorale !== null && siteMorale < 3) reasons.push('low_morale');

  const score = Math.min(100, reasons.reduce((sum, r) => sum + WEIGHTS[r], 0));
  const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, reasons };
}
