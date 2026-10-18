import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTE_MILLIS, DAY_MILLIS, SCHEDULER, freshProgress, scheduleNext, gradeAnswer,
  isAvailableAt, statusAt, withSuspension, restored, searchManagedCards, interleave, buildQueue,
  startSession, answer, advance, choicesFor, currentCard,
  epochDayOf, currentStreak, longestStreak, buildCalendar, heatColorRgb, clampDailyGoal, plusAnswer, dailyProgress,
} from '../src/domain.js';

const now = 1_000_000_000;
const next = (p, g, at = now) => scheduleNext(p, g, at);
const fresh = () => freshProgress('c');
const review = (interval, ease = 2.5) => ({ ...fresh(), phase: 'REVIEW', intervalDays: interval, easeFactor: ease, firstSeenAtMillis: 1 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('new card AGAIN starts learning at step 0', () => {
  const p = next(fresh(), 'AGAIN');
  assert.equal(p.phase, 'LEARNING'); assert.equal(p.learningStep, 0);
  assert.equal(p.dueAtMillis, now + MINUTE_MILLIS);
});
test('two GOODs graduate to one day', () => {
  const a = next(fresh(), 'GOOD');
  assert.equal(a.phase, 'LEARNING'); assert.equal(a.dueAtMillis, now + 10 * MINUTE_MILLIS);
  const b = next(a, 'GOOD');
  assert.equal(b.phase, 'REVIEW'); assert.equal(b.intervalDays, 1); assert.equal(b.dueAtMillis, now + DAY_MILLIS);
});
test('EASY on new graduates to the easy interval', () => {
  const p = next(fresh(), 'EASY');
  assert.equal(p.phase, 'REVIEW'); assert.equal(p.intervalDays, SCHEDULER.easyIntervalDays);
});
test('HARD keeps the learning step', () => assert.equal(next(next(fresh(), 'GOOD'), 'HARD').learningStep, 1));
test('review GOOD multiplies by ease', () => {
  const p = next(review(10), 'GOOD'); assert.equal(p.intervalDays, 25); near(p.easeFactor, 2.5);
});
test('review HARD shrinks ease and grows slowly', () => {
  const p = next(review(10), 'HARD'); assert.equal(p.intervalDays, 12); near(p.easeFactor, 2.35);
});
test('review EASY grows most and raises ease', () => {
  const p = next(review(10), 'EASY'); assert.equal(p.intervalDays, 33); near(p.easeFactor, 2.65);
});
test('lapse goes to relearning and lowers ease', () => {
  const p = next(review(30), 'AGAIN');
  assert.equal(p.phase, 'RELEARNING'); assert.equal(p.lapses, 1); near(p.easeFactor, 2.3);
  assert.equal(p.intervalDays, 1); assert.equal(p.dueAtMillis, now + 10 * MINUTE_MILLIS);
});
test('relearning GOOD returns to review', () => {
  const back = next(next(review(30), 'AGAIN'), 'GOOD');
  assert.equal(back.phase, 'REVIEW'); assert.equal(back.dueAtMillis, now + back.intervalDays * DAY_MILLIS);
});
test('ease never drops below the minimum', () => {
  let p = review(5, 1.35);
  for (let i = 0; i < 5; i++) p = next({ ...p, phase: 'REVIEW' }, 'AGAIN');
  assert.ok(p.easeFactor >= SCHEDULER.minimumEase);
});
test('interval is capped', () => assert.equal(next(review(30_000, 3.0), 'EASY').intervalDays, SCHEDULER.maximumIntervalDays));
test('firstSeen is set once and repetitions count', () => {
  const b = next(next(fresh(), 'GOOD', 5), 'GOOD', 99);
  assert.equal(b.firstSeenAtMillis, 5); assert.equal(b.repetitions, 2);
});

test('grader', () => {
  assert.equal(gradeAnswer(false, 500, 'REVIEW'), 'AGAIN');
  assert.equal(gradeAnswer(true, 12_000, 'REVIEW'), 'HARD');
  assert.equal(gradeAnswer(true, 1_000, 'REVIEW'), 'EASY');
  assert.equal(gradeAnswer(true, 1_000, 'LEARNING'), 'GOOD');
  assert.equal(gradeAnswer(true, 5_000, 'REVIEW'), 'GOOD');
});

test('suspension: week, month, permanent, restore', () => {
  const p = fresh();
  const week = withSuspension(p, 'ONE_WEEK', now);
  assert.ok(!isAvailableAt(week, now)); assert.ok(isAvailableAt(week, now + 7 * DAY_MILLIS));
  assert.equal(statusAt(week, now), 'SUSPENDED'); assert.equal(statusAt(week, now + 8 * DAY_MILLIS), null);
  const gone = withSuspension(p, 'PERMANENT', now);
  assert.ok(!isAvailableAt(gone, now + 1000 * DAY_MILLIS)); assert.equal(statusAt(gone, now), 'REMOVED');
  const back = restored({ ...gone, repetitions: 4 });
  assert.ok(isAvailableAt(back, now)); assert.equal(back.repetitions, 4);
});
test('search ignores case and umlauts', () => {
  const items = [{ card: { id: 'plural:Stuhl', prompt: 'der Stuhl', context: null, explanation: 'der Stuhl → die Stühle' }, status: 'REMOVED' }];
  assert.equal(searchManagedCards(items, 'STUHLE').length, 1);
  assert.equal(searchManagedCards(items, 'tisch').length, 0);
  assert.equal(searchManagedCards(items, '  ').length, 1);
});

const card = (id, shuffle = false) => ({ id, mode: 'article', prompt: id, context: null, choices: ['a', 'b', 'c'], correctChoice: 'a', explanation: '', shuffleChoices: shuffle, hint: null });
const cards = ['x', 'y', 'z', 'w'].map((i) => card(i));

test('unseen deck offers every new card', () => {
  const q = buildQueue(cards, {}, now);
  assert.equal(q.cards.length, 4); assert.equal(q.stats.newAvailable, 4);
});
test('due reviews overdue-first, future excluded, suspended skipped', () => {
  const rev = (id, due) => ({ ...freshProgress(id), phase: 'REVIEW', intervalDays: 3, dueAtMillis: due });
  const prog = { x: rev('x', now - 10), y: rev('y', now - 99), z: rev('z', now + 5), w: withSuspension(rev('w', now - 1), 'ONE_WEEK', now) };
  const q = buildQueue(cards, prog, now);
  assert.deepEqual(q.cards.map((c) => c.id), ['y', 'x']);
});
test('learning cards come first and the learn-ahead window applies', () => {
  const lrn = (id, due) => ({ ...freshProgress(id), phase: 'LEARNING', dueAtMillis: due });
  const prog = { x: lrn('x', now + 19 * MINUTE_MILLIS), y: lrn('y', now + 21 * MINUTE_MILLIS) };
  const q = buildQueue(cards, prog, now);
  assert.equal(q.cards[0].id, 'x'); assert.ok(!q.cards.some((c) => c.id === 'y'));
});
test('interleave slots extras after every N main items', () => {
  assert.deepEqual(interleave([1, 2, 3, 4, 5, 6], ['a', 'b'], 3), [1, 2, 3, 'a', 4, 5, 6, 'b']);
  assert.deepEqual(interleave([1], ['a', 'b'], 3), [1, 'a', 'b']);
  assert.deepEqual(interleave([], ['a'], 3), ['a']);
});

const start = (list = cards, prog = {}, seed = 1) => startSession('article', buildQueue(list, prog, now), prog, now, seed);
test('correct answer scores and schedules learning; learning card is requeued', () => {
  const s = answer(start(), 'a', now + 3000);
  assert.equal(s.correctCount, 1); assert.equal(s.lastAnswer.grade, 'GOOD');
  assert.equal(s.queue.length, 5);
});
test('wrong answer counts and is AGAIN', () => {
  const s = answer(start(), 'b', now + 3000);
  assert.equal(s.wrongCount, 1); assert.equal(s.lastAnswer.grade, 'AGAIN');
});
test('duplicate or invalid answers are ignored; advance needs an answer', () => {
  const s = start();
  assert.equal(answer(s, 'zzz', now), s);
  const a = answer(s, 'a', now);
  assert.equal(answer(a, 'b', now), a);
  assert.equal(advance(s, now), s);
  assert.equal(advance(a, now).queue.length, 4);
});
test('mature card leaves the session after a GOOD answer', () => {
  const prog = { x: { ...freshProgress('x'), phase: 'REVIEW', intervalDays: 5, dueAtMillis: now - 1 } };
  const s = start([card('x')], prog);
  const a = advance(answer(s, 'a', now + 5000), now + 5000);
  assert.ok(a.queue.length === 0);
});
test('shuffled choices are stable, do not move during feedback, and stay a permutation', () => {
  const s = start([card('x', true)], {}, 42);
  assert.deepEqual(choicesFor(s), choicesFor(s));
  const during = choicesFor(answer(s, 'a', now + 100));
  assert.deepEqual(during, choicesFor(s));
  assert.deepEqual([...during].sort(), ['a', 'b', 'c']);
  assert.equal(currentCard(s).id, 'x');
});

test('daily goal snaps to the slider grid', () => {
  assert.equal(clampDailyGoal(4), 10); assert.equal(clampDailyGoal(24), 20); assert.equal(clampDailyGoal(25), 30); assert.equal(clampDailyGoal(500), 100);
});
test('streaks', () => {
  const today = 100;
  const h = (...days) => Object.fromEntries(days.map((d) => [d, 1]));
  assert.equal(currentStreak(h(98, 99, 100), today), 3);
  assert.equal(currentStreak(h(98, 99), today), 2);
  assert.equal(currentStreak(h(97, 99), today), 1);
  assert.equal(currentStreak(h(90, 91, 92, 98, 99), today), 2);
  assert.equal(longestStreak(h(90, 91, 92, 98, 99)), 3);
});
test('calendar: Monday-first layout and month totals (Oct 2026 starts on Thursday)', () => {
  const today = Math.floor(Date.UTC(2026, 9, 18) / DAY_MILLIS);
  const oct1 = Math.floor(Date.UTC(2026, 9, 1) / DAY_MILLIS);
  const history = { [oct1]: 5, [today]: 20 };
  const cal = buildCalendar(history, { year: 2026, month: 9 }, today);
  assert.equal(cal.leadingBlanks, 3); assert.equal(cal.days.length, 31);
  assert.equal(cal.trainedDaysInMonth, 2); assert.equal(cal.answersInMonth, 25);
  assert.ok(cal.days[17].isToday); assert.ok(cal.days[18].isFuture); assert.ok(!cal.canGoNext);
  assert.ok(buildCalendar(history, { year: 2026, month: 8 }, today).canGoNext);
  assert.equal(buildCalendar({}, { year: 2024, month: 1 }, today).days.length, 29);
});
test('heat ramp starts light yellow and ends orange-red', () => {
  assert.equal(heatColorRgb(0), 0xFFF4B5); assert.equal(heatColorRgb(100), 0xE4401C); assert.equal(heatColorRgb(500), 0xE4401C);
  let prevGreen = 256;
  for (let n = 0; n <= 100; n += 5) { const g = (heatColorRgb(n) >> 8) & 255; assert.ok(g <= prevGreen); prevGreen = g; }
});
test('plusAnswer and dailyProgress', () => {
  const h = plusAnswer(plusAnswer({}, 7), 7);
  const d = dailyProgress(h, 7, 2);
  assert.equal(d.answered, 2); assert.ok(d.reached); assert.equal(dailyProgress({}, 7, 20).fraction, 0);
});
test('epochDayOf follows the local calendar date', () => {
  const d = new Date(2026, 9, 18, 23, 59).getTime();
  assert.equal(epochDayOf(d), Math.floor(Date.UTC(2026, 9, 18) / DAY_MILLIS));
});
