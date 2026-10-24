//! Check e: read-only questions to GitHub through `gh`. Nothing here changes anything (PC-7).
use crate::config::Github;
use crate::report::{Check, Status};
use std::process::Command;

pub trait Gh {
    /// Runs `gh <args>`; Err carries stderr, or a message when gh cannot start.
    fn run(&self, args: &[&str]) -> Result<String, String>;
}

pub struct RealGh;

impl Gh for RealGh {
    fn run(&self, args: &[&str]) -> Result<String, String> {
        let out = Command::new("gh").args(args).output().map_err(|e| format!("gh unavailable: {e}"))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).into_owned())
        }
    }
}

pub const CI_ID: &str = "ci-verde";
pub const PROTECTION_ID: &str = "protecao-de-branch";

/// (last completed run is green, share of completed runs that succeeded)
pub fn ci_runs(gh: &dyn Gh, cfg: &Github) -> (Check, Option<f64>) {
    let args = ["run", "list", "--repo", &cfg.repo, "--branch", &cfg.branch, "--limit", "30", "--json", "status,conclusion"];
    let text = match gh.run(&args) {
        Ok(t) => t,
        Err(e) => return (Check::skipped(CI_ID, false, &format!("cannot ask GitHub: {}", e.trim())), None),
    };
    let runs: Vec<serde_json::Value> = serde_json::from_str(&text).unwrap_or_default();
    // A cancelled or skipped run says nothing about the code (PC-11).
    let undecided = ["cancelled", "skipped", "neutral", "stale"];
    let done: Vec<&serde_json::Value> = runs
        .iter()
        .filter(|r| r["status"] == "completed" && !undecided.contains(&r["conclusion"].as_str().unwrap_or("")))
        .collect();
    let rate = (!done.is_empty())
        .then(|| 100.0 * done.iter().filter(|r| r["conclusion"] == "success").count() as f64 / done.len() as f64);
    let check = match done.first() {
        None => Check::new(CI_ID, Status::Aviso, None, None, Some("no completed CI run found".into())),
        Some(r) if r["conclusion"] == "success" => Check::new(CI_ID, Status::Ok, None, None, None),
        Some(r) => Check::new(CI_ID, Status::Falha, None, None, Some(format!("last CI run: {}", r["conclusion"]))),
    };
    (check, rate)
}

pub fn protection(gh: &dyn Gh, cfg: &Github) -> Check {
    let path = format!("repos/{}/branches/{}/protection/required_status_checks", cfg.repo, cfg.branch);
    match gh.run(&["api", &path]) {
        Ok(text) => {
            let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            let named = |key: &str, field: &str| {
                v[key].as_array().is_some_and(|a| a.iter().any(|x| x[field].as_str().or(x.as_str()) == Some(&cfg.required_check)))
            };
            if named("contexts", "") || named("checks", "context") {
                Check::new(PROTECTION_ID, Status::Ok, None, None, None)
            } else {
                Check::new(PROTECTION_ID, Status::Falha, None, None, Some(format!("branch protection does not require '{}'", cfg.required_check)))
            }
        }
        Err(e) if e.contains("404") => {
            Check::new(PROTECTION_ID, Status::Falha, None, None, Some(format!("{} has no required status checks", cfg.branch)))
        }
        Err(e) => Check::skipped(PROTECTION_ID, false, &format!("cannot read branch protection: {}", e.trim())),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Answers by the first argument after `gh`; records every call so tests can prove nothing is written.
    pub struct FakeGh {
        pub answers: HashMap<&'static str, Result<String, String>>,
        pub calls: std::cell::RefCell<Vec<Vec<String>>>,
    }

    impl Gh for FakeGh {
        fn run(&self, args: &[&str]) -> Result<String, String> {
            self.calls.borrow_mut().push(args.iter().map(|s| s.to_string()).collect());
            self.answers.get(args[0]).cloned().unwrap_or(Err("gh unavailable".into()))
        }
    }

    fn fake(key: &'static str, answer: Result<&str, &str>) -> FakeGh {
        let mut answers = HashMap::new();
        answers.insert(key, answer.map(String::from).map_err(String::from));
        FakeGh { answers, calls: Default::default() }
    }

    fn cfg() -> Github {
        Github { repo: "o/r".into(), branch: "main".into(), required_check: "gate".into() }
    }

    // REQ PC-7
    #[test]
    fn green_last_run_is_ok_and_red_is_falha() {
        let ok = fake("run", Ok(r#"[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"failure"}]"#));
        let (c, rate) = ci_runs(&ok, &cfg());
        assert_eq!((c.status, rate), (Status::Ok, Some(50.0)));
        let red = fake("run", Ok(r#"[{"status":"in_progress","conclusion":null},{"status":"completed","conclusion":"failure"}]"#));
        assert_eq!(ci_runs(&red, &cfg()).0.status, Status::Falha);
    }

    // REQ PC-7
    #[test]
    fn protection_must_name_the_ci_job_and_a_404_means_unprotected() {
        let yes = fake("api", Ok(r#"{"contexts":["gate"],"checks":[{"context":"gate"}]}"#));
        assert_eq!(protection(&yes, &cfg()).status, Status::Ok);
        let other = fake("api", Ok(r#"{"contexts":["lint"],"checks":[]}"#));
        assert_eq!(protection(&other, &cfg()).status, Status::Falha);
        let none = fake("api", Err("gh: Branch not protected (HTTP 404)"));
        assert_eq!(protection(&none, &cfg()).status, Status::Falha);
    }

    // REQ PC-7
    #[test]
    fn missing_gh_or_forbidden_is_pulado_not_ok() {
        let gone = fake("api", Err("gh unavailable: not found"));
        assert_eq!(protection(&gone, &cfg()).status, Status::Pulado);
        assert_eq!(ci_runs(&gone, &cfg()).0.status, Status::Pulado);
        let denied = fake("api", Err("HTTP 403: Upgrade to GitHub Pro"));
        assert_eq!(protection(&denied, &cfg()).status, Status::Pulado);
    }

    // REQ PC-7
    #[test]
    fn only_read_commands_are_issued() {
        let g = fake("run", Ok("[]"));
        let _ = ci_runs(&g, &cfg());
        let _ = protection(&g, &cfg());
        for call in g.calls.borrow().iter() {
            assert!(matches!(call[0].as_str(), "run" | "api"), "{call:?}");
            assert!(call[0] != "api" || !call.iter().any(|a| ["-X", "--method", "-f", "-F", "--input"].contains(&a.as_str())), "{call:?}");
            assert!(call[0] != "run" || call[1] == "list", "{call:?}");
        }
    }
}
