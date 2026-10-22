// REQ DG-1 DG-2 DG-3 DG-4 DG-5
// Progress bar: hand-computed vectors shared with the Android app, boundary values and a randomised check of
// the real controller against an independent oracle (a plain tally of accepted answers per day).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StudyController, createMemoryStore } from '../src/controller.js';
import { createLocalStore } from '../src/store.js';
import { clampDailyGoal, dailyProgress, barPercent, DAY_MILLIS } from '../src/domain.js';

const doc = JSON.parse(readFileSync(new URL('./conformance/daily_bar.json', import.meta.url), 'utf8'));

test('goal snaps like the shared vectors', () => {
  for (const r of doc.goalSnap) assert.equal(clampDailyGoal(r.in), r.out, `goal ${r.in}`);
});

test('bar matches the shared vectors (fraction, percent, reached)', () => {
  for (const r of doc.bar) {
    const d = dailyProgress({ 7: r.answered }, 7, r.goal);
    const where = `${r.answered}/${r.goal}`;
    assert.ok(Math.abs(d.fraction - r.fraction) < 1e-6, `${where} fraction ${d.fraction}`);
    assert.equal(barPercent(d), r.percent, `${where} percent`);
    assert.equal(d.reached, r.reached, `${where} reached`);
  }
});

test('stored goal that is damaged or out of range falls back to a safe value', () => {
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.localStorage = ls;
  const store = createLocalStore();
  for (const bad of ['0', '-5', 'abc', 'NaN', '', '1e9', '9', '101', 'Infinity']) {
    mem.set('quiz.goal', bad);
    const g = store.loadGoal();
    assert.ok(Number.isFinite(g) && g >= 10 && g <= 100, `stored "${bad}" gave ${g}`);
  }
  mem.set('quiz.goal', '40'); assert.equal(store.loadGoal(), 40);
  delete globalThis.localStorage;
});

// small seeded generator so a failure can be replayed
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const card = (i) => ({ id: `a${i}`, mode: 'article', prompt: `w${i}`, context: null, choices: ['a', 'b'], correctChoice: 'a', explanation: '', shuffleChoices: false, hint: null });
const deck = { article: Array.from({ length: 60 }, (_, i) => card(i)), preposition: [], plural: [], preterite: [], errors: [] };

test('the bar follows the oracle in 1000 random histories', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const r = rng(seed);
    const clock = { t: new Date(2026, 9, 18, 10, 0).getTime() };
    const store = createMemoryStore();
    let c = new StudyController(deck, store, () => clock.t);
    let s = c.startSession('article');
    const tally = {}; let goal = 20;
    const dayKey = () => { const d = new Date(clock.t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    for (let step = 0; step < 80; step++) {
      const op = Math.floor(r() * 10);
      if (op <= 3) {
        const card0 = s.queue[0];
        if (card0 && !s.lastAnswer) { s = c.answer(s, r() < 0.5 ? 'a' : 'b'); tally[dayKey()] = (tally[dayKey()] ?? 0) + 1; }
      } else if (op === 4) { if (s.lastAnswer) s = c.answer(s, 'a'); }
      else if (op === 5) { if (s.lastAnswer) s = c.advance(s); }
      else if (op === 6) { c.resetAllProgress(); }
      else if (op === 7) { goal = Math.floor(r() * 450) - 50; c.setDailyGoal(goal); }
      else if (op === 8) { clock.t += Math.floor(r() * 2 * DAY_MILLIS); if (r() < 0.3) s = c.startSession('article'); }
      else { c = new StudyController(deck, store, () => clock.t); s = c.startSession('article'); }
      const expectedGoal = Math.min(100, Math.max(10, Math.round(goal / 10) * 10));
      const d = c.dailyProgress();
      const where = `seed ${seed} step ${step}`;
      assert.equal(d.answered, tally[dayKey()] ?? 0, `${where} answered`);
      assert.equal(d.goal, expectedGoal, `${where} goal`);
      assert.ok(Number.isFinite(d.fraction) && d.fraction >= 0 && d.fraction <= 1, `${where} fraction ${d.fraction}`);
      assert.equal(d.fraction, Math.min(1, d.answered / d.goal), `${where} fraction value`);
      assert.equal(d.reached, d.answered >= d.goal, `${where} reached`);
      assert.equal(d.reached, d.fraction === 1, `${where} text and bar agree`);
    }
  }
});
