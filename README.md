# German Quiz (web)

iPhone-friendly web version of the German B2 vocabulary quiz: four modes (der/die/das, prepositions,
plural forms, Präteritum), Anki-style spaced repetition, daily goal, streak calendar, offline.

No build step and no dependencies: plain ES modules.

- `src/domain.js` scheduler, grader, queue pipeline, session engine, calendar (pure, no DOM)
- `src/content.js` vocabulary -> cards and distractors
- `src/controller.js` application service; `src/store.js` localStorage; `src/app.js` UI
- `vocab/` word lists (same files as the Android app); `sw.js` offline cache

Run tests: `npm test` (Node 22+). Run locally: `python3 -m http.server` and open http://localhost:8000.

Install on iPhone: open the page in Safari, Share, "Add to Home Screen". Progress lives in the browser's
storage on that device; use Settings > Backup to save or restore it. It is separate from the Android app.

When a cached file changes, bump `VERSION` in `sw.js` so installed copies update.
