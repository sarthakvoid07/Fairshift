import { LABOUR } from './sectors.js';
import { HOUR, dayKey, weekKey, oneDecimal } from './time.js';

const PF_RATE = 0.12; // employee EPF share of basic wages
const ESI_RATE = 0.0075; // employee ESI share of gross wages
const ESI_CEILING = 21_000; // ESI applies only at or below this monthly gross

export const shiftHours = (shift, now = Date.now()) => ((shift.end ?? now) - shift.start) / HOUR;

/**
 * Splits closed shifts into regular and overtime hours.
 * Overtime for a week is the larger of: hours beyond the daily limit summed
 * across its days, or hours beyond the weekly limit.
 */
export function splitHours(shifts) {
  const weeks = new Map();
  for (const shift of shifts) {
    if (!shift.end) continue;
    const week = weeks.get(weekKey(shift.start)) ?? { days: new Map(), total: 0 };
    const hours = shiftHours(shift);
    const day = dayKey(shift.start);
    week.days.set(day, (week.days.get(day) ?? 0) + hours);
    week.total += hours;
    weeks.set(weekKey(shift.start), week);
  }

  let total = 0;
  let overtime = 0;
  for (const week of weeks.values()) {
    let dailyExcess = 0;
    for (const hours of week.days.values()) dailyExcess += Math.max(0, hours - LABOUR.dailyHours);
    overtime += Math.max(dailyExcess, week.total - LABOUR.weeklyHours, 0);
    total += week.total;
  }
  return { total, regular: total - overtime, overtime };
}

/**
 * Builds a payslip a worker can check by hand: every earning line shows
 * hours x rate, and hours are rounded to a tenth before money is computed.
 */
export function computePayslip(worker, shifts) {
  const split = splitHours(shifts);
  const regular = oneDecimal(split.regular);
  const overtime = oneDecimal(split.overtime);
  const hourly = worker.dailyWage / LABOUR.dailyHours;
  const overtimeRate = hourly * LABOUR.overtimeMultiplier;

  const basic = Math.round(regular * hourly);
  const extra = Math.round(overtime * overtimeRate);
  const gross = basic + extra;
  const pf = worker.pf ? Math.round(basic * PF_RATE) : 0;
  const esi = worker.esi && gross <= ESI_CEILING ? Math.round(gross * ESI_RATE) : 0;
  const advance = worker.advance ?? 0;

  const lines = [
    { key: 'basic', amount: basic, hours: regular, rate: money(hourly) },
    { key: 'overtime', amount: extra, hours: overtime, rate: money(overtimeRate) },
    { key: 'pf', amount: -pf },
    { key: 'esi', amount: -esi },
    { key: 'advance', amount: -advance },
  ].filter((line) => line.hours !== undefined || line.amount !== 0);

  return {
    daysWorked: new Set(shifts.filter((s) => s.end).map((s) => dayKey(s.start))).size,
    lines,
    gross,
    net: gross - pf - esi - advance,
  };
}

const money = (n) => Math.round(n * 100) / 100;
