// REQ SP-1 SP-2 SP-3 SP-4 SP-5 GR-1 WB-1
// Runs the same hand-computed vectors as the Android app (tests/conformance/scheduler.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MINUTE_MILLIS, DAY_MILLIS, freshProgress, scheduleNext, gradeAnswer } from '../src/domain.js';

const doc = JSON.parse(readFileSync(new URL('./conformance/scheduler.json', import.meta.url), 'utf8'));
const t0 = 1_000 * DAY_MILLIS;

test('scheduler reproduces every vector', () => {
  for (const sc of doc.scenarios) {
    let p = freshProgress('c');
    if (sc.start.phase !== 'NEW') p = { ...p, phase: sc.start.phase, intervalDays: sc.start.interval, easeFactor: sc.start.ease, firstSeenAtMillis: 1 };
    sc.steps.forEach((st, i) => {
      const at = t0 + st.at * MINUTE_MILLIS;
      p = scheduleNext(p, st.grade, at);
      const where = `${sc.id}, step ${i + 1}`;
      const e = st.expect;
      if (e.phase !== undefined) assert.equal(p.phase, e.phase, `${where} phase`);
      if (e.interval !== undefined) assert.equal(p.intervalDays, e.interval, `${where} interval`);
      if (e.dueIn !== undefined) assert.equal(p.dueAtMillis - at, e.dueIn * MINUTE_MILLIS, `${where} due`);
      if (e.ease !== undefined) assert.ok(Math.abs(p.easeFactor - e.ease) < 1e-9, `${where} ease ${p.easeFactor}`);
      if (e.lapses !== undefined) assert.equal(p.lapses, e.lapses, `${where} lapses`);
    });
  }
});

test('grader reproduces every vector', () => {
  for (const r of doc.grader) assert.equal(gradeAnswer(r.correct, r.ms, r.phase), r.grade, JSON.stringify(r));
});
