//! Tests written to find defects (docs/TESTES-AUTOMATIZADOS.md): expected values come from the requirements
//! (docs/REQUIREMENTS.md PC-9..PC-11), not from what the code currently does.
use pipeline_check::config::Architecture;
use pipeline_check::fsutil::walk;
use pipeline_check::github::{ci_runs, Gh};
use pipeline_check::report::Status;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

fn tmp(name: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let d = std::env::temp_dir().join(format!("pc-bugs-{name}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn arch(root: &PathBuf, source: &str, file: &str) -> Status {
    std::fs::create_dir_all(root.join("core/src")).unwrap();
    std::fs::write(root.join("core/src").join(file), source).unwrap();
    let cfg = Architecture { pure_dirs: vec!["core/src".into()], build_files: vec![], forbidden: vec!["android".into(), "androidx".into()] };
    pipeline_check::arch::check(root, &cfg).status
}

// REQ PC-9
#[test]
fn a_java_static_import_of_android_is_a_violation() {
    let r = tmp("static");
    assert_eq!(arch(&r, "import static android.os.Build.VERSION;\nclass A {}\n", "A.java"), Status::Falha);
}

// REQ PC-9
#[test]
fn a_fully_qualified_android_use_without_import_is_a_violation() {
    let r = tmp("fq");
    assert_eq!(arch(&r, "fun f() { android.util.Log.d(\"t\", \"m\") }\n", "B.kt"), Status::Falha);
}

// REQ PC-9
#[test]
fn android_in_comments_or_longer_names_is_not_a_violation() {
    let r = tmp("fp");
    let src = "// talks about android.util.Log\n/* import android.os.Bundle */\n/**\n * android.os.Bundle docs\n */\nimport dev.x.android.Thing\nval a = myandroid.Foo\n";
    assert_eq!(arch(&r, src, "C.kt"), Status::Ok);
}

// REQ PC-10
#[test]
fn walk_terminates_on_a_symlink_loop() {
    let r = tmp("loop");
    std::fs::create_dir_all(r.join("a/b")).unwrap();
    std::fs::write(r.join("a/b/f.kt"), "x").unwrap();
    std::os::unix::fs::symlink(&r, r.join("a/b/up")).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let r2 = r.clone();
    std::thread::spawn(move || {
        let files = walk(&r2);
        let _ = tx.send(files.iter().filter(|p| p.ends_with("f.kt")).count());
    });
    let n = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("walk did not finish (symlink loop)");
    assert_eq!(n, 1, "the real file is listed exactly once");
}

struct Runs(&'static str);
impl Gh for Runs {
    fn run(&self, _: &[&str]) -> Result<String, String> {
        Ok(self.0.to_string())
    }
}

fn github() -> pipeline_check::config::Github {
    pipeline_check::config::Github { repo: "o/r".into(), branch: "main".into(), required_check: "gate".into() }
}

// REQ PC-11
#[test]
fn a_cancelled_latest_run_does_not_make_ci_red() {
    let runs = r#"[{"status":"completed","conclusion":"cancelled"},{"status":"completed","conclusion":"success"}]"#;
    assert_eq!(ci_runs(&Runs(runs), &github()).0.status, Status::Ok);
}

// REQ PC-11
#[test]
fn a_failure_behind_a_cancelled_run_is_still_red() {
    let runs = r#"[{"status":"completed","conclusion":"cancelled"},{"status":"completed","conclusion":"failure"}]"#;
    assert_eq!(ci_runs(&Runs(runs), &github()).0.status, Status::Falha);
}

// REQ PC-11
#[test]
fn only_cancelled_runs_means_no_verdict_not_green() {
    let runs = r#"[{"status":"completed","conclusion":"cancelled"}]"#;
    assert_eq!(ci_runs(&Runs(runs), &github()).0.status, Status::Aviso);
}

// REQ PC-11
#[test]
fn the_success_rate_ignores_cancelled_runs() {
    let runs = r#"[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"cancelled"},{"status":"completed","conclusion":"failure"}]"#;
    assert_eq!(ci_runs(&Runs(runs), &github()).1, Some(50.0));
}

// REQ PC-10
#[test]
fn symlinks_are_not_listed_as_files() {
    let r = tmp("symfile");
    std::fs::write(r.join("real.kt"), "x").unwrap();
    std::os::unix::fs::symlink(r.join("real.kt"), r.join("link.kt")).unwrap();
    let names: Vec<_> = walk(&r).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, ["real.kt"]);
}

// REQ PC-3
#[test]
fn a_build_file_that_only_mentions_android_in_a_comment_is_clean() {
    let r = tmp("buildcomment");
    std::fs::create_dir_all(r.join("core")).unwrap();
    std::fs::write(r.join("core/build.gradle.kts"), "// no android here\n    // nor androidx\nplugins { kotlin(\"jvm\") }\n").unwrap();
    let cfg = Architecture { pure_dirs: vec![], build_files: vec!["core/build.gradle.kts".into()], forbidden: vec!["android".into(), "androidx".into()] };
    assert_eq!(pipeline_check::arch::check(&r, &cfg).status, Status::Ok);
}

// REQ PC-8
#[test]
fn an_unknown_top_level_key_in_the_limits_file_is_rejected() {
    let r = tmp("topkey");
    let toml = "projeto = \"p\"\navisoo_a = 0.5\n[gate]\ncommand = \"true\"\n[architecture]\npure_dirs = []\n";
    std::fs::write(r.join("pipeline-check.toml"), toml).unwrap();
    let err = pipeline_check::config::Config::load(&r.join("pipeline-check.toml")).unwrap_err();
    assert!(err.contains("avisoo_a") || err.contains("unknown field"), "{err}");
}

// REQ PC-1
#[test]
fn measure_only_skips_gate_github_dora_and_the_gate_time_function() {
    let r = tmp("measure");
    std::fs::create_dir_all(r.join("core/src")).unwrap();
    std::fs::write(r.join("DESIGN.md"), "| 2026-10-20 | Preventive | x |\n").unwrap();
    let toml = "projeto = \"p\"\n[gate]\ncommand = \"exit 9\"\n[architecture]\npure_dirs = [\"core/src\"]\n[github]\nrepo = \"o/r\"\nrequired_check = \"gate\"\n[[fitness]]\nid = \"gate-segundos\"\nkind = \"gate_seconds\"\nlimit = 10\n";
    std::fs::write(r.join("pipeline-check.toml"), toml).unwrap();
    let cfg = pipeline_check::config::Config::load(&r.join("pipeline-check.toml")).unwrap();
    struct Never;
    impl Gh for Never {
        fn run(&self, _: &[&str]) -> Result<String, String> {
            panic!("measure-only must not ask GitHub")
        }
    }
    let opts = pipeline_check::Options { mode: pipeline_check::report::Mode::Local, skip_gate: false, measure_only: true, now: 1_792_800_000 };
    let rep = pipeline_check::run(&r, &cfg, &opts, &Never);
    let ids: Vec<_> = rep.checks.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["arquitetura"], "the gate (exit 9) must not have run");
    assert_eq!(rep.exit_code(), 0);
    assert!(rep.dora.parcela_preventiva.is_none());
}
