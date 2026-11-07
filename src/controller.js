// Application service: wires deck, storage and clock to the pure domain functions (no DOM).
import {
  MODES, SCHEDULER, GRADER, buildQueue, startSession, choicesFor, answer, advance, withoutCard,
  freshProgress, withSuspension, restored, statusAt, searchManagedCards,
  DAY_MILLIS, epochDayOf, plusAnswer, dailyProgress, buildCalendar, clampDailyGoal,
} from './domain.js';
import { FSP_FAILED, FSP_PASSED, fspGrade, fspPassed, isRunFinished, pick, runScore, startRun } from './fsp.js';

/** Storage with the shape the controller needs; see store.js for the browser one. */
export function createMemoryStore(initial = {}) {
  const data = { progress: {}, history: {}, goal: 20, theme: 'SYSTEM', ...initial };
  return {
    loadProgress: () => ({ ...data.progress }),
    saveProgress: (map) => { data.progress = { ...map }; },
    loadHistory: () => ({ ...data.history }),
    saveHistory: (h) => { data.history = { ...h }; },
    loadGoal: () => data.goal,
    saveGoal: (g) => { data.goal = g; },
    loadTheme: () => data.theme,
    saveTheme: (t) => { data.theme = t; },
    clearProgress: () => { data.progress = {}; },
  };
}

export class StudyController {
  /** cases: the FSP cases by id; a card "fsp:<id>" is played from here (ADR-0014). */
  constructor(deck, store, clock = () => Date.now(), cases = {}) {
    this.deck = deck;
    this.cases = cases;
    this.store = store;
    this.clock = clock;
    this.progress = store.loadProgress();
    this.history = store.loadHistory();
    this.cardsById = Object.fromEntries(Object.values(deck).flat().map((c) => [c.id, c]));
  }

  today() { return epochDayOf(this.clock()); }

  queueFor(modeId) {
    return buildQueue(this.deck[modeId] ?? [], this.progress, this.clock());
  }

  overview() {
    return MODES.map((mode) => ({ mode, totalCards: (this.deck[mode.id] ?? []).length, stats: this.queueFor(mode.id).stats }));
  }

  startSession(modeId) {
    const now = this.clock();
    return startSession(modeId, this.queueFor(modeId), this.progress, now, now);
  }

  choices(session) { return choicesFor(session); }

  answer(session, choice) { return this.record(session, choice, null, true); }

  /**
   * Picks an option in the case being played. FS-7: the pick that solves a step counts as one answered question for
   * the daily goal and the streak calendar, while the scheduler sees the whole case as one card (finishCase).
   */
  pickInCase(run, option) {
    const after = pick(run, option);
    if (after.solved && !run.solved) {
      this.history = plusAnswer(this.history, this.today());
      this.store.saveHistory(this.history);
    }
    return after;
  }

  /** The case behind the current card, ready to play; null when the card is not an FSP case. */
  startCase(session) {
    const card = session.queue[0];
    if (!card || card.mode !== 'fsp') return null;
    const fspCase = this.cases[card.id.slice('fsp:'.length)];
    return fspCase ? startRun(fspCase, this.clock()) : null;
  }

  /** FS-4: a finished case is answered with its score; the time it took never changes the grade. */
  finishCase(session, run) {
    const card = session.queue[0];
    if (!card || !isRunFinished(run) || card.id !== `fsp:${run.case.id}`) return session;
    const phase = (this.progress[card.id] ?? freshProgress(card.id, SCHEDULER)).phase;
    const score = runScore(run);
    // Its steps were already counted one by one (FS-7), so the case itself adds no answer to the day.
    return this.record(session, fspPassed(score) ? FSP_PASSED : FSP_FAILED, fspGrade(score, phase), false);
  }

  record(session, choice, gradeOverride, countsAnswer) {
    const card = session.queue[0];
    const updated = answer(session, choice, this.clock(), SCHEDULER, GRADER, gradeOverride);
    if (card && updated !== session) {
      this.persist(updated.progressById[card.id]);
      if (countsAnswer) {
        this.history = plusAnswer(this.history, this.today());
        this.store.saveHistory(this.history);
      }
    }
    return updated;
  }

  advance(session) { return advance(session, this.clock()); }

  dailyProgress() { return dailyProgress(this.history, this.today(), this.store.loadGoal()); }

  setDailyGoal(goal) { this.store.saveGoal(clampDailyGoal(goal)); }

  currentMonth() {
    const t = new Date(this.today() * DAY_MILLIS);
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() };
  }

  calendar(month) { return buildCalendar(this.history, month, this.today()); }

  suspendCurrentCard(session, duration) {
    const card = session.queue[0];
    if (!card) return session;
    const base = this.progress[card.id] ?? freshProgress(card.id, SCHEDULER);
    const now = this.clock();
    const updated = withSuspension(base, duration, now);
    this.persist(updated);
    return withoutCard(session, card.id, updated, now);
  }

  managedCards(query = '') {
    const now = this.clock();
    const order = { SUSPENDED: 0, REMOVED: 1 };
    const all = Object.values(this.progress)
      .map((p) => {
        const status = statusAt(p, now);
        const card = this.cardsById[p.cardId];
        return status && card ? { card, status, suspendedUntilMillis: p.suspendedUntilMillis } : null;
      })
      .filter(Boolean)
      .sort((a, b) => order[a.status] - order[b.status] || a.card.prompt.localeCompare(b.card.prompt));
    return searchManagedCards(all, query);
  }

  managedCounts() {
    const m = this.managedCards();
    return { suspended: m.filter((x) => x.status === 'SUSPENDED').length, removed: m.filter((x) => x.status === 'REMOVED').length };
  }

  restoreCard(cardId) {
    const p = this.progress[cardId];
    if (p) this.persist(restored(p));
  }

  restoreAll(status) {
    this.managedCards().filter((m) => m.status === status).forEach((m) => this.restoreCard(m.card.id));
  }

  resetAllProgress() {
    this.store.clearProgress();
    this.progress = {};
  }

  /** Everything the player owns, for the backup file. */
  exportData() {
    return {
      app: 'german-quiz-web', version: 1,
      progress: this.progress, history: this.history,
      dailyGoal: this.store.loadGoal(), theme: this.store.loadTheme(),
    };
  }

  /** Like the app's decodeBackup: entries that cannot be trusted are dropped instead of failing the whole import. */
  importData(data) {
    const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (!data || data.app !== 'german-quiz-web' || !isMap(data.progress) || !isMap(data.history)) {
      throw new Error('This is not a German Quiz backup file.');
    }
    if (typeof data.version === 'number' && data.version > 1) {
      throw new Error('This file was made by a newer version of the app. Update the app first.');
    }
    this.progress = Object.fromEntries(Object.entries(data.progress).filter(([id, p]) => isMap(p) && p.cardId === id));
    this.history = Object.fromEntries(Object.entries(data.history).filter(([, n]) => Number.isInteger(n) && n > 0));
    this.store.saveProgress(this.progress);
    this.store.saveHistory(this.history);
    if (data.dailyGoal) this.store.saveGoal(clampDailyGoal(data.dailyGoal));
  }

  persist(progress) {
    this.progress = { ...this.progress, [progress.cardId]: progress };
    this.store.saveProgress(this.progress);
  }
}
