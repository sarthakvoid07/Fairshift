import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteCode, siteToken, verifySiteCode, verifySiteToken } from '../src/domain/checkin.js';

const SECRET = 'test-secret';
const now = Date.parse('2026-10-27T03:00:10Z');
const MIN = 60_000;

test('a fresh QR token is accepted for its own site', () => {
  assert.equal(verifySiteToken(siteToken('skyline', SECRET, now), SECRET, now), 'skyline');
});

test('a token stays valid for about 3 minutes, then expires', () => {
  const token = siteToken('skyline', SECRET, now);
  assert.equal(verifySiteToken(token, SECRET, now + 2.5 * MIN), 'skyline');
  assert.equal(verifySiteToken(token, SECRET, now + 4 * MIN), null);
});

test('tampered, foreign or malformed tokens are rejected', () => {
  const [site, w, sig] = siteToken('skyline', SECRET, now).split('.');
  assert.equal(verifySiteToken(`citycare.${w}.${sig}`, SECRET, now), null);
  assert.equal(verifySiteToken(`${site}.${w}.${sig}`, 'other-secret', now), null);
  for (const bad of ['', 'a.b', 'x.notanumber.sig', `${site}.${Number(w) + 5}.${sig}`]) {
    assert.equal(verifySiteToken(bad, SECRET, now), null);
  }
});

test('the 6-digit fallback code works per site and expires', () => {
  const code = siteCode('skyline', SECRET, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifySiteCode('skyline', code, SECRET, now + MIN), true);
  assert.equal(verifySiteCode('citycare', code, SECRET, now), false);
  assert.equal(verifySiteCode('skyline', code, SECRET, now + 5 * MIN), false);
});
