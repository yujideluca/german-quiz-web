//! Check c: fitness functions, each with a limit; warning from `aviso_a`, failure at 100 %.
use crate::config::{Config, Fitness, Kind};
use crate::fsutil::{has_ext, walk};
use crate::report::{classify, Check};
use std::path::Path;

fn measure(root: &Path, f: &Fitness, gate_seconds: Option<f64>) -> Result<(f64, Option<String>), String> {
    match f.kind {
        Kind::MaxFileLines => {
            let mut biggest = (0usize, String::from("(no files)"));
            for dir in &f.dirs {
                for p in walk(&root.join(dir)).into_iter().filter(|p| has_ext(p, &f.extensions)) {
                    let n = std::fs::read_to_string(&p).map(|t| t.lines().count()).unwrap_or(0);
                    if n > biggest.0 {
                        biggest = (n, p.strip_prefix(root).unwrap_or(&p).display().to_string());
                    }
                }
            }
            Ok((biggest.0 as f64, Some(format!("largest: {}", biggest.1))))
        }
        Kind::FileSize => {
            let path = f.path.as_deref().ok_or("file_size needs a path")?;
            match std::fs::metadata(root.join(path)) {
                Ok(m) => Ok((m.len() as f64, None)),
                Err(_) => Err(format!("{path} not found (build it first)")),
            }
        }
        Kind::GateSeconds => gate_seconds.map(|s| (s, None)).ok_or_else(|| "the gate did not run".to_string()),
    }
}

pub fn check_all(root: &Path, cfg: &Config, gate_seconds: Option<f64>, measure_only: bool) -> Vec<Check> {
    cfg.fitness
        .iter()
        .filter(|f| !(measure_only && f.kind == Kind::GateSeconds))
        .map(|f| match measure(root, f, gate_seconds) {
            Ok((value, nota)) => {
                Check::new(&f.id, classify(value, f.limit, cfg.aviso_a), Some(value), Some(f.limit), nota)
            }
            // A measurement that could not be taken is never "ok" (PC-4).
            Err(why) => Check::skipped(&f.id, false, &why),
        })
        .collect()
}
