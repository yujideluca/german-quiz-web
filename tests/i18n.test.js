// REQ LG-1 WB-1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../src/strings.js';
import {
  createTranslator, resolveLanguage, translateExplanation, translateHint, weekdayLetters, monthShort, NO_CONTENT_TRANSLATIONS,
} from '../src/i18n.js';

const LANGS = ['en', 'de', 'pt', 'es'];
const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort().join(',');
const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('every language has the same keys and placeholders as English', () => {
  for (const lang of LANGS.slice(1)) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), Object.keys(STRINGS.en).sort(), lang);
    for (const [key, en] of Object.entries(STRINGS.en)) assert.equal(placeholders(STRINGS[lang][key]), placeholders(en), `${lang}/${key}`);
  }
  for (const lang of LANGS) assert.ok(Object.values(STRINGS[lang]).every((s) => s.trim() !== ''), `${lang} has a blank string`);
});

test('system language follows the browser list, falls back to English, and an explicit choice wins', () => {
  assert.equal(resolveLanguage('SYSTEM', ['pt-BR', 'en']), 'pt');
  assert.equal(resolveLanguage('SYSTEM', ['fr-FR', 'de-AT']), 'de');
  assert.equal(resolveLanguage('SYSTEM', ['fr-FR']), 'en');
  assert.equal(resolveLanguage('SYSTEM', []), 'en');
  assert.equal(resolveLanguage('es', ['de']), 'es');
  assert.equal(resolveLanguage('klingon', ['de']), 'de');
});

test('the translator fills placeholders, picks plural forms and falls back to English', () => {
  const de = createTranslator('de');
  assert.equal(de('home_study', 7), 'Lernen (7)');
  assert.equal(de.plural('calendar_days', 1), '1 Tag');
  assert.equal(de.plural('calendar_days', 3), '3 Tage');
  assert.equal(createTranslator('pt')('mode_preterite_title'), 'Pretérito');
  assert.equal(createTranslator('xx')('common_done'), 'Done');
  assert.equal(createTranslator('de')('no_such_key'), 'no_such_key');
});

test('calendar names follow the language', () => {
  assert.equal(weekdayLetters('en').length, 7);
  assert.equal(weekdayLetters('en')[0], 'M');
  assert.match(monthShort('de', 9), /^Okt/);
  assert.match(monthShort('pt', 9), /^out/);
});

test('every error type, rule and hint in the data has a translation in every language', () => {
  const errors = json('../vocab/errors.json');
  const preps = json('../vocab/prepositions.json');
  for (const lang of ['de', 'pt', 'es']) {
    const tr = json(`../i18n/${lang}.json`);
    for (const e of errors) {
      assert.ok(tr.errorTypes[e.errorType], `${lang} type ${e.errorType}`);
      assert.ok(tr.rules[e.rule], `${lang} rule ${e.id}`);
    }
    for (const p of preps.filter((x) => x.hint)) assert.ok(tr.hints[p.hint], `${lang} hint ${p.hint}`);
  }
});

test('an error explanation keeps the German sentence and translates type and rule', () => {
  const tr = json('../i18n/pt.json');
  const rule = 'An action or process takes werden + Partizip II ("wird benutzt"); sein + Partizip II only describes a finished state.';
  const text = `✓ Meiner Ansicht nach wird Plastik benutzt\n\nPassive: werden, not sein: ${rule}\nRedemittel: Meiner Ansicht nach`;
  const shown = translateExplanation(tr, text);
  assert.ok(shown.startsWith('✓ Meiner Ansicht nach wird Plastik benutzt\n\n'));
  assert.ok(shown.includes('Passivo: werden, não sein: Uma ação ou processo usa werden'));
  assert.ok(shown.endsWith('\nRedemittel: Meiner Ansicht nach'));
});

test('text without a translation is shown unchanged', () => {
  const plain = 'der Tisch  ·  Plural: die Tische';
  assert.equal(translateExplanation(NO_CONTENT_TRANSLATIONS, plain), plain);
  assert.equal(translateHint(NO_CONTENT_TRANSLATIONS, 'talk about a topic'), 'talk about a topic');
  assert.equal(translateHint(json('../i18n/de.json'), 'talk about a topic'), 'über ein Thema sprechen');
});
