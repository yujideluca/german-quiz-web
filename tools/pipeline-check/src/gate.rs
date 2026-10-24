//! Check a: the project gate runs once; its exit code and duration are recorded.
use crate::config::Gate;
use crate::report::{Check, Status};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

pub const ID: &str = "gate";

/// Returns the check and the gate's duration in seconds when it ran.
pub fn run(root: &Path, cfg: &Gate, skip: bool) -> (Check, Option<f64>) {
    if skip {
        return (Check::skipped(ID, cfg.required, "gate not run (--no-gate)"), None);
    }
    let start = Instant::now();
    let result = Command::new("sh").arg("-c").arg(&cfg.command).current_dir(root).status();
    let secs = start.elapsed().as_secs_f64();
    match result {
        Ok(s) if s.success() => (Check::new(ID, Status::Ok, Some(secs), None, None), Some(secs)),
        Ok(s) => {
            let nota = format!("gate exited with {}", s.code().map_or("a signal".into(), |c| c.to_string()));
            (Check::new(ID, Status::Falha, Some(secs), None, Some(nota)), Some(secs))
        }
        Err(e) => (Check::new(ID, Status::Falha, None, None, Some(format!("cannot start the gate: {e}"))), None),
    }
}
