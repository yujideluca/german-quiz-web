//! The program run against small fixture projects: the acceptance criteria of the design.
use pipeline_check::config::Config;
use pipeline_check::github::Gh;
use pipeline_check::report::{Mode, Report, Status};
use pipeline_check::{run, Options};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

struct NoGh;
impl Gh for NoGh {
    fn run(&self, _: &[&str]) -> Result<String, String> {
        Err("gh unavailable".into())
    }
}

fn fixture(config_extra: &str) -> (PathBuf, Config) {
    static N: AtomicUsize = AtomicUsize::new(0);
    let root = std::env::temp_dir().join(format!("pc-e2e-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(root.join("core/src")).unwrap();
    std::fs::write(root.join("core/build.gradle.kts"), "// pure\nplugins { kotlin(\"jvm\") }\n").unwrap();
    write_lines(&root.join("core/src/Clean.kt"), 10, None);
    let toml = format!(
        "projeto = \"fixture\"\n[gate]\ncommand = \"true\"\n[architecture]\npure_dirs = [\"core/src\"]\nbuild_files = [\"core/build.gradle.kts\"]\n{config_extra}"
    );
    std::fs::write(root.join("pipeline-check.toml"), toml).unwrap();
    let cfg = Config::load(&root.join("pipeline-check.toml")).unwrap();
    (root, cfg)
}

fn write_lines(path: &Path, n: usize, first: Option<&str>) {
    let mut text = String::new();
    if let Some(l) = first {
        text.push_str(l);
        text.push('\n');
    }
    for i in 0..n {
        text.push_str(&format!("// line {i}\n"));
    }
    std::fs::write(path, text).unwrap();
}

fn go(root: &Path, cfg: &Config, mode: Mode, skip_gate: bool) -> Report {
    run(root, cfg, &Options { mode, skip_gate, measure_only: false, now: 1_792_800_000 }, &NoGh)
}

fn status(r: &Report, id: &str) -> Status {
    r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("no check {id}")).status
}

const LINES: &str = "\n[[fitness]]\nid = \"file-lines\"\nkind = \"max_file_lines\"\nlimit = 100\ndirs = [\"core/src\"]\nextensions = [\"kt\"]\n";

// REQ PC-3
#[test]
fn a_planted_android_import_fails_the_run() {
    let (root, cfg) = fixture("");
    assert_eq!(go(&root, &cfg, Mode::Ci, false).exit_code(), 0);
    write_lines(&root.join("core/src/Sneaky.kt"), 3, Some("import android.os.Bundle"));
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&r, "arquitetura"), Status::Falha);
    assert_eq!(r.exit_code(), 1);
    let nota = r.checks.iter().find(|c| c.id == "arquitetura").unwrap().nota.clone().unwrap();
    assert!(nota.contains("Sneaky.kt:1"), "violation not located: {nota}");
}

// REQ PC-3
#[test]
fn android_in_the_build_file_fails_but_a_comment_does_not() {
    let (root, cfg) = fixture("");
    std::fs::write(root.join("core/build.gradle.kts"), "// no android here\nplugins { id(\"com.android.library\") }\n").unwrap();
    assert_eq!(status(&go(&root, &cfg, Mode::Ci, false), "arquitetura"), Status::Falha);
}

// REQ PC-2
#[test]
fn a_file_at_85_percent_of_its_limit_warns_without_failing() {
    let (root, cfg) = fixture(LINES);
    write_lines(&root.join("core/src/Big.kt"), 85, None);
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&r, "file-lines"), Status::Aviso);
    assert_eq!(r.exit_code(), 0);
    write_lines(&root.join("core/src/Big.kt"), 100, None);
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&r, "file-lines"), Status::Falha);
    assert_eq!(r.exit_code(), 1);
}

// REQ PC-5
#[test]
fn a_failing_gate_fails_the_run_and_its_time_is_measured() {
    let (root, mut cfg) = fixture(&format!("{LINES}\n[[fitness]]\nid = \"gate-seconds\"\nkind = \"gate_seconds\"\nlimit = 600\n"));
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&r, "gate"), Status::Ok);
    assert!(r.checks.iter().find(|c| c.id == "gate-seconds").unwrap().valor.is_some());
    cfg.gate.command = "exit 3".into();
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&r, "gate"), Status::Falha);
    assert_eq!(r.exit_code(), 1);
}

// REQ PC-4
#[test]
fn skipping_the_gate_is_pulado_but_fails_when_the_gate_is_required() {
    let (root, mut cfg) = fixture("");
    assert_eq!(status(&go(&root, &cfg, Mode::Ci, true), "gate"), Status::Falha);
    cfg.gate.required = false;
    let r = go(&root, &cfg, Mode::Local, true);
    assert_eq!(status(&r, "gate"), Status::Pulado);
    assert_eq!(r.exit_code(), 0);
}

// REQ PC-4
#[test]
fn github_checks_are_pulado_in_ci_mode_and_the_report_states_the_mode() {
    let (root, cfg) = fixture("\n[github]\nrepo = \"o/r\"\nrequired_check = \"gate\"\n");
    let ci = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(status(&ci, "ci-verde"), Status::Pulado);
    assert_eq!(status(&ci, "protecao-de-branch"), Status::Pulado);
    assert_eq!(ci.modo, Mode::Ci);
    let local = go(&root, &cfg, Mode::Local, false);
    assert_eq!(local.modo, Mode::Local);
    assert_eq!(status(&local, "protecao-de-branch"), Status::Pulado); // NoGh: unavailable, never ok
}

// REQ PC-4
#[test]
fn a_measurement_that_cannot_be_taken_is_never_ok() {
    let (root, cfg) = fixture("\n[[fitness]]\nid = \"apk\"\nkind = \"file_size\"\nlimit = 1000\npath = \"app.apk\"\n");
    assert_eq!(status(&go(&root, &cfg, Mode::Ci, false), "apk"), Status::Pulado);
}

// REQ PC-6
#[test]
fn dora_without_data_is_null_and_does_not_fail() {
    let (root, cfg) = fixture("");
    let r = go(&root, &cfg, Mode::Ci, false);
    assert!(r.dora.frequencia.is_none() && r.dora.lead_time.is_none() && r.dora.retrabalho.is_none());
    assert_eq!(r.exit_code(), 0);
}

// REQ PC-6
#[test]
fn dora_reads_the_decision_log() {
    let (root, cfg) = fixture("");
    std::fs::write(root.join("DESIGN.md"), "| 2026-10-20 | Preventive | x |\n| 2026-10-21 | Corrective | y |\n").unwrap();
    let r = go(&root, &cfg, Mode::Ci, false);
    assert_eq!(r.dora.parcela_preventiva, Some(50.0));
    assert_eq!(r.dora.retrabalho, Some(50.0));
}

// REQ PC-1
#[test]
fn the_binary_writes_report_json_and_exits_by_the_worst_status() {
    let (root, _) = fixture(LINES);
    write_lines(&root.join("core/src/Big.kt"), 85, None);
    let exe = env!("CARGO_BIN_EXE_pipeline-check");
    let out = std::process::Command::new(exe).args(["--root"]).arg(&root).args(["--mode", "ci"]).output().unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root.join("build/pipeline-check/report.json")).unwrap()).unwrap();
    assert_eq!(json["modo"], "ci");
    assert!(json["checks"].as_array().unwrap().iter().any(|c| c["id"] == "file-lines" && c["status"] == "aviso"));
    write_lines(&root.join("core/src/Sneaky.kt"), 1, Some("import androidx.core.app.X"));
    let out = std::process::Command::new(exe).args(["--root"]).arg(&root).args(["--mode", "ci"]).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
}

// REQ PC-8
#[test]
fn a_missing_config_exits_with_2() {
    let dir = std::env::temp_dir().join(format!("pc-noconf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_pipeline-check")).arg("--root").arg(&dir).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("cannot read"));
}
