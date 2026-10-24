//! `pipeline-check.toml`: the limits and switches of one project, decided by Giovanni.
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub projeto: String,
    /// share of a limit from which a fitness function warns
    #[serde(default = "default_warn")]
    pub aviso_a: f64,
    pub gate: Gate,
    pub architecture: Architecture,
    #[serde(default)]
    pub fitness: Vec<Fitness>,
    pub github: Option<Github>,
    #[serde(default)]
    pub dora: DoraCfg,
}

fn default_warn() -> f64 {
    0.8
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Gate {
    pub command: String,
    /// when true, not running the gate (for example `--no-gate` in ci mode) fails the run
    #[serde(default = "yes")]
    pub required: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Architecture {
    /// directories whose sources must stay free of the forbidden packages
    pub pure_dirs: Vec<String>,
    #[serde(default)]
    pub build_files: Vec<String>,
    #[serde(default = "default_forbidden")]
    pub forbidden: Vec<String>,
}

fn default_forbidden() -> Vec<String> {
    vec!["android".into(), "androidx".into()]
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    MaxFileLines,
    FileSize,
    GateSeconds,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Fitness {
    pub id: String,
    pub kind: Kind,
    pub limit: f64,
    #[serde(default)]
    pub dirs: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    /// file_size: the file to measure; absent file means the check is skipped
    pub path: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Github {
    /// owner/name
    pub repo: String,
    #[serde(default = "main_branch")]
    pub branch: String,
    /// name of the CI job that branch protection must require
    pub required_check: String,
}

fn main_branch() -> String {
    "main".into()
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct DoraCfg {
    #[serde(default = "thirty")]
    pub days: u64,
    /// git repository with the release history ("beta 2.6 (versionCode 17, sha)" commit subjects)
    pub feed_path: Option<String>,
    #[serde(default = "design")]
    pub decision_log: String,
}

impl Default for DoraCfg {
    fn default() -> Self {
        DoraCfg { days: 30, feed_path: None, decision_log: design() }
    }
}

fn thirty() -> u64 {
    30
}
fn design() -> String {
    "DESIGN.md".into()
}

impl Config {
    pub fn load(path: &Path) -> Result<Config, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        let cfg: Config = toml::from_str(&text).map_err(|e| format!("invalid {}: {e}", path.display()))?;
        cfg.validate().map_err(|e| format!("invalid {}: {e}", path.display()))?;
        Ok(cfg)
    }

    fn validate(&self) -> Result<(), String> {
        if !(0.0 < self.aviso_a && self.aviso_a < 1.0) {
            return Err("aviso_a must be between 0 and 1 (exclusive)".into());
        }
        if let Some(f) = self.fitness.iter().find(|f| f.limit <= 0.0) {
            return Err(format!("fitness '{}': limit must be positive", f.id));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"
projeto = "demo"
[gate]
command = "true"
[architecture]
pure_dirs = ["core/src"]
[[fitness]]
id = "file-lines"
kind = "max_file_lines"
limit = 400
dirs = ["core/src"]
extensions = ["kt"]
"#;

    fn parse(text: &str) -> Result<Config, String> {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pc-config-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pipeline-check.toml");
        std::fs::write(&path, text).unwrap();
        Config::load(&path)
    }

    // REQ PC-8
    #[test]
    fn a_complete_file_loads_with_defaults() {
        let c = parse(GOOD).unwrap();
        assert_eq!(c.aviso_a, 0.8);
        assert_eq!(c.architecture.forbidden, ["android", "androidx"]);
        assert!(c.gate.required);
    }

    // REQ PC-8
    #[test]
    fn a_missing_file_is_an_error_not_defaults() {
        let err = Config::load(Path::new("/nonexistent/pipeline-check.toml")).unwrap_err();
        assert!(err.contains("cannot read"), "{err}");
    }

    // REQ PC-8
    #[test]
    fn a_typo_in_a_key_is_rejected() {
        let err = parse(&GOOD.replace("aviso_a", "aviso")).err();
        let bad = format!("{GOOD}\naviso = 0.5\n");
        assert!(parse(&bad).is_err(), "unknown key accepted: {err:?}");
    }

    // REQ PC-8
    #[test]
    fn a_nonpositive_limit_or_bad_warning_share_is_rejected() {
        assert!(parse(&GOOD.replace("limit = 400", "limit = 0")).is_err());
        assert!(parse(&format!("aviso_a = 1.5\n{GOOD}")).is_err());
    }
}
