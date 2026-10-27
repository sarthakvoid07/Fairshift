import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatigueFlags, workStreak } from '../src/domain/fatigue.js';
import { at, dates, shift } from './helpers.js';

test('a shift over 10 hours is flagged', () => {
  assert.deepEqual(fatigueFlags([shift('2026-10-26', 7, 18)], at('2026-10-26', 20)), ['long_shift']);
});

test('more than 48 hours in 7 days is flagged', () => {
  const shifts = dates('2026-10-26', 6).map((d) => shift(d, 8, 17));
  assert.ok(fatigueFlags(shifts, at('2026-11-01', 9)).includes('weekly_limit'));
});

test('under 11 hours of rest between days is flagged', () => {
  const shifts = [shift('2026-10-26', 8, 20), shift('2026-10-27', 6, 14)];
  assert.ok(fatigueFlags(shifts, at('2026-10-27', 15)).includes('short_rest'));
});

test('a lunch break inside one day is not a rest violation', () => {
  const shifts = [shift('2026-10-26', 8, 12), shift('2026-10-26', 13, 17)];
  assert.deepEqual(fatigueFlags(shifts, at('2026-10-26', 18)), []);
});

test('seven days in a row without a day off is flagged', () => {
  const shifts = dates('2026-10-20', 7).map((d) => shift(d, 9, 15));
  assert.equal(workStreak(shifts, at('2026-10-26', 16)), 7);
  assert.ok(fatigueFlags(shifts, at('2026-10-26', 16)).includes('no_rest_day'));
});

test('an open shift counts up to now', () => {
  assert.deepEqual(fatigueFlags([shift('2026-10-26', 7, null)], at('2026-10-26', 18)), ['long_shift']);
});
