import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayslip, splitHours } from '../src/domain/pay.js';
import { dates, shift } from './helpers.js';

// 2026-10-26 is a Monday.
const week = (count, hours) => dates('2026-10-26', count).map((d) => shift(d, 8, 8 + hours));

test('hours beyond 8 in a day are overtime', () => {
  const { regular, overtime } = splitHours([shift('2026-10-26', 8, 18)]);
  assert.equal(regular, 8);
  assert.equal(overtime, 2);
});

test('six 9-hour days: daily and weekly rules agree on 6h overtime', () => {
  const { regular, overtime } = splitHours(week(6, 9));
  assert.equal(overtime, 6);
  assert.equal(regular, 48);
});

test('seven 8-hour days: weekly limit makes 8h overtime even with no long day', () => {
  const { total, overtime } = splitHours(week(7, 8));
  assert.equal(total, 56);
  assert.equal(overtime, 8);
});

test('open shifts are not paid until they end', () => {
  assert.equal(splitHours([shift('2026-10-26', 8, null)]).total, 0);
});

test('payslip lines add up and every earning shows hours x rate', () => {
  const worker = { dailyWage: 800, pf: true, esi: true, advance: 100 };
  const slip = computePayslip(worker, [shift('2026-10-26', 8, 18)]);
  const byKey = Object.fromEntries(slip.lines.map((l) => [l.key, l]));

  assert.deepEqual(byKey.basic, { key: 'basic', amount: 800, hours: 8, rate: 100 });
  assert.deepEqual(byKey.overtime, { key: 'overtime', amount: 400, hours: 2, rate: 200 });
  assert.equal(byKey.pf.amount, -96); // 12% of basic
  assert.equal(byKey.esi.amount, -9); // 0.75% of gross
  assert.equal(byKey.advance.amount, -100);
  assert.equal(slip.gross, 1200);
  assert.equal(slip.net, 1200 - 96 - 9 - 100);
  assert.equal(slip.daysWorked, 1);
});

test('zero deductions are hidden and ESI stops above the wage ceiling', () => {
  const slip = computePayslip({ dailyWage: 4000, pf: false, esi: true }, week(6, 8));
  assert.equal(slip.gross, 24_000);
  assert.deepEqual(slip.lines.map((l) => l.key), ['basic', 'overtime']);
});
