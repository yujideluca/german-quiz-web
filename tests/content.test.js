import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODES } from '../src/domain.js';
import { buildDeck, errorCard, pluralDistractors, prepositionDistractors, preteriteDistractors, weakPreterite, withUmlaut } from '../src/content.js';

const nouns = JSON.parse(readFileSync(new URL('../vocab/nouns.json', import.meta.url)));
const preps = JSON.parse(readFileSync(new URL('../vocab/prepositions.json', import.meta.url)));
const verbs = JSON.parse(readFileSync(new URL('../vocab/verbs.json', import.meta.url)));
const errors = JSON.parse(readFileSync(new URL('../vocab/errors.json', import.meta.url)));
const deck = buildDeck(nouns, preps, verbs, errors);

test('deck sizes match the Android app (484 nouns, 309 prepositions, 253 verbs)', () => {
  assert.equal(deck.article.length, 484); assert.equal(deck.plural.length, 484); assert.equal(deck.preposition.length, 309);
  assert.equal(deck.preterite.length, 253);
});
test('card ids are unique across the deck', () => {
  const ids = Object.values(deck).flat().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
test('article cards offer exactly der, die, das', () => {
  deck.article.forEach((c) => assert.deepEqual(c.choices, ['der', 'die', 'das']));
});
test('plural cards have four distinct choices including the correct one', () => {
  deck.plural.forEach((c) => { assert.equal(c.choices.length, 4); assert.ok(c.choices.includes(c.correctChoice)); });
});
test('plural distractors never contain an accepted plural', () => nouns.forEach((n) => {
  const bad = new Set([n.plural, ...n.alsoValidPlurals]);
  pluralDistractors(n).forEach((d) => assert.ok(!bad.has(d), `${n.singular}: ${d}`));
}));
test('preposition distractors never contain a valid answer; every card has 4 choices', () => preps.forEach((p, i) => {
  const bad = new Set([p.preposition, ...p.alsoValidPrepositions]);
  prepositionDistractors(p).forEach((d) => assert.ok(!bad.has(d)));
  assert.equal(deck.preposition[i].choices.length, 4);
}));
test('headwords with several prepositions carry a hint on each card', () => {
  const byHead = Map.groupBy(deck.preposition, (c) => c.prompt);
  for (const [head, group] of byHead) if (group.length > 1) group.forEach((c) => assert.ok(c.hint, `${head} lacks a hint`));
});
test('distractors are deterministic', () => {
  assert.deepEqual(pluralDistractors(nouns[0]), pluralDistractors(nouns[0]));
  assert.deepEqual(prepositionDistractors(preps[0]), prepositionDistractors(preps[0]));
});
test('umlaut rules', () => {
  assert.equal(withUmlaut('Haus'), 'Häus'); assert.equal(withUmlaut('Hand'), 'Händ');
  assert.equal(withUmlaut('Baum'), 'Bäum'); assert.equal(withUmlaut('Stuhl'), 'Stühl'); assert.equal(withUmlaut('Tisch'), 'Tisch');
});
test('every sentence has exactly one blank', () => preps.forEach((p) => assert.equal(p.sentence.split('___').length - 1, 1, p.sentence)));
test('preterite cards have four distinct choices and include the regularised mistake', () => verbs.forEach((v, i) => {
  const c = deck.preterite[i];
  assert.equal(c.choices.length, 4, v.infinitive);
  assert.equal(c.correctChoice, v.preterite);
  const weak = weakPreterite(v.infinitive);
  if (weak !== v.preterite) assert.ok(c.choices.includes(weak), `${v.infinitive}: ${weak} missing`);
}));
test('preterite distractors are other forms of the same verb, never the answer', () => verbs.forEach((v) => {
  const participle = v.perfect.split(' ')[1];
  const forms = new Set([weakPreterite(v.infinitive), participle, v.present, v.infinitive, `ge${participle}`]);
  preteriteDistractors(v).forEach((d) => { assert.ok(forms.has(d), `${v.infinitive}: ${d}`); assert.notEqual(d, v.preterite); });
}));
test('weak preterite follows the regular pattern', () => {
  assert.equal(weakPreterite('gehen'), 'gehte'); assert.equal(weakPreterite('finden'), 'findete');
  assert.equal(weakPreterite('arbeiten'), 'arbeitete'); assert.equal(weakPreterite('nehmen'), 'nehmte');
  assert.equal(weakPreterite('kommen'), 'kommte'); assert.equal(weakPreterite('machen'), 'machte');
});

test('Fehler finden: 121 sentences, chunks stay in order and the wrong chunk is the answer', () => {
  assert.equal(deck.errors.length, 121);
  deck.errors.forEach((c) => {
    const entry = errors.find((e) => `error:${e.id}` === c.id);
    assert.deepEqual(c.choices, entry.segments);
    assert.equal(c.correctChoice, entry.segments[entry.errorIndex]);
    assert.equal(c.shuffleChoices, false);
  });
});
test('Fehler finden: explanation shows the corrected sentence, the rule and the Redemittel', () => {
  const card = errorCard(errors.find((e) => e.id === 'F01'));
  assert.ok(card.explanation.startsWith('✓ Meiner Ansicht nach wird Plastik heute viel zu oft benutzt'));
  assert.ok(card.explanation.includes('Redemittel: Meiner Ansicht nach'));
  assert.ok(!card.explanation.split('\n')[0].includes(card.correctChoice));
});
test('Fehler finden: new sentences are mixed (not one error type in a row) and the mode waits for a Next tap', () => {
  const types = new Set(deck.errors.slice(0, 10).map((c) => errors.find((e) => `error:${e.id}` === c.id).errorType));
  assert.ok(types.size >= 4, [...types].join());
  assert.equal(MODES.find((m) => m.id === 'errors').autoAdvances, false);
  assert.ok(MODES.filter((m) => m.id !== 'errors').every((m) => m.autoAdvances !== false));
});
