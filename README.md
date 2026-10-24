# German Quiz (web)

iPhone-friendly web version of the German B2 vocabulary quiz: five modes (der/die/das, prepositions,
plural forms, Präteritum, and Fehler finden: tap the wrong part of a B2 forum-post or formal-e-mail sentence), Anki-style spaced repetition, daily goal, streak calendar, offline.

No build step and no dependencies: plain ES modules.

- `src/domain.js` scheduler, grader, queue pipeline, session engine, calendar (pure, no DOM)
- `src/content.js` vocabulary -> cards and distractors
- `src/controller.js` application service; `src/store.js` localStorage; `src/app.js` UI
- `vocab/` word lists (same files as the Android app; `errors.json` is built from its `tools/data/errors.tsv`); `sw.js` offline cache

Run tests: `npm test` (Node 22+); GitHub Actions runs them on every push (`.github/workflows/test.yml`).
`tests/architecture.test.js` holds the dependency rules above (who may import whom; only `app.js` and `store.js`
touch the browser): a new module needs an entry there. A port of an app version that is still in beta waits on a
branch `web-<version>` (for example `web-2.6`) and is merged into `main`, which GitHub Pages serves, when the app is promoted.
Run locally: `python3 -m http.server` and open http://localhost:8000.

Install on iPhone: open the page in Safari, Share, "Add to Home Screen". Progress lives in the browser's
storage on that device; use Settings > Backup to save or restore it. It is separate from the Android app.

When a cached file changes, bump `VERSION` in `sw.js` so installed copies update. The service worker is network first (cache only
as the offline fallback) and the page reloads once when a new worker takes over, so a deploy shows up on the next open, not the one after.

Maintenance: `tools/pipeline-check.sh` (Rust, copied from `~/dev/project-template`) runs the tests and the fitness checks and writes `build/pipeline-check/report.json`; limits are in `pipeline-check.toml`, changed only by Giovanni. CI runs it on every push.
