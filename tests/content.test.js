import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDeck, pluralDistractors, prepositionDistractors, withUmlaut } from '../src/content.js';

const nouns = JSON.parse(readFileSync(new URL('../vocab/nouns.json', import.meta.url)));
const preps = JSON.parse(readFileSync(new URL('../vocab/prepositions.json', import.meta.url)));
const deck = buildDeck(nouns, preps);

test('deck sizes match the Android app (318 nouns, 175 prepositions)', () => {
  assert.equal(deck.article.length, 318); assert.equal(deck.plural.length, 318); assert.equal(deck.preposition.length, 175);
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
