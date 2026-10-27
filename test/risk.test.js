import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quitRisk } from '../src/domain/risk.js';
import { at, dates, shift } from './helpers.js';

const now = at('2026-10-27', 12);
const DAY = 86_400_000;

test('a fading new joiner with an ignored complaint is high risk, with reasons', () => {
  const worker = { id: 'w1', joinedAt: now - 30 * DAY };
  const shifts = [
    ...dates('2026-10-13', 6).map((d) => shift(d, 8, 16)), // full week before
    shift('2026-10-22', 8, 16), // only one day last week
  ];
  const issues = [{ reporterId: 'w1', status: 'open', createdAt: now - 4 * DAY }];

  const risk = quitRisk({ worker, shifts, issues, siteMorale: 4, now });
  assert.deepEqual(risk.reasons, ['attendance_drop', 'ignored_issue', 'new_joiner']);
  assert.equal(risk.score, 60);
  assert.equal(risk.level, 'high');
});

test('a steady long-tenure worker in a happy team is low risk', () => {
  const worker = { id: 'w2', joinedAt: now - 400 * DAY };
  const shifts = dates('2026-10-14', 13).filter((_, i) => i % 7 !== 4).map((d) => shift(d, 8, 15.5, 'w2'));
  const risk = quitRisk({ worker, shifts, issues: [], siteMorale: 4.2, now });
  assert.deepEqual(risk.reasons, []);
  assert.equal(risk.level, 'low');
});

test('anonymous issues never count against a named worker', () => {
  const worker = { id: 'w3', joinedAt: now - 400 * DAY };
  const issues = [{ reporterId: null, status: 'open', createdAt: now - 10 * DAY }];
  assert.ok(!quitRisk({ worker, shifts: [], issues, siteMorale: null, now }).reasons.includes('ignored_issue'));
});
