#!/usr/bin/env bash
# Quality gate: the web test suite plus the pipeline-check program's own tests and fitness checks.
# CI runs it through tools/pipeline-check (ADR-0013 of ~/dev/QuizApp: the program measures and blocks).
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
cargo test --quiet --manifest-path tools/pipeline-check/Cargo.toml
tools/pipeline-check.sh --measure-only
