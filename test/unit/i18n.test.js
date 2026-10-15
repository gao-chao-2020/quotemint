import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LANGS, clientStrings } from '../../src/templates/i18n.js';

test('every dictionary key exists in both languages', () => {
  assert.deepEqual(LANGS, ['en', 'zh']);
  const missingZh = Object.keys(DICTS.en).filter((key) => !(key in DICTS.zh));
  const missingEn = Object.keys(DICTS.zh).filter((key) => !(key in DICTS.en));
  assert.deepEqual(missingZh, [], `keys missing from zh: ${missingZh.slice(0, 10).join(', ')}`);
  assert.deepEqual(missingEn, [], `keys missing from en: ${missingEn.slice(0, 10).join(', ')}`);

  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(DICTS[lang])) {
      assert.equal(typeof value, 'string', `${lang}["${key}"] must be a string`);
      assert.ok(value.length > 0, `${lang}["${key}"] must not be empty`);
    }
  }
});

test('every clientStrings() key resolves in both languages', () => {
  const keys = Object.keys(clientStrings('en'));
  assert.ok(keys.length > 0, 'clientStrings must expose at least one key');
  for (const lang of LANGS) {
    for (const key of keys) {
      assert.equal(typeof DICTS[lang][key], 'string', `client key "${key}" missing from the ${lang} dictionary`);
    }
  }
});
