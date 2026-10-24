#!/usr/bin/env bash
# Builds (cached by cargo) and runs tools/pipeline-check with the given arguments; see docs/adr/0013.
#   tools/pipeline-check.sh                  full run: gate, architecture, fitness, DORA, GitHub (local mode)
#   tools/pipeline-check.sh --measure-only   only architecture and fitness (what the gate calls)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ~/.cargo/env ] && source ~/.cargo/env
cargo build --release --quiet --manifest-path tools/pipeline-check/Cargo.toml
exec tools/pipeline-check/target/release/pipeline-check "$@"
