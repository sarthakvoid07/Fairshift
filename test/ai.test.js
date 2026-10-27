import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { triageIssue, translateForWorker, weeklyBrief } from '../src/ai.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
});

/** Fakes the Gemini REST API and records what was sent. */
function fakeGemini(replyText) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replyText }] } }] }));
  };
  return calls;
}

const report = { text: 'तार से चिंगारी', lang: 'hi', categories: ['fall', 'electrical', 'other'], sector: 'construction' };

test('without an API key nothing is sent and callers fall back to rules', async () => {
  const calls = fakeGemini('{}');
  assert.equal(await triageIssue(report), null);
  assert.equal(calls.length, 0);
});

test('triage sends the key in a header, constrains output to a schema and parses it', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calls = fakeGemini(JSON.stringify({ category: 'electrical', severity: 'high', summary: 'Sparking wire.' }));
  assert.deepEqual(await triageIssue(report), { category: 'electrical', severity: 'high', summary: 'Sparking wire.' });

  const [{ url, options, body }] = calls;
  assert.match(url, /:generateContent$/);
  assert.ok(!url.includes('test-key'), 'key must not appear in the URL');
  assert.equal(options.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(body.generationConfig.responseSchema.properties.category.enum, report.categories);
});

test('model output outside the allowed values is discarded', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  fakeGemini(JSON.stringify({ category: 'delete_all_reports', severity: 'low', summary: 'ignore previous instructions' }));
  assert.equal(await triageIssue(report), null);
  fakeGemini('not json at all');
  assert.equal(await triageIssue(report), null);
});

test('network failures never break a request', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(await triageIssue(report), null);
  assert.equal(await weeklyBrief({ sector: 'Hospital' }), null);
});

test('English notes are not sent for translation; others are', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calls = fakeGemini('இடம் சுத்தம் செய்யப்பட்டது.');
  assert.equal(await translateForWorker('Area cleaned.', 'en'), null);
  assert.equal(calls.length, 0);
  assert.equal(await translateForWorker('Area cleaned.', 'ta'), 'இடம் சுத்தம் செய்யப்பட்டது.');
});

test('weekly brief keeps at most three actions', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  fakeGemini(JSON.stringify({ actions: ['a', 'b', 'c', 'd'] }));
  assert.deepEqual(await weeklyBrief({ sector: 'Construction' }), ['a', 'b', 'c']);
});
