// Architecture rules (fitness functions): which module may depend on which. See ~/dev/QuizApp/docs/adr/0009.
// Only app.js talks to the page and store.js to browser storage; the logic stays testable in plain Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const src = new URL('../src/', import.meta.url);
const modules = readdirSync(src).filter((f) => f.endsWith('.js'));
const code = (f) => readFileSync(new URL(f, src), 'utf8');
const importsOf = (f) => [...code(f).matchAll(/from\s+'\.\/([\w-]+\.js)'/g)].map((m) => m[1]);
const BROWSER = /\b(document|window|navigator|localStorage|sessionStorage|location)\b/;

// Who may import whom. A module missing here fails the test, so a new file needs a conscious entry.
const ALLOWED = {
  'domain.js': [],
  'strings.js': [],
  'content.js': ['domain.js'],
  'i18n.js': ['strings.js'],
  'store.js': [],
  'controller.js': ['domain.js'],
  'app.js': ['domain.js', 'content.js', 'controller.js', 'store.js', 'i18n.js'],
};

test('every module has an entry in the dependency rules', () => {
  assert.deepEqual(modules.filter((m) => !(m in ALLOWED)), []);
});

test('modules import only what the rules allow', () => {
  for (const m of modules) {
    const extra = importsOf(m).filter((i) => !ALLOWED[m]?.includes(i));
    assert.deepEqual(extra, [], `${m} imports ${extra}`);
  }
});

test('only app.js and store.js touch the browser', () => {
  for (const m of modules.filter((x) => x !== 'app.js' && x !== 'store.js')) {
    const body = code(m).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').replace(/'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "''");
    assert.ok(!BROWSER.test(body), `${m} uses a browser global: ${body.match(BROWSER)?.[0]}`);
  }
});
