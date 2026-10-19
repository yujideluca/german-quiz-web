// Vocabulary -> cards, ported from the Android app's content/ package.
import { seededShuffle } from './domain.js';

const ARTICLES = ['der', 'die', 'das'];

export const PREPOSITION_POOL = [
  'auf', 'an', 'für', 'über', 'von', 'mit', 'bei', 'zu', 'nach', 'um', 'vor', 'aus', 'in', 'gegen', 'unter',
];

/** Adds an umlaut to the last umlaut-able vowel: Haus -> Häus, Hand -> Händ, Baum -> Bäum. */
export function withUmlaut(word) {
  const au = word.lastIndexOf('au');
  if (au >= 0) return word.slice(0, au) + 'äu' + word.slice(au + 2);
  let i = -1;
  for (let k = word.length - 1; k >= 0; k--) if ('aouAOU'.includes(word[k])) { i = k; break; }
  if (i < 0) return word;
  const mapped = { a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' }[word[i]];
  return word.slice(0, i) + mapped + word.slice(i + 1);
}

export function prepositionDistractors(entry, count = 3) {
  const excluded = new Set([entry.preposition, ...(entry.alsoValidPrepositions ?? [])]);
  const candidates = PREPOSITION_POOL.filter((p) => !excluded.has(p));
  return seededShuffle(candidates, `prep:${entry.headword}:${entry.preposition}`).slice(0, count);
}

export function pluralDistractors(noun, count = 3) {
  const excluded = new Set([...(noun.alsoValidPlurals ?? []), noun.plural]);
  const s = noun.singular;
  const umlauted = withUmlaut(s);
  const primary = [];
  if (s.endsWith('e')) {
    primary.push(s + 'n', s + 's', s, umlauted);
  } else {
    primary.push(s + 'e', s + 'en', s + 'er', s);
    if ('aiouy'.includes(s[s.length - 1].toLowerCase())) primary.push(s + 's'); // -s plurals follow vowels only
    if (umlauted !== s) primary.push(umlauted + 'e', umlauted + 'er', umlauted);
  }
  const ordered = seededShuffle(
    [...new Set(primary)].filter((p) => !excluded.has(p) && p.trim() !== ''), `plural:${s}`);
  const extra = [s + 'en', s + 'er', s + 'e', s + 's'].filter((p) => !excluded.has(p) && !ordered.includes(p));
  return [...ordered, ...extra].slice(0, count);
}

/** The form a learner would build by treating the verb as regular: gehen -> gehte, finden -> findete. */
export function weakPreterite(infinitive) {
  const stem = infinitive.endsWith('en') ? infinitive.slice(0, -2) : infinitive.slice(0, -1);
  const last = stem[stem.length - 1];
  const before = stem[stem.length - 2] ?? '';
  const needsE = 'td'.includes(last) || (stem.length > 1 && 'mn'.includes(last) && before !== last && !'aeiouäöülrh'.includes(before));
  return stem + (needsE ? 'ete' : 'te');
}

/**
 * Wrong Präteritum forms a learner might produce: the regularised weak form first (the typical mistake),
 * then other forms of the same verb. "ge" + Partizip II fills the gap when forms coincide (telefoniert).
 */
export function preteriteDistractors(verb, count = 3) {
  const participle = verb.perfect.slice(verb.perfect.indexOf(' ') + 1);
  const others = seededShuffle(
    [...new Set([participle, verb.present, verb.infinitive])].filter((f) => f !== verb.preterite), `preterite:${verb.infinitive}`);
  const weak = weakPreterite(verb.infinitive);
  return [...new Set([...(weak !== verb.preterite ? [weak] : []), ...others, `ge${participle}`])].slice(0, count);
}

function makeCard(card) {
  if (!card.choices.includes(card.correctChoice)) {
    throw new Error(`Card ${card.id}: correct choice '${card.correctChoice}' not in ${card.choices}`);
  }
  if (new Set(card.choices).size !== card.choices.length) {
    throw new Error(`Card ${card.id}: duplicate choices ${card.choices}`);
  }
  return { context: null, hint: null, ...card };
}

export const articleCard = (noun) => makeCard({
  id: `article:${noun.singular}`,
  mode: 'article',
  prompt: noun.singular,
  choices: ARTICLES,
  correctChoice: noun.article,
  explanation: `${noun.article} ${noun.singular}  ·  Plural: die ${noun.plural}`,
  shuffleChoices: false,
});

export const pluralCard = (noun) => makeCard({
  id: `plural:${noun.singular}`,
  mode: 'plural',
  prompt: `${noun.article} ${noun.singular}`,
  context: 'Plural: die ___',
  choices: seededShuffle([noun.plural, ...pluralDistractors(noun)], `plural-order:${noun.singular}`),
  correctChoice: noun.plural,
  explanation: `${noun.article} ${noun.singular}  →  die ${noun.plural}`,
  shuffleChoices: true,
});

export function prepositionCard(entry) {
  const caseName = entry.case === 'A' ? 'Akkusativ' : 'Dativ';
  return makeCard({
    id: `preposition:${entry.headword}:${entry.preposition}`,
    mode: 'preposition',
    prompt: entry.headword,
    context: entry.sentence,
    choices: [entry.preposition, ...prepositionDistractors(entry)],
    correctChoice: entry.preposition,
    explanation: `${entry.headword} + ${entry.preposition}  (${caseName})`,
    shuffleChoices: true,
    hint: entry.hint ?? null,
  });
}

export const preteriteCard = (verb) => makeCard({
  id: `preterite:${verb.infinitive}`,
  mode: 'preterite',
  prompt: verb.infinitive,
  context: 'Präteritum: er/sie/es ___',
  choices: seededShuffle([verb.preterite, ...preteriteDistractors(verb)], `preterite-order:${verb.infinitive}`),
  correctChoice: verb.preterite,
  explanation: `${verb.infinitive}  –  ${verb.preterite}  –  ${verb.perfect}`,
  shuffleChoices: true,
});

export const buildDeck = (nouns, prepositions, verbs = []) => ({
  article: nouns.map(articleCard),
  plural: nouns.map(pluralCard),
  preposition: prepositions.map(prepositionCard),
  preterite: verbs.map(preteriteCard),
});
