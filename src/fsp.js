// FSP case simulations (ADR-0014 of the Android app), ported from its content/FspCase.kt. Pure: no DOM, no clock.
// A case follows one template: part 1 Arzt-Patienten-Gespräch, part 2 Dokumentation, part 3 Arzt-Arzt-Gespräch with
// the Fachbegriffe at its end. Every step has 4 options, exactly one right (`answer`), one feedback text per option.
import { seededShuffle } from './domain.js';

/** The two "choices" of a case card: the scheduler only learns whether the case was passed. */
export const FSP_PASSED = 'bestanden';
export const FSP_FAILED = 'nicht bestanden';

/** The share of first-try right steps a case needs to count as a correct answer (FS-4). */
export const FSP_PASS_SCORE = 0.8;
const EASY_SCORE = 0.95;
const HARD_BELOW = 0.9;

/** Throws like the app's FspStep init when a step breaks the shape the player relies on. */
export function checkFspCase(fspCase) {
  for (const s of fspCase.steps) {
    if (s.options?.length !== 4 || s.feedback?.length !== 4) throw new Error(`step '${s.section}' needs 4 options and 4 feedback texts`);
    if (!Number.isInteger(s.answer) || s.answer < 0 || s.answer > 3) throw new Error(`step '${s.section}': answer ${s.answer} out of range`);
  }
  return fspCase;
}

export const fspPassed = (score) => score >= FSP_PASS_SCORE;

/** FS-4: how a finished case is graded. Time spent never matters; only the score and the card's phase. */
export function fspGrade(score, phase) {
  if (!fspPassed(score)) return 'AGAIN';
  if (phase === 'REVIEW' && score >= EASY_SCORE) return 'EASY';
  if (phase === 'REVIEW' && score < HARD_BELOW) return 'HARD';
  return 'GOOD';
}

// ---- a case being played (FS-3): immutable, every move returns a new run -----------------------------------------

/**
 * seed fixes the answer order of every step. firstTry: per finished step, was the first pick right. wrongPicks: option
 * indices (in the case file's order) already picked wrongly in the current step. solved: the right answer was picked.
 */
export const startRun = (fspCase, seed) => ({ case: fspCase, seed, stepIndex: 0, firstTry: [], wrongPicks: [], solved: false });

export const isRunFinished = (run) => run.stepIndex >= run.case.steps.length;
export const runStep = (run) => run.case.steps[run.stepIndex] ?? null;

/** Option indices in the order shown for the current step; depends only on seed, case and step, never on the picks. */
export const runOrder = (run) =>
  isRunFinished(run) ? [] : seededShuffle([0, 1, 2, 3], `fsp|${run.seed}|${run.case.id}|${run.stepIndex}`);

/** Picks an option (an index into the case file's options). Returns the same run after solving or for a repeated wrong pick. */
export function pick(run, option) {
  const s = runStep(run);
  if (!s || run.solved || !Number.isInteger(option) || option < 0 || option >= s.options.length || run.wrongPicks.includes(option)) return run;
  return option === s.answer
    ? { ...run, solved: true, firstTry: [...run.firstTry, run.wrongPicks.length === 0] }
    : { ...run, wrongPicks: [...run.wrongPicks, option] };
}

/** Moves to the next step; returns the same run until the current one is solved. */
export const nextStep = (run) => (run.solved ? { ...run, stepIndex: run.stepIndex + 1, wrongPicks: [], solved: false } : run);

/** Share of steps right at the first pick, over all steps of the case. */
export const runScore = (run) => run.firstTry.filter(Boolean).length / run.case.steps.length;

/** [part, right, steps] per part over the finished steps, sorted by part. */
export function partScores(run) {
  const by = new Map();
  run.firstTry.forEach((right, i) => {
    const part = run.case.steps[i].part;
    const [r, n] = by.get(part) ?? [0, 0];
    by.set(part, [r + (right ? 1 : 0), n + 1]);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([part, [right, steps]]) => ({ part, right, steps }));
}
