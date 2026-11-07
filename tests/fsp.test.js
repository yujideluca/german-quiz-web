// REQ FS-1 FS-2 FS-3 FS-4 FS-5 SP-1 SP-2 WB-1
// Port of the Android app's FspCaseTest (content) and FspCaseControllerTest (scheduling of whole cases), ADR-0014.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDeck, fspCaseCard } from '../src/content.js';
import { StudyController, createMemoryStore } from '../src/controller.js';
import { DAY_MILLIS, MINUTE_MILLIS, MODES, answer, startSession } from '../src/domain.js';
import {
  FSP_FAILED, FSP_PASSED, checkFspCase, fspGrade, fspPassed, isRunFinished, nextStep, partScores, pick, runOrder,
  runScore, startRun,
} from '../src/fsp.js';

const cases = JSON.parse(readFileSync(new URL('../vocab/fsp_cases.json', import.meta.url), 'utf8'));
const PART_SIZES = { 1: 16, 2: 7, 3: 11 };
const fileCase = cases[0];
const run = () => startRun(fileCase, 42);
const wrongOf = (step) => [0, 1, 2, 3].find((i) => i !== step.answer);

/** Plays a case with the first `firstTryRight` steps right at the first pick and every later one wrong first. */
function play(r, firstTryRight) {
  r.case.steps.forEach((s, i) => {
    if (i >= firstTryRight) r = pick(r, wrongOf(s));
    r = nextStep(pick(r, s.answer));
  });
  return r;
}

// ---- content (FspCaseTest) -------------------------------------------------------------------------------------

test('FSP mode: id fsp, waits for a tap, one card per case in file order', () => {
  assert.equal(MODES.find((m) => m.id === 'fsp').autoAdvances, false);
  const deck = buildDeck([], [], [], [], cases);
  assert.deepEqual(deck.fsp.map((c) => c.id), cases.map((c) => `fsp:${c.id}`));
  const card = deck.fsp[0];
  assert.deepEqual(card.choices, [FSP_PASSED, FSP_FAILED]);
  assert.equal(card.correctChoice, 'bestanden');
  assert.equal(card.mode, 'fsp');
  assert.equal(card.shuffleChoices, false);
  assert.equal(card.hint, fileCase.area);
  assert.equal(card.context, fileCase.patient);
});

test('cases are grouped by area of medicine: once left, an area never comes back', () => {
  const blocks = cases.map((c) => c.area).reduce((acc, a) => (acc.at(-1) === a ? acc : [...acc, a]), []);
  assert.equal(new Set(blocks).size, blocks.length);
});

test('every case follows the one template (16 + 7 + 11 steps, 5 Fachbegriffe, one right answer of 4)', () => {
  for (const c of cases) {
    const sizes = {};
    for (const s of c.steps) sizes[s.part] = (sizes[s.part] ?? 0) + 1;
    assert.deepEqual(sizes, PART_SIZES, c.id);
    assert.equal(c.steps.length, 34, c.id);
    assert.deepEqual(c.steps.slice(-5).map((s) => s.section), Array(5).fill('Fachbegriffe'), c.id);
    c.steps.forEach((s, i) => {
      assert.equal(new Set(s.options).size, 4, `${c.id} step ${i}`);
      assert.ok(s.feedback[s.answer].startsWith('Richtig'), `${c.id} step ${i}`);
      assert.equal(s.feedback.filter((f) => f.startsWith('Richtig')).length, 1, `${c.id} step ${i}`);
    });
  }
});

test('a step with the wrong shape is refused', () => {
  const broken = { ...fileCase, steps: [{ ...fileCase.steps[0], options: ['a', 'b', 'c'] }] };
  assert.throws(() => fspCaseCard(broken), /4 options/);
  assert.throws(() => checkFspCase({ ...fileCase, steps: [{ ...fileCase.steps[0], answer: 4 }] }), /out of range/);
  assert.throws(() => checkFspCase({ ...fileCase, steps: [{ ...fileCase.steps[0], situation: null }] }), /needs a situation/);
  assert.throws(() => checkFspCase({ ...fileCase, steps: [{ ...fileCase.steps[0], situation: ' ' }] }), /needs a situation/);
});

test('the title never names the diagnosis; the diagnosis is the explanation (FS-5)', () => {
  for (const c of cases) {
    const words = (c.diagnosis.match(/[A-Za-zÄÖÜäöüß]{6,}/g) ?? []).map((w) => w.toLowerCase())
      .filter((w) => !['akutes', 'akuter', 'akute', 'chronische'].includes(w));
    for (const w of words) assert.ok(!c.title.toLowerCase().includes(w), `${c.id}: '${w}' in title`);
    const card = fspCaseCard(c);
    assert.ok(!card.prompt.includes(c.diagnosis));
    assert.equal(card.explanation, c.diagnosis);
  }
});

test('a wrong pick is shown and the player picks again', () => {
  const step = fileCase.steps[0];
  const wrong = wrongOf(step);
  const afterWrong = pick(run(), wrong);
  assert.deepEqual(afterWrong.wrongPicks, [wrong]);
  assert.equal(afterWrong.solved, false);
  assert.equal(pick(afterWrong, wrong), afterWrong, 'the same wrong pick twice is ignored');
  assert.equal(nextStep(afterWrong), afterWrong, 'cannot move on before solving');
  const solved = pick(afterWrong, step.answer);
  assert.equal(solved.solved, true);
  assert.deepEqual(solved.firstTry, [false], 'only a first-try right answer counts');
  assert.equal(pick(solved, wrong), solved, 'picks after solving are ignored');
  const fresh = run();
  assert.equal(pick(fresh, 7), fresh, 'an option out of range is ignored');
  const moved = nextStep(solved);
  assert.equal(moved.stepIndex, 1);
  assert.deepEqual(moved.wrongPicks, []);
});

test('the answer order is a shuffled permutation that stays put within a step', () => {
  const r = run();
  assert.deepEqual([...runOrder(r)].sort(), [0, 1, 2, 3]);
  assert.deepEqual(runOrder(pick(r, wrongOf(fileCase.steps[0]))), runOrder(r));
  assert.deepEqual(runOrder(pick(r, fileCase.steps[0].answer)), runOrder(r));
  const orders = fileCase.steps.map((_, i) => runOrder({ ...r, stepIndex: i }));
  assert.ok(orders.some((o) => o.join() !== '0,1,2,3'), 'answers must not always sit in the file order');
  assert.ok(orders.some((o, i) => o[0] !== fileCase.steps[i].answer), 'the right answer must not always come first');
  assert.deepEqual(runOrder(play(r, 34)), []);
});

test('different seeds give different orders; the same seed the same', () => {
  const orders = (seed) => fileCase.steps.map((_, i) => runOrder({ ...startRun(fileCase, seed), stepIndex: i }).join());
  assert.notDeepEqual(orders(1), orders(2));
  assert.deepEqual(orders(1), orders(1));
});

test('score and part scores count first-try right steps', () => {
  const all = play(run(), fileCase.steps.length);
  assert.ok(isRunFinished(all));
  assert.equal(runScore(all), 1);
  assert.deepEqual(partScores(all), [{ part: 1, right: 16, steps: 16 }, { part: 2, right: 7, steps: 7 }, { part: 3, right: 11, steps: 11 }]);
  const sixteen = play(run(), 16);
  assert.ok(Math.abs(runScore(sixteen) - 16 / 34) < 1e-9);
  assert.deepEqual(partScores(sixteen), [{ part: 1, right: 16, steps: 16 }, { part: 2, right: 0, steps: 7 }, { part: 3, right: 0, steps: 11 }]);
  assert.equal(nextStep(all), all, 'a finished run does not move');
});

test('grading follows the score, never the time (FS-4)', () => {
  assert.equal(fspGrade(0.79, 'NEW'), 'AGAIN');
  assert.equal(fspGrade(0.79, 'REVIEW'), 'AGAIN');
  assert.equal(fspGrade(0.8, 'NEW'), 'GOOD');
  assert.equal(fspGrade(1.0, 'LEARNING'), 'GOOD');
  assert.equal(fspGrade(1.0, 'RELEARNING'), 'GOOD');
  assert.equal(fspGrade(0.8, 'REVIEW'), 'HARD');
  assert.equal(fspGrade(0.89, 'REVIEW'), 'HARD');
  assert.equal(fspGrade(0.9, 'REVIEW'), 'GOOD');
  assert.equal(fspGrade(0.94, 'REVIEW'), 'GOOD');
  assert.equal(fspGrade(0.95, 'REVIEW'), 'EASY');
  assert.ok(fspPassed(0.8));
  assert.ok(!fspPassed(0.7999));
  // 80 % of 34 steps is 27.2, so 28 of 34 is the least that passes; 27 of 34 (79.4 %) and 26 of 34 fail.
  assert.ok(fspPassed(28 / 34), '28 of 34 steps is the least that passes');
  assert.ok(!fspPassed(27 / 34));
  assert.ok(!fspPassed(26 / 34));
  assert.equal(runScore(play(run(), 27)), 27 / 34);
  assert.ok(fspPassed(runScore(play(run(), 28))));
  assert.ok(!fspPassed(runScore(play(run(), 27))));
  assert.ok(!fspPassed(runScore(play(run(), 26))));
});

test('answer takes a grade override and refuses one that contradicts right/wrong', () => {
  const card = fspCaseCard(fileCase);
  const s = startSession('fsp', { cards: [card] }, {}, 0, 0);
  assert.equal(answer(s, FSP_PASSED, 60 * MINUTE_MILLIS, undefined, undefined, 'EASY').lastAnswer.grade, 'EASY');
  assert.equal(answer(s, FSP_PASSED, 60 * MINUTE_MILLIS).lastAnswer.grade, 'GOOD');
  assert.throws(() => answer(s, FSP_PASSED, 0, undefined, undefined, 'AGAIN'), /contradicts/);
  assert.throws(() => answer(s, FSP_FAILED, 0, undefined, undefined, 'GOOD'), /contradicts/);
});

test('a case reads like a script and never asks the player (FS-6)', () => {
  for (const c of cases) {
    c.steps.forEach((s, i) => {
      assert.ok(!s.situation.replace(/„[^“]*“/g, '').includes('?'), `${c.id} step ${i + 1} asks the player`);
      const closesPart = i === c.steps.length - 1 || c.steps[i + 1].part !== s.part;
      if (!closesPart) assert.equal(s.reply, null, `${c.id} step ${i + 1}: the reply is the next scene`);
    });
  }
});

// ---- controller (FspCaseControllerTest) ------------------------------------------------------------------------

const makeCase = (id, area, steps = 10) => ({
  id, area, title: `Beschwerde ${id}`, diagnosis: `Diagnose ${id}`, source: 'common_FSP', bwReports: 0, patient: `Patient ${id}`,
  steps: Array.from({ length: steps }, (_, i) => ({
    part: 1 + Math.floor((i * 3) / steps), section: `S${i}`, situation: `Szene ${i}`,
    options: ['a', 'b', 'c', 'd'].map((x) => `${x}${i}`), answer: i % 4,
    feedback: [0, 1, 2, 3].map((j) => (j === i % 4 ? 'Richtig.' : 'Falsch.')), reply: null,
  })),
});
const ctrlCases = [makeCase('k1', 'Kardiologie'), makeCase('k2', 'Kardiologie'), makeCase('p1', 'Pneumologie')];

function setup() {
  const clock = { t: 100 * DAY_MILLIS };
  const store = createMemoryStore();
  const c = new StudyController(buildDeck([], [], [], [], ctrlCases), store, () => clock.t, Object.fromEntries(ctrlCases.map((x) => [x.id, x])));
  return { c, store, clock };
}

test('new cases come in the order of the areas', () => {
  const { c } = setup();
  let s = c.startSession('fsp');
  const seen = [];
  while (s.queue.length) {
    seen.push(s.queue[0].id);
    s = c.finishCase(s, play(c.startCase(s), 10));
    s = c.advance(s);
  }
  assert.deepEqual(seen, ['fsp:k1', 'fsp:k2', 'fsp:p1']);
});

test('a passed case returns exactly three days later, however long it took', () => {
  const { c, store, clock } = setup();
  let s = c.startSession('fsp');
  const r = play(c.startCase(s), 8);                     // 80 % passes
  clock.t += 45 * MINUTE_MILLIS;                         // a slow case is not graded down
  s = c.finishCase(s, r);
  const a = s.lastAnswer;
  assert.equal(a.correct, true);
  assert.equal(a.chosen, FSP_PASSED);
  assert.equal(a.grade, 'GOOD');
  assert.equal(a.after.dueAtMillis, clock.t + 3 * DAY_MILLIS);
  assert.deepEqual(store.loadProgress()['fsp:k1'], a.after);
  assert.equal(c.dailyProgress().answered, 0, 'the graded case adds no answer of its own (FS-7)');
});

test('every solved step counts for the day while the case stays one card (FS-7)', () => {
  const { c, store } = setup();
  let s = c.startSession('fsp');
  let r = c.startCase(s);
  const s0 = r.case.steps[0];
  r = c.pickInCase(r, wrongOf(s0));
  assert.equal(c.dailyProgress().answered, 0, 'a wrong pick is no answered question yet');
  r = c.pickInCase(r, s0.answer);
  assert.equal(c.dailyProgress().answered, 1);
  r = c.pickInCase(r, s0.answer);
  assert.equal(c.dailyProgress().answered, 1, 'picking again after solving counts nothing');
  r = nextStep(r);
  while (!isRunFinished(r)) r = nextStep(c.pickInCase(r, r.case.steps[r.stepIndex].answer));
  assert.equal(c.dailyProgress().answered, 10);
  s = c.finishCase(s, r);
  assert.equal(c.dailyProgress().answered, 10, 'the graded case adds no answer of its own');
  assert.deepEqual(Object.keys(store.loadProgress()), ['fsp:k1'], 'the scheduler saw one card');
  assert.equal(c.calendar(c.currentMonth()).currentStreak, 1);
});

test('a failed case returns after ten minutes and not in the same session', () => {
  const { c, clock } = setup();
  let s = c.startSession('fsp');
  s = c.finishCase(s, play(c.startCase(s), 7));         // 70 % fails
  const a = s.lastAnswer;
  assert.equal(a.correct, false);
  assert.equal(a.chosen, FSP_FAILED);
  assert.equal(a.grade, 'AGAIN');
  assert.equal(a.after.dueAtMillis, clock.t + 10 * MINUTE_MILLIS);
  s = c.advance(s);
  assert.ok(!s.queue.some((x) => x.id === 'fsp:k1'), 'not re-queued in the same session');
  assert.ok(!c.startSession('fsp').queue.some((x) => x.id === 'fsp:k1'));
  clock.t += 10 * MINUTE_MILLIS;
  assert.equal(c.startSession('fsp').queue[0].id, 'fsp:k1');
});

test('a review case is graded by its score: 80 % is HARD', () => {
  const { c, store, clock } = setup();
  let s = c.startSession('fsp');
  s = c.finishCase(s, play(c.startCase(s), 10));
  clock.t += 3 * DAY_MILLIS;
  s = c.startSession('fsp');
  assert.equal(s.queue[0].id, 'fsp:k1');
  assert.equal(store.loadProgress()['fsp:k1'].phase, 'REVIEW');
  s = c.finishCase(s, play(c.startCase(s), 8));
  assert.equal(s.lastAnswer.grade, 'HARD');
});

test('an unfinished or foreign case is ignored; other modes have no case', () => {
  const { c } = setup();
  const s = c.startSession('fsp');
  const r = c.startCase(s);
  assert.equal(r.case.id, 'k1');
  assert.equal(c.finishCase(s, r), s);                                   // not finished
  assert.equal(c.finishCase(s, play(startRun(ctrlCases[2], 1), 10)), s); // not the current card
  assert.equal(c.startCase(c.startSession('article')), null);
});
