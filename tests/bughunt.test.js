// Found by the first maintenance review (see ~/dev/QuizApp/docs/TESTES-AUTOMATIZADOS.md): the web twin behaves like the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldForSearch, dailyProgress, clampDailyGoal, MAX_DAILY_GOAL, MIN_DAILY_GOAL } from '../src/domain.js';

test('search folds the sharp s to ss and still ignores case and umlauts', () => {
  assert.ok(foldForSearch('Straße').includes(foldForSearch('strasse')));
  assert.ok(foldForSearch('Stühle').includes(foldForSearch('STUHLE')));
});

test('the bar fraction is defined for a zero goal (empty without answers, full with any)', () => {
  assert.equal(dailyProgress({}, 5, 0).fraction, 0);
  assert.equal(dailyProgress({ 5: 3 }, 5, 0).fraction, 1);
  assert.equal(dailyProgress({ 5: 3 }, 5, 30).fraction, 0.1);
});

test('stored goals snap to 10..100 even for absurd values', () => {
  assert.equal(clampDailyGoal(Number.MAX_SAFE_INTEGER), MAX_DAILY_GOAL);
  assert.equal(clampDailyGoal(-1e12), MIN_DAILY_GOAL);
  assert.equal(clampDailyGoal(15), 20);
});

// ---- backup import must behave like the app's decodeBackup (PE-3, WB-1) ----
import { StudyController, createMemoryStore } from '../src/controller.js';

const card = (id) => ({ id, mode: 'article', prompt: id, context: null, choices: ['a', 'b'], correctChoice: 'a', explanation: '', shuffleChoices: false, hint: null });
const deck = { article: [card('a1'), card('a2')], preposition: [card('p1')], plural: [card('l1')], preterite: [card('v1')], errors: [card('e1')] };
const fresh = () => new StudyController(deck, createMemoryStore(), () => new Date(2026, 9, 24, 10).getTime());
const good = (extra = {}) => ({ app: 'german-quiz-web', version: 1, progress: {}, history: {}, dailyGoal: 20, ...extra });

test('a backup whose progress or history is null or a list is refused, not half-imported', () => {
  for (const bad of [{ progress: null }, { history: null }, { progress: [] }, { history: [1, 2] }, { progress: 'x' }]) {
    const c = fresh();
    assert.throws(() => c.importData(good(bad)), /not a German Quiz backup/, JSON.stringify(bad));
    assert.deepEqual(c.progress, {}, 'nothing was replaced');
  }
});

test('import drops progress entries whose key differs from the card id and history counts that are not positive', () => {
  const c = fresh();
  const p = (id) => ({ cardId: id, phase: 'NEW', repetitions: 0 });
  c.importData(good({ progress: { a1: p('a1'), a2: p('zzz') }, history: { 20000: 5, 20001: 0, 20002: -3, 20003: 'x' } }));
  assert.deepEqual(Object.keys(c.progress), ['a1']);
  assert.deepEqual(c.history, { 20000: 5 });
});

test('a backup from a newer format is refused', () => {
  const c = fresh();
  assert.throws(() => c.importData(good({ version: 2 })), /newer|not a German Quiz backup/);
});

test('the imported goal is snapped onto the grid, and a missing goal keeps the current one', () => {
  const c = fresh();
  c.importData(good({ dailyGoal: 47 }));
  assert.equal(c.store.loadGoal(), 50);
  c.importData(good({ dailyGoal: undefined }));
  assert.equal(c.store.loadGoal(), 50);
});
