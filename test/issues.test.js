import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareIssues, isOverdue, maxSeverity, triageByRules } from '../src/domain/issues.js';
import { categoriesFor } from '../src/domain/sectors.js';

const construction = categoriesFor('construction');
const hospital = categoriesFor('hospital');

test('keywords in Hindi, Tamil and Bengali find the right category', () => {
  assert.equal(triageByRules('मिक्सर के पास बिजली का तार खुला है', construction).category, 'electrical');
  assert.equal(triageByRules('வார்டு 4-ல் ஊசி தொட்டி நிரம்பி வழிகிறது', hospital).category, 'needle');
  assert.equal(triageByRules('গত রবিবারের মজুরি পাইনি', construction).category, 'pay');
});

test("the worker's own choice of category always wins", () => {
  assert.equal(triageByRules('wire hanging loose', construction, 'heat').category, 'heat');
});

test('signs of injury escalate to critical in any language', () => {
  assert.equal(triageByRules('He fell, there is blood', construction).severity, 'critical');
  assert.equal(triageByRules('मजदूर बेहोश हो गया', construction).severity, 'critical');
});

test('unknown text becomes "other" with low severity', () => {
  assert.deepEqual(triageByRules('the canteen menu', construction), { category: 'other', severity: 'low' });
});

test('severity can only go up when combining rules and AI', () => {
  assert.equal(maxSeverity('high', 'low'), 'high');
  assert.equal(maxSeverity('medium', 'critical'), 'critical');
  assert.equal(maxSeverity('medium', undefined), 'medium');
});

test('critical issues are overdue after 2 hours if nobody responds', () => {
  const now = Date.now();
  assert.equal(isOverdue({ status: 'open', severity: 'critical', createdAt: now - 3 * 3_600_000 }, now), true);
  assert.equal(isOverdue({ status: 'acknowledged', severity: 'critical', createdAt: now - 3 * 3_600_000 }, now), false);
  assert.equal(isOverdue({ status: 'open', severity: 'low', createdAt: now - 3 * 3_600_000 }, now), false);
});

test('queue order: open first, then most severe, then oldest', () => {
  const list = [
    { status: 'resolved', severity: 'critical', createdAt: 1 },
    { status: 'open', severity: 'medium', createdAt: 1 },
    { status: 'open', severity: 'critical', createdAt: 5 },
    { status: 'open', severity: 'critical', createdAt: 2 },
  ].sort(compareIssues);
  assert.deepEqual(list.map((i) => `${i.status}:${i.severity}:${i.createdAt}`), [
    'open:critical:2', 'open:critical:5', 'open:medium:1', 'resolved:critical:1',
  ]);
});
