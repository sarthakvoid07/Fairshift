import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, LANG_NAMES, SPEECH_LANG } from '../public/js/i18n.js';
import { SECTORS, LANGS } from '../src/domain/sectors.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language translates every key with the same placeholders', () => {
  const keys = Object.keys(STRINGS.en);
  for (const lang of Object.keys(STRINGS)) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), [...keys].sort(), `${lang} keys differ from English`);
    for (const key of keys) {
      assert.ok(STRINGS[lang][key].trim(), `${lang}.${key} is empty`);
      assert.deepEqual(placeholders(STRINGS[lang][key]), placeholders(STRINGS.en[key]), `${lang}.${key} placeholders`);
    }
  }
});

test('server and client agree on supported languages, each with a voice', () => {
  assert.deepEqual(Object.keys(STRINGS).sort(), [...LANGS].sort());
  for (const lang of LANGS) {
    assert.ok(LANG_NAMES[lang]);
    assert.match(SPEECH_LANG[lang], /^[a-z]{2}-IN$/);
  }
});

test('every hazard in every sector has a translated label', () => {
  const categories = new Set([...Object.values(SECTORS).flatMap((s) => s.hazards), 'pay']);
  for (const c of categories) assert.ok(STRINGS.en[`cat_${c}`], `missing cat_${c}`);
});
