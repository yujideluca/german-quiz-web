// Pure logic ported from the Android app's domain/ package. No DOM, no storage, no clock access.

export const MINUTE_MILLIS = 60_000;
export const DAY_MILLIS = 86_400_000;

export const MODES = [
  // Display names and instruction lines are translated: see strings.js (mode_<id>_title / mode_<id>_instruction).
  { id: 'article' },
  { id: 'preposition' },
  { id: 'plural' },
  { id: 'preterite' },
  // autoAdvances false: the explanation (corrected sentence + rule) needs reading time, so the player taps Next.
  { id: 'errors', autoAdvances: false },
];

/**
 * Scale factors for a screen of the given height (px): layout follows the height proportionally, text
 * never drops below its normal size, and both are capped. Mirrors ScreenScale.kt in the Android app.
 */
export const SCREEN_SCALE = { referenceHeight: 880, minLayout: 0.8, maxLayout: 1.2, minText: 1, maxText: 1.15 };
export function screenScaleFor(heightPx) {
  const { referenceHeight, minLayout, maxLayout, minText, maxText } = SCREEN_SCALE;
  const ratio = heightPx / referenceHeight;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return { layout: clamp(ratio, minLayout, maxLayout), text: clamp(ratio, minText, maxText) };
}

export const SCHEDULER = {
  learningStepsMinutes: [10],
  relearningStepsMinutes: [10],
  graduatingIntervalDays: 3,
  easyIntervalDays: 5,
  startingEase: 2.5,
  minimumEase: 1.3,
  easyBonus: 1.3,
  hardIntervalFactor: 1.2,
  intervalModifier: 1.0,
  lapseIntervalFactor: 0.0,
  maximumIntervalDays: 36_500,
  learnAheadMinutes: 0,
};
export const GRADER = { easyMaxMillis: 2_500, hardMinMillis: 10_000 };
export const LIMITS = { maxReviewsPerSession: 100, reviewsPerNewCard: 3 };

// ---- progress and scheduler ------------------------------------------------------------------

export function freshProgress(cardId, config = SCHEDULER) {
  return {
    cardId, phase: 'NEW', learningStep: 0, easeFactor: config.startingEase, intervalDays: 0,
    dueAtMillis: 0, repetitions: 0, lapses: 0, firstSeenAtMillis: null, lastReviewedAtMillis: null,
    suspendedUntilMillis: 0, removed: false,
  };
}

export function gradeAnswer(correct, responseMillis, phase, config = GRADER) {
  if (!correct) return 'AGAIN';
  if (phase === 'REVIEW' && responseMillis >= config.hardMinMillis) return 'HARD';
  if (responseMillis <= config.easyMaxMillis && phase === 'REVIEW') return 'EASY';
  return 'GOOD';
}

const inStep = (p, phase, step, now, steps) =>
  ({ ...p, phase, learningStep: step, dueAtMillis: now + steps[step] * MINUTE_MILLIS });
const due = (p, days, now) =>
  ({ ...p, phase: 'REVIEW', learningStep: 0, intervalDays: days, dueAtMillis: now + days * DAY_MILLIS });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function learn(p, grade, now, c) {
  const steps = c.learningStepsMinutes;
  const step = p.phase === 'NEW' ? 0 : clamp(p.learningStep, 0, steps.length - 1);
  switch (grade) {
    case 'AGAIN': return inStep(p, 'LEARNING', 0, now, steps);
    case 'HARD': return inStep(p, 'LEARNING', step, now, steps);
    case 'GOOD':
      return step + 1 >= steps.length
        ? due(p, c.graduatingIntervalDays, now)
        : inStep(p, 'LEARNING', step + 1, now, steps);
    default: return due(p, c.easyIntervalDays, now);
  }
}

function relearn(p, grade, now, c) {
  const steps = c.relearningStepsMinutes;
  const step = clamp(p.learningStep, 0, steps.length - 1);
  switch (grade) {
    case 'AGAIN': return inStep(p, 'RELEARNING', 0, now, steps);
    case 'HARD': return inStep(p, 'RELEARNING', step, now, steps);
    case 'GOOD':
      return step + 1 >= steps.length
        ? due(p, Math.max(1, p.intervalDays), now)
        : inStep(p, 'RELEARNING', step + 1, now, steps);
    default: return due(p, Math.min(c.maximumIntervalDays, Math.max(1, p.intervalDays) + 1), now);
  }
}

function review(p, grade, now, c) {
  const old = Math.max(1, p.intervalDays);
  const grow = (factor, floor) =>
    Math.min(c.maximumIntervalDays, Math.max(floor, Math.round(old * factor * c.intervalModifier)));
  switch (grade) {
    case 'AGAIN': {
      const reduced = Math.max(1, Math.round(old * c.lapseIntervalFactor));
      return inStep(
        { ...p, lapses: p.lapses + 1, easeFactor: Math.max(c.minimumEase, p.easeFactor - 0.20), intervalDays: reduced },
        'RELEARNING', 0, now, c.relearningStepsMinutes);
    }
    case 'HARD':
      return due({ ...p, easeFactor: Math.max(c.minimumEase, p.easeFactor - 0.15) }, grow(c.hardIntervalFactor, old + 1), now);
    case 'GOOD': return due(p, grow(p.easeFactor, old + 1), now);
    default: return due({ ...p, easeFactor: p.easeFactor + 0.15 }, grow(p.easeFactor * c.easyBonus, old + 2), now);
  }
}

export function scheduleNext(progress, grade, now, config = SCHEDULER) {
  const stamped = {
    ...progress,
    repetitions: progress.repetitions + 1,
    firstSeenAtMillis: progress.firstSeenAtMillis ?? now,
    lastReviewedAtMillis: now,
  };
  switch (progress.phase) {
    case 'NEW': case 'LEARNING': return learn(stamped, grade, now, config);
    case 'REVIEW': return review(stamped, grade, now, config);
    default: return relearn(stamped, grade, now, config);
  }
}

// ---- availability (suspend / remove) ---------------------------------------------------------

export const SUSPENSION_MILLIS = { ONE_WEEK: 7 * DAY_MILLIS, ONE_MONTH: 30 * DAY_MILLIS, PERMANENT: null };

export const isAvailableAt = (p, now) => !p.removed && p.suspendedUntilMillis <= now;

export function statusAt(p, now) {
  if (p.removed) return 'REMOVED';
  return p.suspendedUntilMillis > now ? 'SUSPENDED' : null;
}

export function withSuspension(p, duration, now) {
  const ms = SUSPENSION_MILLIS[duration];
  return ms === null
    ? { ...p, removed: true, suspendedUntilMillis: 0 }
    : { ...p, removed: false, suspendedUntilMillis: now + ms };
}

export const restored = (p) => ({ ...p, removed: false, suspendedUntilMillis: 0 });

/** Lower-cases and strips diacritics so "stuhle" finds "Stühle". */
export const foldForSearch = (text) => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();

export function searchManagedCards(items, query) {
  const q = foldForSearch(query);
  if (!q) return items;
  return items.filter((m) =>
    [m.card.prompt, m.card.context, m.card.explanation, m.card.id]
      .filter((s) => s != null)
      .some((s) => foldForSearch(s).includes(q)));
}

// ---- queue pipeline --------------------------------------------------------------------------

export const attachProgress = (cards, progressById, config = SCHEDULER) =>
  cards.map((card) => ({ card, progress: progressById[card.id] ?? freshProgress(card.id, config) }));

export const excludeUnavailable = (items, now) => items.filter((i) => isAvailableAt(i.progress, now));

export const selectLearningDue = (items, now, learnAheadMinutes) =>
  items
    .filter((i) => (i.progress.phase === 'LEARNING' || i.progress.phase === 'RELEARNING') &&
      i.progress.dueAtMillis <= now + learnAheadMinutes * MINUTE_MILLIS)
    .sort((a, b) => a.progress.dueAtMillis - b.progress.dueAtMillis);

export const selectReviewsDue = (items, now, limit) =>
  items
    .filter((i) => i.progress.phase === 'REVIEW' && i.progress.dueAtMillis <= now)
    .sort((a, b) => a.progress.dueAtMillis - b.progress.dueAtMillis)
    .slice(0, limit);

export const selectNewCards = (items) => items.filter((i) => i.progress.phase === 'NEW');

/** Keeps main's order and slots one extra item after every `every` main items. */
export function interleave(main, extra, every) {
  if (extra.length === 0) return main;
  if (main.length === 0) return extra;
  const out = [];
  let next = 0;
  main.forEach((item, i) => {
    out.push(item);
    if ((i + 1) % every === 0 && next < extra.length) out.push(extra[next++]);
  });
  while (next < extra.length) out.push(extra[next++]);
  return out;
}

export function buildQueue(modeCards, progressById, now, limits = LIMITS, config = SCHEDULER) {
  const items = excludeUnavailable(attachProgress(modeCards, progressById, config), now);
  const learning = selectLearningDue(items, now, config.learnAheadMinutes);
  const reviews = selectReviewsDue(items, now, limits.maxReviewsPerSession);
  const newCards = selectNewCards(items);
  const ordered = [...learning, ...interleave(reviews, newCards, limits.reviewsPerNewCard)];
  return {
    cards: ordered.map((i) => i.card),
    stats: { learningDue: learning.length, reviewsDue: reviews.length, newAvailable: newCards.length },
  };
}

// ---- seeded shuffle (same seed, same order) --------------------------------------------------

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(list, seed) {
  const out = [...list];
  const rand = mulberry32(typeof seed === 'string' ? hashString(seed) : seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- study session engine --------------------------------------------------------------------

export function startSession(modeId, queue, progressById, now, choiceSeed) {
  return {
    mode: modeId, queue: queue.cards, progressById, shownAtMillis: now, choiceSeed,
    lastAnswer: null, correctCount: 0, wrongCount: 0,
  };
}

export const currentCard = (s) => s.queue[0] ?? null;
export const isFinished = (s) => s.queue.length === 0;
export const isAwaitingAdvance = (s) => s.lastAnswer !== null;

/**
 * Choices in presentation order; stable for a given card, seed and repetition count. While the
 * feedback shows, the count from before the answer is used so buttons do not move under the finger.
 */
export function choicesFor(session) {
  const card = currentCard(session);
  if (!card) return [];
  if (!card.shuffleChoices) return card.choices;
  const reps = session.lastAnswer?.before.repetitions ?? session.progressById[card.id]?.repetitions ?? 0;
  return seededShuffle(card.choices, `${session.choiceSeed}|${card.id}|${reps}`);
}

export function answer(session, choice, now, schedulerConfig = SCHEDULER, graderConfig = GRADER) {
  const card = currentCard(session);
  if (!card || isAwaitingAdvance(session) || !card.choices.includes(choice)) return session;

  const before = session.progressById[card.id] ?? freshProgress(card.id, schedulerConfig);
  const correct = choice === card.correctChoice;
  const responseMillis = Math.max(0, now - session.shownAtMillis);
  const grade = gradeAnswer(correct, responseMillis, before.phase, graderConfig);
  const after = scheduleNext(before, grade, now, schedulerConfig);

  const comesBack = (after.phase === 'LEARNING' || after.phase === 'RELEARNING') &&
    after.dueAtMillis <= now + schedulerConfig.learnAheadMinutes * MINUTE_MILLIS;
  return {
    ...session,
    queue: comesBack ? [...session.queue, card] : session.queue,
    progressById: { ...session.progressById, [card.id]: after },
    lastAnswer: { chosen: choice, correct, grade, responseMillis, before, after },
    correctCount: session.correctCount + (correct ? 1 : 0),
    wrongCount: session.wrongCount + (correct ? 0 : 1),
  };
}

export const advance = (session, now) =>
  isAwaitingAdvance(session)
    ? { ...session, queue: session.queue.slice(1), lastAnswer: null, shownAtMillis: now }
    : session;

export const withoutCard = (session, cardId, progress, now) => ({
  ...session,
  queue: session.queue.filter((c) => c.id !== cardId),
  progressById: { ...session.progressById, [cardId]: progress },
  lastAnswer: null,
  shownAtMillis: now,
});

// ---- daily goal, history, calendar -----------------------------------------------------------

export const MIN_DAILY_GOAL = 10;
export const MAX_DAILY_GOAL = 100;
export const DAILY_GOAL_STEP = 10;
export const DEFAULT_DAILY_GOAL = 20;

export const clampDailyGoal = (v) =>
  clamp(Math.round(v / DAILY_GOAL_STEP) * DAILY_GOAL_STEP, MIN_DAILY_GOAL, MAX_DAILY_GOAL);

/** Epoch day of the local calendar date containing nowMillis. */
export function epochDayOf(nowMillis) {
  const d = new Date(nowMillis);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MILLIS);
}

export const answeredOn = (history, day) => history[day] ?? 0;
export const plusAnswer = (history, day) => ({ ...history, [day]: answeredOn(history, day) + 1 });

export function dailyProgress(history, today, goal) {
  const answered = answeredOn(history, today);
  return { answered, goal, reached: answered >= goal, fraction: clamp(answered / goal, 0, 1) };
}

export function currentStreak(history, today) {
  let day = answeredOn(history, today) > 0 ? today : today - 1;
  let streak = 0;
  while (answeredOn(history, day) > 0) { streak++; day--; }
  return streak;
}

export function longestStreak(history) {
  let best = 0, run = 0, previous = null;
  const days = Object.keys(history).map(Number).filter((d) => history[d] > 0).sort((a, b) => a - b);
  for (const day of days) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/** month is { year, month } with month 0-11. Weeks start on Monday. */
export function buildCalendar(history, month, todayEpoch) {
  const length = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay(); // 0 = Sunday
  const days = [];
  for (let d = 1; d <= length; d++) {
    const epoch = Math.floor(Date.UTC(month.year, month.month, d) / DAY_MILLIS);
    days.push({ day: d, answered: answeredOn(history, epoch), isToday: epoch === todayEpoch, isFuture: epoch > todayEpoch });
  }
  const t = new Date(todayEpoch * DAY_MILLIS);
  const current = { year: t.getUTCFullYear(), month: t.getUTCMonth() };
  return {
    month,
    leadingBlanks: (firstDow + 6) % 7,
    days,
    currentStreak: currentStreak(history, todayEpoch),
    longestStreak: longestStreak(history),
    trainedDaysInMonth: days.filter((d) => d.answered > 0).length,
    answersInMonth: days.reduce((sum, d) => sum + d.answered, 0),
    canGoNext: month.year * 12 + month.month < current.year * 12 + current.month,
  };
}

// ---- heat colour -----------------------------------------------------------------------------

export const HEAT_FULL_ANSWERS = MAX_DAILY_GOAL;
const LIGHT_YELLOW = 0xFFF4B5, ORANGE = 0xFFA53A, RED_ORANGE = 0xE4401C;

function lerpRgb(from, to, t) {
  const channel = (shift) => {
    const a = (from >> shift) & 0xFF, b = (to >> shift) & 0xFF;
    return clamp(Math.trunc(a + (b - a) * t), 0, 255);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function heatColorRgb(answered) {
  const t = clamp(Math.max(0, answered) / HEAT_FULL_ANSWERS, 0, 1);
  return t < 0.5 ? lerpRgb(LIGHT_YELLOW, ORANGE, t * 2) : lerpRgb(ORANGE, RED_ORANGE, (t - 0.5) * 2);
}

export const heatColorCss = (answered) => `#${heatColorRgb(answered).toString(16).padStart(6, '0')}`;
