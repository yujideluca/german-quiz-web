use clap::{Parser, ValueEnum};
use pipeline_check::{config::Config, github::RealGh, report::Mode, run, Options};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Clone, Copy, ValueEnum)]
enum ModeArg {
    Local,
    Ci,
}

/// Measures the project against its limits and writes report.json. Exit 1 if any check failed, 2 on bad config.
#[derive(Parser)]
struct Args {
    /// repository root
    #[arg(long, default_value = ".")]
    root: PathBuf,
    /// limits file (default: <root>/pipeline-check.toml)
    #[arg(long)]
    config: Option<PathBuf>,
    /// default: ci when the CI environment variable is "true", else local
    #[arg(long)]
    mode: Option<ModeArg>,
    /// where to write the report (default: <root>/build/pipeline-check/report.json)
    #[arg(long)]
    out: Option<PathBuf>,
    /// run this command as the gate instead of the one in the config (CI passes --mutation on schedule)
    #[arg(long)]
    gate_command: Option<String>,
    /// only architecture and fitness checks (no gate, GitHub or DORA); what quality_gate.sh itself calls
    #[arg(long)]
    measure_only: bool,
    /// measure this file in every file_size fitness function (publish_apk.sh passes the APK it just built)
    #[arg(long)]
    apk: Option<PathBuf>,
    /// do not run the project gate (reported as pulado; fails when the gate is required)
    #[arg(long)]
    no_gate: bool,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let config_path = args.config.unwrap_or_else(|| args.root.join("pipeline-check.toml"));
    let mut cfg = match Config::load(&config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("pipeline-check: {e}");
            return ExitCode::from(2);
        }
    };
    if let Some(cmd) = args.gate_command {
        cfg.gate.command = cmd;
    }
    if let Some(apk) = args.apk {
        for f in cfg.fitness.iter_mut().filter(|f| f.kind == pipeline_check::config::Kind::FileSize) {
            f.path = Some(apk.display().to_string());
        }
    }
    let mode = match args.mode {
        Some(ModeArg::Local) => Mode::Local,
        Some(ModeArg::Ci) => Mode::Ci,
        None if std::env::var("CI").as_deref() == Ok("true") => Mode::Ci,
        None => Mode::Local,
    };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let report = run(&args.root, &cfg, &Options { mode, skip_gate: args.no_gate, measure_only: args.measure_only, now }, &RealGh);

    let out = args.out.unwrap_or_else(|| args.root.join("build/pipeline-check/report.json"));
    if let Some(dir) = out.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(&report).expect("report serializes");
    if let Err(e) = std::fs::write(&out, json + "\n") {
        eprintln!("pipeline-check: cannot write {}: {e}", out.display());
        return ExitCode::from(2);
    }
    for c in &report.checks {
        println!("{:<8} {:<22} {}", format!("{:?}", c.status).to_uppercase(), c.id, c.nota.as_deref().unwrap_or(""));
    }
    println!("mode {:?}; report: {}", report.modo, out.display());
    ExitCode::from(report.exit_code() as u8)
}
