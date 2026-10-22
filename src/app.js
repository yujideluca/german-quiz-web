// UI layer: renders the screens and wires taps to the StudyController. All logic lives in domain.js.
import { buildDeck } from './content.js';
import { StudyController } from './controller.js';
import { createLocalStore } from './store.js';
import { LANGUAGE_CHOICES, NO_CONTENT_TRANSLATIONS, createTranslator, monthShort, resolveLanguage, translateExplanation, translateHint, weekdayLetters, localeOf } from './i18n.js';
import { barPercent, screenScaleFor, heatColorCss, HEAT_FULL_ANSWERS, MIN_DAILY_GOAL, MAX_DAILY_GOAL, DAILY_GOAL_STEP, MODES } from './domain.js';

const AUTO_ADVANCE_MILLIS = 500;
const MAX_RESULTS = 40;

const root = document.getElementById('app');
const store = createLocalStore();
let controller = null;
let view = { name: 'home' };
let session = null;
let calendarMonth = null;
let query = '';
let menuOpen = false;
let advanceTimer = null;
let language = 'en';                       // the language on screen (the choice resolved against the browser)
let t = createTranslator(language);
let content = NO_CONTENT_TRANSLATIONS;     // translations of the English text inside the vocabulary data
const contentCache = {};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function applyTheme(mode) {
  if (mode === 'LIGHT') document.documentElement.dataset.theme = 'light';
  else if (mode === 'DARK') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

// ---- screens ---------------------------------------------------------------------------------

function homeHtml() {
  const month = calendarMonth ?? controller.currentMonth();
  const cal = controller.calendar(month);
  const daily = controller.dailyProgress();
  const cells = [
    ...Array.from({ length: cal.leadingBlanks }, () => '<div></div>'),
    ...cal.days.map((d) => {
      const trained = d.answered > 0;
      const style = trained ? ` style="background:${heatColorCss(d.answered)}"` : '';
      return `<div class="cal-cell${trained ? ' trained' : ''}${d.isToday ? ' today' : ''}${d.isFuture ? ' future' : ''}"${style}>${d.day}</div>`;
    }),
  ].join('');
  const gradient = [1, HEAT_FULL_ANSWERS / 2, HEAT_FULL_ANSWERS].map(heatColorCss).join(',');
  const days = cal.trainedDaysInMonth;
  return `
    <section class="card">
      <div class="row cal-head">
        <button class="link" data-action="prev-month" aria-label="${t('aria_prev_month')}">‹</button>
        <span class="title">${monthShort(language, month.month)} ${month.year}</span>
        <button class="link" data-action="next-month" aria-label="${t('aria_next_month')}" ${cal.canGoNext ? '' : 'disabled'}>›</button>
        <span class="grow"></span>
        <button class="link" data-action="settings">${t('calendar_settings')}</button>
      </div>
      <p class="small">${t('calendar_streak', cal.currentStreak, cal.longestStreak, t.plural('calendar_days', days))}</p>
      <div class="cal-grid" style="margin-top:6px">${weekdayLetters(language).map((w) => `<div class="cal-dow">${w}</div>`).join('')}${cells}</div>
      <div class="legend"><span>1</span><div class="bar" style="background:linear-gradient(90deg,${gradient})"></div><span>${t('calendar_legend', HEAT_FULL_ANSWERS)}</span></div>
    </section>
    <section class="card">
      <p class="title">${daily.reached ? t('daily_reached', daily.answered, daily.goal) : t('daily_progress', daily.answered, daily.goal)}</p>
      <div class="progress"><div style="width:${barPercent(daily)}%"></div></div>
    </section>
    ${controller.overview().map((m) => {
      const due = m.stats.learningDue + m.stats.reviewsDue + m.stats.newAvailable;
      return `<section class="card row">
        <div class="grow">
          <p class="title">${esc(t(`mode_${m.mode.id}_title`))}</p>
          <p class="small mode-instruction">${esc(t(`mode_${m.mode.id}_instruction`))}</p>
          <p class="small">${t('home_stats', m.stats.newAvailable, m.stats.learningDue, m.stats.reviewsDue, m.totalCards)}</p>
        </div>
        <button class="btn" data-action="study" data-mode="${m.mode.id}" ${due > 0 ? '' : 'disabled'}>${due > 0 ? t('home_study', due) : t('common_done')}</button>
      </section>`;
    }).join('')}`;
}

function studyHtml() {
  const card = session.queue[0];
  const answer = session.lastAnswer;
  const daily = controller.dailyProgress();
  const mode = MODES.find((m) => m.id === session.mode);
  const errorSpot = mode.id === 'errors';
  const choices = controller.choices(session).map((option) => {
    let cls = '';
    if (answer) cls = option === card.correctChoice ? ' correct' : option === answer.chosen ? ' wrong' : ' dim';
    return `<button class="${errorSpot ? 'chunk' : 'choice'}${cls}" data-action="choose" data-choice="${esc(option)}" ${answer ? 'disabled' : ''}>${esc(option)}</button>`;
  }).join('');
  const menu = menuOpen && !answer ? `<div class="menu-pop">
      <button data-action="suspend" data-duration="ONE_WEEK">${t('card_remove_week')}</button>
      <button data-action="suspend" data-duration="ONE_MONTH">${t('card_remove_month')}</button>
      <button data-action="suspend" data-duration="PERMANENT">${t('card_remove_permanent')}</button></div>` : '';
  return `
    <div class="row between">
      <span class="small">${esc(t('study_header', t(`mode_${mode.id}_title`), session.queue.length, daily.answered, daily.goal))}</span>
      <span class="row"><button class="link" data-action="quit">${t('study_quit')}</button>
        <span class="menu"><button class="link dots" data-action="menu" ${answer ? 'disabled' : ''} aria-label="${t('aria_more')}">⋮</button>${menu}</span></span>
    </div>
    <div class="study col" style="display:flex;flex-direction:column;gap:calc(12px * var(--layout))">
      <h1 class="prompt${errorSpot ? ' prompt-small' : ''}">${esc(card.prompt)}</h1>
      ${errorSpot ? `<p class="hint">${t('errors_tap_wrong')}</p>` : ''}
      ${card.hint ? `<p class="hint">${esc(t('study_hint', translateHint(content, card.hint)))}</p>` : ''}
      ${card.context && !errorSpot ? `<p class="context">${esc(card.context)}</p>` : ''}
      ${errorSpot ? `<div class="chunks">${choices}</div>` : choices}
      ${answer ? `<p class="explanation">${esc(translateExplanation(content, card.explanation))}</p>` : ''}
      ${answer && !mode.autoAdvances ? `<button class="btn next" data-action="next">${t('study_next')}</button>` : ''}
    </div>`;
}

function finishedHtml() {
  return `<div class="section center">
    <h1>${t('finished_title')}</h1>
    <p class="title">${t('finished_score', session.correctCount, session.wrongCount)}</p>
    <button class="btn outline" data-action="home">${t('finished_back')}</button></div>`;
}

function settingsHtml() {
  const theme = store.loadTheme();
  const goal = controller.dailyProgress().goal;
  const counts = controller.managedCounts();
  const radio = (value, label) =>
    `<label class="radio"><input type="radio" name="theme" value="${value}" ${theme === value ? 'checked' : ''}>${label}</label>`;
  const choice = store.loadLanguage();
  const languageName = (value) => value === 'SYSTEM' ? t('use_system_default') : t(`language_name_${LANGUAGE_KEYS[value]}`);
  const languageRadio = (value) =>
    `<label class="radio"><input type="radio" name="language" value="${value}" ${choice === value ? 'checked' : ''}>${languageName(value)}</label>`;
  return `<div class="section">
    <div class="row between"><h1>${t('settings_title')}</h1><button class="link" data-action="home">${t('common_done')}</button></div>
    <h3>${t('settings_appearance')}</h3>
    ${radio('SYSTEM', t('use_system_default'))}${radio('LIGHT', t('theme_light'))}${radio('DARK', t('theme_dark'))}
    <hr>
    <h3>${t('settings_language')}</h3>
    ${LANGUAGE_CHOICES.map(languageRadio).join('')}
    <hr>
    <h3>${t('settings_daily_goal')}</h3>
    <p id="goal-label">${t('settings_daily_goal_value', goal)}</p>
    <input id="goal" type="range" min="${MIN_DAILY_GOAL}" max="${MAX_DAILY_GOAL}" step="${DAILY_GOAL_STEP}" value="${goal}">
    <hr>
    <h3>${t('settings_removed_title')}</h3>
    <p>${t('settings_removed_counts', counts.suspended, counts.removed)}</p>
    <button class="btn outline" data-action="removed">${t('settings_manage_removed')}</button>
    <hr>
    <h3>${t('backup_title')}</h3>
    <p class="small">${t('web_backup_explain')}</p>
    <button class="btn outline" data-action="export">${t('web_backup_save')}</button>
    <label class="btn outline" style="text-align:center;display:block">${t('web_backup_restore')}
      <input id="import" type="file" accept="application/json,.json" hidden></label>
    <hr>
    <h3>${t('settings_progress')}</h3>
    <button class="btn outline danger" data-action="reset-all">${t('settings_reset_all')}</button>
  </div>`;
}

function removedHtml() {
  const counts = controller.managedCounts();
  const results = controller.managedCards(query);
  const fmt = (ms) => new Date(ms).toLocaleDateString(localeOf(language), { day: 'numeric', month: 'short', year: 'numeric' });
  const rows = results.slice(0, MAX_RESULTS).map((m) => `
    <div class="card row">
      <div class="grow"><p class="title">${esc(m.card.prompt)}</p>
        ${m.card.context ? `<p class="small">${esc(m.card.context)}</p>` : ''}
        <p class="small">${esc(t(`mode_${m.card.mode}_title`))} · ${m.status === 'REMOVED' ? t('card_status_removed') : t('card_status_suspended', fmt(m.suspendedUntilMillis))}</p></div>
      <button class="link" data-action="restore" data-id="${esc(m.card.id)}">${t('common_restore')}</button>
    </div>`).join('');
  const empty = results.length ? '' : `<p>${counts.suspended + counts.removed === 0 ? t('removed_none') : t('removed_no_match', esc(query))}</p>`;
  return `<div class="section">
    <div class="row between"><h1>${t('settings_removed_title')}</h1><button class="link" data-action="settings">${t('common_back')}</button></div>
    <p>${t('settings_removed_counts', counts.suspended, counts.removed)}</p>
    <button class="btn outline" data-action="restore-suspended" ${counts.suspended ? '' : 'disabled'}>${t('removed_reset_suspended')}</button>
    <button class="btn outline" data-action="restore-removed" ${counts.removed ? '' : 'disabled'}>${t('removed_reset_removed')}</button>
    <input id="search" type="search" placeholder="${t('removed_search')}" value="${esc(query)}" autocomplete="off">
    ${empty}${rows}
    ${results.length > MAX_RESULTS ? `<p class="small">${t('removed_showing', MAX_RESULTS, results.length)}</p>` : ''}
  </div>`;
}

function render() {
  clearTimeout(advanceTimer);
  if (!controller) { root.innerHTML = `<p class="card">${t('web_load_failed')}</p>`; return; }
  let html;
  switch (view.name) {
    case 'study': html = session.queue.length ? studyHtml() : finishedHtml(); break;
    case 'settings': html = settingsHtml(); break;
    case 'removed': html = removedHtml(); break;
    default: html = homeHtml();
  }
  const keepSearchFocus = view.name === 'removed' && document.activeElement?.id === 'search';
  root.innerHTML = html;
  if (keepSearchFocus) {
    const input = document.getElementById('search');
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  if (view.name === 'study' && session.lastAnswer && MODES.find((m) => m.id === session.mode).autoAdvances !== false) advanceTimer = setTimeout(next, AUTO_ADVANCE_MILLIS);
}

function show(name) { view = { name }; menuOpen = false; render(); window.scrollTo(0, 0); }

function next() {
  session = controller.advance(session);
  render();
}

function toast(text) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// ---- events ----------------------------------------------------------------------------------

const actions = {
  study(el) { session = controller.startSession(el.dataset.mode); show('study'); },
  choose(el) { session = controller.answer(session, el.dataset.choice); render(); },
  next() { next(); },
  menu() { menuOpen = !menuOpen; render(); },
  suspend(el) { session = controller.suspendCurrentCard(session, el.dataset.duration); menuOpen = false; render(); },
  quit() { clearTimeout(advanceTimer); calendarMonth = null; show('home'); },
  home() { calendarMonth = null; show('home'); },
  'prev-month'() { shiftMonth(-1); },
  'next-month'() { shiftMonth(1); },
  settings() { show('settings'); },
  removed() { query = ''; show('removed'); },
  restore(el) { controller.restoreCard(el.dataset.id); render(); },
  'restore-suspended'() { if (confirm(`${t('confirm_suspended_title')}\n${t('confirm_suspended_body')}`)) { controller.restoreAll('SUSPENDED'); render(); } },
  'restore-removed'() { if (confirm(`${t('confirm_removed_title')}\n${t('confirm_removed_body')}`)) { controller.restoreAll('REMOVED'); render(); } },
  'reset-all'() {
    if (confirm(`${t('confirm_all_title')}\n${t('confirm_all_body')}`)) {
      controller.resetAllProgress(); render();
    }
  },
  export() {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(controller.exportData())], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `german-quiz-backup-${stamp}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  },
};

function shiftMonth(delta) {
  const m = calendarMonth ?? controller.currentMonth();
  const index = m.year * 12 + m.month + delta;
  const cur = controller.currentMonth();
  if (index > cur.year * 12 + cur.month) return;
  calendarMonth = { year: Math.floor(index / 12), month: index % 12 };
  render();
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el);
  else if (menuOpen && !e.target.closest('.menu')) { menuOpen = false; render(); }
});

root.addEventListener('change', async (e) => {
  if (e.target.name === 'theme') { store.saveTheme(e.target.value); applyTheme(e.target.value); }
  else if (e.target.name === 'language') { store.saveLanguage(e.target.value); await applyLanguage(); render(); }
  else if (e.target.id === 'goal') { controller.setDailyGoal(Number(e.target.value)); render(); }
  else if (e.target.id === 'import' && e.target.files[0]) {
    try {
      controller.importData(JSON.parse(await e.target.files[0].text()));
      render(); toast(t('web_backup_restored'));
    } catch (err) { toast(err.message || t('web_read_failed')); }
  }
});

root.addEventListener('input', (e) => {
  if (e.target.id === 'goal') document.getElementById('goal-label').textContent = t('settings_daily_goal_value', e.target.value);
  else if (e.target.id === 'search') { query = e.target.value; render(); }
});

// ---- boot ------------------------------------------------------------------------------------

// Sets --layout / --text, the factors style.css multiplies its sizes by.
function applyScreenScale() {
  const { layout, text } = screenScaleFor(window.innerHeight);
  document.documentElement.style.setProperty('--layout', layout);
  document.documentElement.style.setProperty('--text', text);
}

const LANGUAGE_KEYS = { en: 'english', de: 'german', pt: 'portuguese', es: 'spanish' };

/** Resolves the stored choice against the browser, loads the translated vocabulary text and updates <html lang>. */
async function applyLanguage() {
  language = resolveLanguage(store.loadLanguage(), navigator.languages?.length ? navigator.languages : [navigator.language]);
  t = createTranslator(language);
  document.documentElement.lang = language;
  if (language === 'en') { content = NO_CONTENT_TRANSLATIONS; return; }
  try {
    contentCache[language] ??= await fetch(`i18n/${language}.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    content = contentCache[language];
  } catch { content = NO_CONTENT_TRANSLATIONS; }                    // shown in English rather than not at all
}

async function boot() {
  applyScreenScale();
  window.addEventListener('resize', applyScreenScale);
  applyTheme(store.loadTheme());
  await applyLanguage();
  try {
    const [nouns, preps, verbs, errors] = await Promise.all(['vocab/nouns.json', 'vocab/prepositions.json', 'vocab/verbs.json', 'vocab/errors.json'].map((u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.json();
    })));
    controller = new StudyController(buildDeck(nouns, preps, verbs, errors), store);
  } catch (err) { console.error('failed to initialise', err); }
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) {
    // A new service worker takes over (skipWaiting + claim) while the page is still the old one: reload once so the
    // player sees the new version right away. The first install has no controller yet and must not reload.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading || view.name === 'study') return;
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// Coming back to the app on a new day (or after minutes in learning) refreshes counts.
document.addEventListener('visibilitychange', () => { if (!document.hidden && view.name === 'home') render(); });
boot();
