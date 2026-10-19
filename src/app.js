// UI layer: renders the screens and wires taps to the StudyController. All logic lives in domain.js.
import { buildDeck } from './content.js';
import { StudyController } from './controller.js';
import { createLocalStore } from './store.js';
import { screenScaleFor, heatColorCss, HEAT_FULL_ANSWERS, MIN_DAILY_GOAL, MAX_DAILY_GOAL, DAILY_GOAL_STEP, MODES } from './domain.js';

const AUTO_ADVANCE_MILLIS = 500;
const MAX_RESULTS = 40;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const root = document.getElementById('app');
const store = createLocalStore();
let controller = null;
let view = { name: 'home' };
let session = null;
let calendarMonth = null;
let query = '';
let menuOpen = false;
let advanceTimer = null;

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
        <button class="link" data-action="prev-month" aria-label="Previous month">‹</button>
        <span class="title">${MONTHS[month.month]} ${month.year}</span>
        <button class="link" data-action="next-month" aria-label="Next month" ${cal.canGoNext ? '' : 'disabled'}>›</button>
        <span class="grow"></span>
        <button class="link" data-action="settings">Settings</button>
      </div>
      <p class="small">Streak ${cal.currentStreak} · longest ${cal.longestStreak} · ${days} ${days === 1 ? 'day' : 'days'} this month</p>
      <div class="cal-grid" style="margin-top:6px">${WEEKDAYS.map((w) => `<div class="cal-dow">${w}</div>`).join('')}${cells}</div>
      <div class="legend"><span>1</span><div class="bar" style="background:linear-gradient(90deg,${gradient})"></div><span>${HEAT_FULL_ANSWERS}+ answers</span></div>
    </section>
    <section class="card">
      <p class="title">${daily.reached ? `Daily goal reached ✓  ${daily.answered} / ${daily.goal}` : `Today: ${daily.answered} / ${daily.goal} questions`}</p>
      <div class="progress"><div style="width:${Math.round(daily.fraction * 100)}%"></div></div>
    </section>
    ${controller.overview().map((m) => {
      const due = m.stats.learningDue + m.stats.reviewsDue + m.stats.newAvailable;
      return `<section class="card row">
        <div class="grow">
          <p class="title">${esc(m.mode.title)}</p>
          <p class="small mode-instruction">${esc(m.mode.instruction)}</p>
          <p class="small">New ${m.stats.newAvailable} · Learning ${m.stats.learningDue} · Review ${m.stats.reviewsDue} · Deck ${m.totalCards}</p>
        </div>
        <button class="btn" data-action="study" data-mode="${m.mode.id}" ${due > 0 ? '' : 'disabled'}>${due > 0 ? `Study (${due})` : 'Done'}</button>
      </section>`;
    }).join('')}`;
}

function studyHtml() {
  const card = session.queue[0];
  const answer = session.lastAnswer;
  const daily = controller.dailyProgress();
  const mode = MODES.find((m) => m.id === session.mode);
  const choices = controller.choices(session).map((option) => {
    let cls = '';
    if (answer) cls = option === card.correctChoice ? ' correct' : option === answer.chosen ? ' wrong' : ' dim';
    return `<button class="choice${cls}" data-action="choose" data-choice="${esc(option)}" ${answer ? 'disabled' : ''}>${esc(option)}</button>`;
  }).join('');
  const menu = menuOpen && !answer ? `<div class="menu-pop">
      <button data-action="suspend" data-duration="ONE_WEEK">Remove for 1 week</button>
      <button data-action="suspend" data-duration="ONE_MONTH">Remove for 1 month</button>
      <button data-action="suspend" data-duration="PERMANENT">Remove permanently</button></div>` : '';
  return `
    <div class="row between">
      <span class="small">${esc(mode.title)} · ${session.queue.length} left · today ${daily.answered}/${daily.goal}</span>
      <span class="row"><button class="link" data-action="quit">Quit</button>
        <span class="menu"><button class="link dots" data-action="menu" ${answer ? 'disabled' : ''} aria-label="More">⋮</button>${menu}</span></span>
    </div>
    <div class="study col" style="display:flex;flex-direction:column;gap:calc(12px * var(--layout))">
      <h1 class="prompt">${esc(card.prompt)}</h1>
      ${card.hint ? `<p class="hint">Hint: ${esc(card.hint)}</p>` : ''}
      ${card.context ? `<p class="context">${esc(card.context)}</p>` : ''}
      ${choices}
      ${answer ? `<p class="explanation">${esc(card.explanation)}</p>` : ''}
    </div>`;
}

function finishedHtml() {
  return `<div class="section center">
    <h1>Session complete</h1>
    <p class="title">${session.correctCount} correct · ${session.wrongCount} wrong</p>
    <button class="btn outline" data-action="home">Back to modes</button></div>`;
}

function settingsHtml() {
  const theme = store.loadTheme();
  const goal = controller.dailyProgress().goal;
  const counts = controller.managedCounts();
  const radio = (value, label) =>
    `<label class="radio"><input type="radio" name="theme" value="${value}" ${theme === value ? 'checked' : ''}>${label}</label>`;
  return `<div class="section">
    <div class="row between"><h1>Settings</h1><button class="link" data-action="home">Done</button></div>
    <h3>Appearance</h3>
    ${radio('SYSTEM', 'Use system default')}${radio('LIGHT', 'Light mode')}${radio('DARK', 'Night mode')}
    <hr>
    <h3>Daily goal</h3>
    <p id="goal-label">${goal} questions per day (any quiz)</p>
    <input id="goal" type="range" min="${MIN_DAILY_GOAL}" max="${MAX_DAILY_GOAL}" step="${DAILY_GOAL_STEP}" value="${goal}">
    <hr>
    <h3>Removed questions</h3>
    <p>Suspended: ${counts.suspended}  ·  Removed: ${counts.removed}</p>
    <button class="btn outline" data-action="removed">Manage suspended and removed questions</button>
    <hr>
    <h3>Backup</h3>
    <p class="small">Progress is stored on this device only. Save a backup file to move it to another device or keep it safe.</p>
    <button class="btn outline" data-action="export">Save backup file</button>
    <label class="btn outline" style="text-align:center;display:block">Restore from backup file
      <input id="import" type="file" accept="application/json,.json" hidden></label>
    <hr>
    <h3>Progress</h3>
    <button class="btn outline danger" data-action="reset-all">Reset all progress</button>
  </div>`;
}

function removedHtml() {
  const counts = controller.managedCounts();
  const results = controller.managedCards(query);
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const rows = results.slice(0, MAX_RESULTS).map((m) => `
    <div class="card row">
      <div class="grow"><p class="title">${esc(m.card.prompt)}</p>
        ${m.card.context ? `<p class="small">${esc(m.card.context)}</p>` : ''}
        <p class="small">${esc(MODES.find((x) => x.id === m.card.mode).title)} · ${m.status === 'REMOVED' ? 'Removed' : `Suspended until ${fmt(m.suspendedUntilMillis)}`}</p></div>
      <button class="link" data-action="restore" data-id="${esc(m.card.id)}">Restore</button>
    </div>`).join('');
  const empty = results.length ? '' : `<p>${counts.suspended + counts.removed === 0 ? 'No suspended or removed cards.' : `No card matches “${esc(query)}”.`}</p>`;
  return `<div class="section">
    <div class="row between"><h1>Removed questions</h1><button class="link" data-action="settings">Back</button></div>
    <p>Suspended: ${counts.suspended}  ·  Removed: ${counts.removed}</p>
    <button class="btn outline" data-action="restore-suspended" ${counts.suspended ? '' : 'disabled'}>Reset all suspended cards</button>
    <button class="btn outline" data-action="restore-removed" ${counts.removed ? '' : 'disabled'}>Reset all removed cards</button>
    <input id="search" type="search" placeholder="Search suspended or removed cards" value="${esc(query)}" autocomplete="off">
    ${empty}${rows}
    ${results.length > MAX_RESULTS ? `<p class="small">Showing ${MAX_RESULTS} of ${results.length}. Refine the search to see more.</p>` : ''}
  </div>`;
}

function render() {
  clearTimeout(advanceTimer);
  if (!controller) { root.innerHTML = '<p class="card">Could not load the vocabulary. Check your connection and reload.</p>'; return; }
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
  if (view.name === 'study' && session.lastAnswer) advanceTimer = setTimeout(next, AUTO_ADVANCE_MILLIS);
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
  menu() { menuOpen = !menuOpen; render(); },
  suspend(el) { session = controller.suspendCurrentCard(session, el.dataset.duration); menuOpen = false; render(); },
  quit() { clearTimeout(advanceTimer); calendarMonth = null; show('home'); },
  home() { calendarMonth = null; show('home'); },
  'prev-month'() { shiftMonth(-1); },
  'next-month'() { shiftMonth(1); },
  settings() { show('settings'); },
  removed() { query = ''; show('removed'); },
  restore(el) { controller.restoreCard(el.dataset.id); render(); },
  'restore-suspended'() { if (confirm('Reset suspended cards?\nAll suspended questions return to the pool.')) { controller.restoreAll('SUSPENDED'); render(); } },
  'restore-removed'() { if (confirm('Reset removed cards?\nAll permanently removed questions return to the pool.')) { controller.restoreAll('REMOVED'); render(); } },
  'reset-all'() {
    if (confirm('Reset all progress?\nThis erases every learning state, suspension and removal. It cannot be undone.')) {
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
  else if (e.target.id === 'goal') { controller.setDailyGoal(Number(e.target.value)); render(); }
  else if (e.target.id === 'import' && e.target.files[0]) {
    try {
      controller.importData(JSON.parse(await e.target.files[0].text()));
      render(); toast('Backup restored.');
    } catch (err) { toast(err.message || 'Could not read that file.'); }
  }
});

root.addEventListener('input', (e) => {
  if (e.target.id === 'goal') document.getElementById('goal-label').textContent = `${e.target.value} questions per day (any quiz)`;
  else if (e.target.id === 'search') { query = e.target.value; render(); }
});

// ---- boot ------------------------------------------------------------------------------------

// Sets --layout / --text, the factors style.css multiplies its sizes by.
function applyScreenScale() {
  const { layout, text } = screenScaleFor(window.innerHeight);
  document.documentElement.style.setProperty('--layout', layout);
  document.documentElement.style.setProperty('--text', text);
}

async function boot() {
  applyScreenScale();
  window.addEventListener('resize', applyScreenScale);
  applyTheme(store.loadTheme());
  try {
    const [nouns, preps, verbs] = await Promise.all(['vocab/nouns.json', 'vocab/prepositions.json', 'vocab/verbs.json'].map((u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.json();
    })));
    controller = new StudyController(buildDeck(nouns, preps, verbs), store);
  } catch (err) { console.error('failed to initialise', err); }
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Coming back to the app on a new day (or after minutes in learning) refreshes counts.
document.addEventListener('visibilitychange', () => { if (!document.hidden && view.name === 'home') render(); });
boot();
