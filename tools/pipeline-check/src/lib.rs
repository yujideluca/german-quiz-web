//! pipeline-check: measures a project and blocks the merge; it never judges (ADR-0013).
pub mod arch;
pub mod config;
pub mod dora;
pub mod fitness;
pub mod fsutil;
pub mod gate;
pub mod github;
pub mod report;

use config::Config;
use github::Gh;
use report::{Check, Mode, Report, SCHEMA_VERSION};
use std::path::Path;

pub struct Options {
    pub mode: Mode,
    pub skip_gate: bool,
    /// only the checks that need no gate run (what the gate itself calls; no recursion)
    pub measure_only: bool,
    /// seconds since the Unix epoch; a parameter so tests are deterministic
    pub now: u64,
}

pub fn run(root: &Path, cfg: &Config, opts: &Options, gh: &dyn Gh) -> Report {
    let mut checks: Vec<Check> = Vec::new();

    let mut gate_seconds = None;
    if !opts.measure_only {
        let (gate_check, secs) = gate::run(root, &cfg.gate, opts.skip_gate);
        checks.push(gate_check);
        gate_seconds = secs;
    }
    checks.push(arch::check(root, &cfg.architecture));
    checks.extend(fitness::check_all(root, cfg, gate_seconds, opts.measure_only));

    // Check e needs the laptop's GitHub login; CI cannot read branch protection with its default token (C1).
    let mut ci_rate = None;
    let github = if opts.measure_only { &None } else { &cfg.github };
    match (github, opts.mode) {
        (Some(g), Mode::Local) => {
            let (ci, rate) = github::ci_runs(gh, g);
            ci_rate = rate;
            checks.push(ci);
            checks.push(github::protection(gh, g));
        }
        (Some(_), Mode::Ci) => {
            checks.push(Check::skipped(github::CI_ID, false, "runs in local mode only"));
            checks.push(Check::skipped(github::PROTECTION_ID, false, "runs in local mode only"));
        }
        (None, _) => {}
    }

    Report {
        schema_version: SCHEMA_VERSION,
        projeto: cfg.projeto.clone(),
        data: fsutil::iso_date(opts.now),
        modo: opts.mode,
        checks,
        dora: if opts.measure_only { report::Dora::default() } else { dora::compute(root, &cfg.dora, opts.now, ci_rate) },
    }
}
