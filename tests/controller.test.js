// REQ PE-1 PE-3 PE-4 DG-1 MG-1 QU-2 SE-3 WB-1
import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyController, createMemoryStore } from '../src/controller.js';
import { createLocalStore } from '../src/store.js';
import { DAY_MILLIS } from '../src/domain.js';

const card = (id, mode = 'article') => ({ id, mode, prompt: id, context: null, choices: ['a', 'b'], correctChoice: 'a', explanation: '', shuffleChoices: false, hint: null });
const deck = { article: [card('a1'), card('a2'), card('a3')], preposition: [card('p1', 'preposition')], plural: [card('l1', 'plural')], preterite: [card('v1', 'preterite')], errors: [card('e1', 'errors')] };
const T0 = new Date(2026, 9, 18, 10, 0).getTime();
const make = (store = createMemoryStore(), clock = { t: T0 }) => ({ c: new StudyController(deck, store, () => clock.t), store, clock });

test('overview lists every mode with new cards', () => {
  const { c } = make();
  assert.deepEqual(c.overview().map((o) => o.stats.newAvailable), [3, 1, 1, 1, 1]);
});
test('answers persist and survive a restart', () => {
  const { c, store, clock } = make();
  let s = c.startSession('article');
  s = c.answer(s, 'a');
  const again = make(store, clock).c;
  assert.equal(again.progress['a1'].repetitions, 1);
  assert.equal(again.dailyProgress().answered, 1);
});
test('answered cards come back as reviews after three days; reset clears them', () => {
  const { c, clock } = make();
  let s = c.startSession('article');
  for (let i = 0; i < 6 && s.queue.length; i++) { s = c.answer(s, 'a'); clock.t += 11 * 60_000; s = c.advance(s); }
  clock.t += 2 * DAY_MILLIS;
  assert.equal(c.overview()[0].stats.reviewsDue, 0);
  clock.t += DAY_MILLIS;
  assert.ok(c.overview()[0].stats.reviewsDue > 0);
  c.resetAllProgress();
  assert.equal(c.overview()[0].stats.newAvailable, 3);
});
test('answers in any quiz count toward the same goal; the queue is not capped', () => {
  const { c } = make();
  c.setDailyGoal(10);
  for (const m of ['article', 'preposition']) { let s = c.startSession(m); s = c.answer(s, 'a'); }
  assert.equal(c.dailyProgress().answered, 2); assert.equal(c.dailyProgress().goal, 10);
  assert.equal(c.overview()[0].stats.newAvailable, 2);
});
test('day count resets on a new day, history is kept, goal snaps to the grid', () => {
  const { c, clock } = make();
  c.answer(c.startSession('article'), 'a');
  clock.t += DAY_MILLIS;
  assert.equal(c.dailyProgress().answered, 0);
  c.setDailyGoal(33); assert.equal(c.dailyProgress().goal, 30);
  const cal = c.calendar(c.currentMonth());
  assert.equal(cal.trainedDaysInMonth, 1); assert.equal(cal.currentStreak, 1);
});
test('suspended card leaves session and pool, survives restart, expires after a week', () => {
  const { c, store, clock } = make();
  let s = c.startSession('article');
  s = c.suspendCurrentCard(s, 'ONE_WEEK');
  assert.ok(!s.queue.some((x) => x.id === 'a1'));
  assert.equal(make(store, clock).c.overview()[0].stats.newAvailable, 2);
  assert.deepEqual(c.managedCounts(), { suspended: 1, removed: 0 });
  clock.t += 8 * DAY_MILLIS;
  assert.equal(c.overview()[0].stats.newAvailable, 3);
});
test('reset suspended leaves removed alone; single card can be found and restored', () => {
  const { c } = make();
  let s = c.startSession('article');
  s = c.suspendCurrentCard(s, 'ONE_MONTH');
  s = c.suspendCurrentCard(s, 'PERMANENT');
  c.restoreAll('SUSPENDED');
  assert.deepEqual(c.managedCounts(), { suspended: 0, removed: 1 });
  assert.equal(c.managedCards('A2').length, 1);
  c.restoreCard('a2');
  assert.deepEqual(c.managedCounts(), { suspended: 0, removed: 0 });
});
test('export/import round-trips and rejects foreign files', () => {
  const { c } = make();
  c.answer(c.startSession('article'), 'a');
  const backup = JSON.parse(JSON.stringify(c.exportData()));
  const other = make().c;
  other.importData(backup);
  assert.equal(other.progress['a1'].repetitions, 1);
  assert.equal(other.dailyProgress().answered, 1);
  assert.throws(() => other.importData({ hello: 1 }));
});
test('local store survives a throwing storage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const s = createLocalStore(broken);
  s.saveGoal(40); assert.equal(s.loadGoal(), 40);
  s.saveProgress({ x: 1 }); assert.deepEqual(s.loadProgress(), { x: 1 });
  s.clearProgress(); assert.deepEqual(s.loadProgress(), {});
});
test('local store round-trips through a real-shaped storage', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const s = createLocalStore(st);
  assert.equal(s.loadGoal(), 20); assert.equal(s.loadTheme(), 'SYSTEM');
  s.saveHistory({ 5: 3 }); assert.deepEqual(createLocalStore(st).loadHistory(), { 5: 3 });
});
