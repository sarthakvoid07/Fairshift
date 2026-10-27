import { oneDecimal } from './time.js';

/** Results stay hidden until this many people answer, so nobody can be singled out. */
export const MIN_GROUP = 3;
export const DIMENSIONS = ['respect', 'safety', 'pay', 'workload'];

export function aggregateFeedback(entries) {
  if (entries.length < MIN_GROUP) return { count: entries.length, hidden: true, minGroup: MIN_GROUP };

  const averages = {};
  for (const dim of DIMENSIONS) {
    averages[dim] = oneDecimal(entries.reduce((sum, e) => sum + e.ratings[dim], 0) / entries.length);
  }
  const overall = oneDecimal(DIMENSIONS.reduce((sum, d) => sum + averages[d], 0) / DIMENSIONS.length);
  return {
    count: entries.length,
    hidden: false,
    averages,
    overall,
    comments: entries.map((e) => e.comment).filter(Boolean),
  };
}
