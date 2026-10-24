# Automated bug-finding tests: German Quiz (web)

Last reviewed: 957be90 2026-10-24 (branch `first-maintenance-review`)
Created by the skill `gerar-teste-automatizado` (create mode). Requirements live in the app's catalogue (`~/dev/QuizApp/docs/REQUIREMENTS.md`); the web twin must behave like the app (WB-1).

## Analysis summary
Plain ES modules without a build step. `domain.js` (scheduler, grader, queue, session, calendar, search) is pure and checked against the app's shared conformance vectors; `controller.js` is the application service (progress, backup); `store.js` is localStorage; `app.js` is the UI. The existing suite (74 tests) covers the domain and the shared vectors. Risks by cost of error: lost or corrupted progress through a backup import, and behaviour that drifts from the app. This review compared the web's backup import with the app's `decodeBackup`, and the search and bar edge cases with the app's fixes.

## Test matrix (`tests/bughunt.test.js`, 7 tests)
| Requirement | Scenario | Expected |
|---|---|---|
| MG-1 | search "strasse" finds "Straße"; "STUHLE" finds "Stühle" | found |
| DG-2 | bar fraction for goal 0 | 0 without answers, 1 with answers, never NaN |
| DG-1 | stored goal `MAX_SAFE_INTEGER`, -1e12, 15 | 100, 10, 20 |
| PE-3 | backup with `progress` or `history` null, a list or a string | refused, nothing replaced |
| PE-3 | key differs from card id; history counts 0, -3, "x" | dropped |
| PE-3 | backup of a newer format | refused |
| PE-3 | imported goal 47; missing goal | snapped to 50; current kept |

## How to run
`npm test` (Node 22+), or `tools/pipeline-check.sh` for the full measurement.

## Results (observed, 2026-10-24)
Before the fixes 3 of the new tests failed (import) and the search and bar tests failed on the old code; after the fixes 81 tests pass, 0 fail. No mutation tool is installed; the failing-before / passing-after pairs are the evidence.

## Coverage
Not measured.

## Defects found (fixed on branch `first-maintenance-review`, waiting to ship with the next app version)
1. **Backup import accepted garbage.** `importData` only checked `typeof ... === 'object'`, which is also true for `null` and arrays, and copied the data unfiltered. A damaged file could crash the app later or replace good progress with entries under the wrong card id or with non-positive history counts; the app's `decodeBackup` drops them. Fix: same filtering and a refusal of a newer format.
2. **Search did not fold the sharp s** ("strasse" did not find "Straße"), as in the app (decided by Giovanni). Fix in `foldForSearch`.
3. **The daily bar fraction was NaN for a goal of 0** (`0/0`). Fix: empty without answers, full with any.

## Limitations and residual risks
The UI (`app.js`), the service worker and `store.js` (localStorage, which needs a browser) are not covered by these tests. Only boundary cases were added.

## Recommendations
1. Run the app's backup files through the web's import in a test (a shared fixture, like the conformance vectors).
2. Add a test for `store.js` with a fake storage that throws (private mode, full quota).
