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
