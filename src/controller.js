// Application service: wires deck, storage and clock to the pure domain functions (no DOM).
import {
  MODES, SCHEDULER, buildQueue, startSession, choicesFor, answer, advance, withoutCard,
  freshProgress, withSuspension, restored, statusAt, searchManagedCards,
  epochDayOf, plusAnswer, dailyProgress, buildCalendar, clampDailyGoal,
} from './domain.js';

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
  constructor(deck, store, clock = () => Date.now()) {
    this.deck = deck;
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

  answer(session, choice) {
    const card = session.queue[0];
    const updated = answer(session, choice, this.clock());
    if (card && updated !== session) {
      this.persist(updated.progressById[card.id]);
      this.history = plusAnswer(this.history, this.today());
      this.store.saveHistory(this.history);
    }
    return updated;
  }

  advance(session) { return advance(session, this.clock()); }

  dailyProgress() { return dailyProgress(this.history, this.today(), this.store.loadGoal()); }

  setDailyGoal(goal) { this.store.saveGoal(clampDailyGoal(goal)); }

  currentMonth() {
    const t = new Date(this.today() * 86_400_000);
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

  importData(data) {
    if (!data || data.app !== 'german-quiz-web' || typeof data.progress !== 'object' || typeof data.history !== 'object') {
      throw new Error('This is not a German Quiz backup file.');
    }
    this.progress = data.progress;
    this.history = data.history;
    this.store.saveProgress(this.progress);
    this.store.saveHistory(this.history);
    if (data.dailyGoal) this.store.saveGoal(clampDailyGoal(data.dailyGoal));
  }

  persist(progress) {
    this.progress = { ...this.progress, [progress.cardId]: progress };
    this.store.saveProgress(this.progress);
  }
}
