import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFeedback, MIN_GROUP } from '../src/domain/feedback.js';

const entry = (r, comment = null) => ({ ratings: { respect: r, safety: r, pay: r, workload: r }, comment });

test('results stay hidden below the anonymity threshold, without leaking scores', () => {
  const result = aggregateFeedback([entry(1, 'bad boss'), entry(2)]);
  assert.equal(result.hidden, true);
  assert.equal(result.count, 2);
  assert.equal(result.averages, undefined);
  assert.equal(result.comments, undefined);
  assert.equal(MIN_GROUP, 3);
});

test('averages are shown once enough people answer', () => {
  const result = aggregateFeedback([entry(2, 'late pay'), entry(3), entry(5)]);
  assert.equal(result.hidden, false);
  assert.equal(result.averages.pay, 3.3);
  assert.equal(result.overall, 3.3);
  assert.deepEqual(result.comments, ['late pay']);
});
