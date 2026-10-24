//! Check d: a light version of the DORA figures, from git, the release feed and the decision log.
//! They describe; they never fail the run (PC-6). No data means `None`, never a made-up zero.
use crate::config::DoraCfg;
use crate::fsutil::iso_date;
use crate::report::Dora;
use std::path::Path;
use std::process::Command;

#[derive(Debug, PartialEq)]
pub struct Release {
    pub at: u64,
    pub stable: bool,
    pub sha: String,
}

/// "beta 2.6 (versionCode 17, 697b79f)" / "promote 2.5 (versionCode 16, 37c5655)".
pub fn parse_release(at: u64, subject: &str) -> Option<Release> {
    let stable = match subject.split_whitespace().next()? {
        "beta" => false,
        "promote" => true,
        _ => return None,
    };
    let inner = subject.split_once('(')?.1.split_once(')')?.0;
    let sha = inner.rsplit(',').next()?.trim();
    (!sha.is_empty()).then(|| Release { at, stable, sha: sha.to_string() })
}

/// (date, type) of each decision-log row: `| 2026-10-22 | Preventive | ...`.
pub fn decision_rows(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let mut cells = l.split('|').skip(1).map(str::trim);
            let date = cells.next()?;
            let kind = cells.next()?;
            let ok_date = date.len() == 10
                && date.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
            ok_date.then(|| (date.to_string(), kind.to_string()))
        })
        .collect()
}

pub fn share(rows: &[(String, String)], since: &str, kind: &str) -> Option<f64> {
    let recent: Vec<_> = rows
        .iter()
        .filter(|(d, k)| d.as_str() >= since && ["Corrective", "Adaptive", "Perfective", "Preventive"].contains(&k.as_str()))
        .collect();
    (!recent.is_empty()).then(|| 100.0 * recent.iter().filter(|(_, k)| k == kind).count() as f64 / recent.len() as f64)
}

pub fn median(mut v: Vec<f64>) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    Some(if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 })
}

fn git(repo: &Path, args: &[&str]) -> String {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

fn releases(feed: &Path, since: u64) -> Vec<Release> {
    git(feed, &["log", "--all", "--format=%at\t%s"])
        .lines()
        .filter_map(|l| {
            let (at, subject) = l.split_once('\t')?;
            parse_release(at.parse().ok()?, subject)
        })
        .filter(|r| r.at >= since)
        .collect()
}

pub fn compute(root: &Path, cfg: &DoraCfg, now: u64, ci_rate: Option<f64>) -> Dora {
    let since = now.saturating_sub(cfg.days * 86_400);
    let mut dora = Dora { ci_taxa_sucesso: ci_rate, ..Dora::default() };

    let log = std::fs::read_to_string(root.join(&cfg.decision_log)).unwrap_or_default();
    let rows = decision_rows(&log);
    let since_date = iso_date(since);
    dora.retrabalho = share(&rows, &since_date, "Corrective");
    dora.parcela_preventiva = share(&rows, &since_date, "Preventive");

    if let Some(feed) = cfg.feed_path.as_deref().map(shellexpand_home).filter(|p| p.is_dir()) {
        let rel = releases(&feed, since);
        dora.frequencia = Some(rel.len() as f64 / (cfg.days as f64 / 7.0).max(1.0));
        let lead: Vec<f64> = rel
            .iter()
            .filter(|r| r.stable)
            .filter_map(|r| git(root, &["show", "-s", "--format=%at", &r.sha]).trim().parse::<u64>().ok().map(|c| (r.at.saturating_sub(c)) as f64 / 3600.0))
            .collect();
        dora.lead_time = median(lead);
    }
    dora
}

fn shellexpand_home(p: &str) -> std::path::PathBuf {
    match (p.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => Path::new(&home).join(rest),
        _ => p.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // REQ PC-6
    #[test]
    fn release_subjects_are_parsed_and_others_ignored() {
        let r = parse_release(10, "beta 2.6 (versionCode 17, 697b79f)").unwrap();
        assert_eq!((r.stable, r.sha.as_str()), (false, "697b79f"));
        assert!(parse_release(10, "promote 2.5 (versionCode 16, 37c5655)").unwrap().stable);
        assert_eq!(parse_release(10, "content beta 3"), None);
        assert_eq!(parse_release(10, "beta without parens"), None);
    }

    const LOG: &str = "| Date | Type |\n|---|---|\n| 2026-10-22 | Preventive | a |\n| 2026-10-20 | Corrective | b |\n| 2026-10-19 | Perfective | c |\n| 2026-09-01 | Corrective | old |\n";

    // REQ PC-6
    #[test]
    fn shares_count_only_rows_inside_the_window() {
        let rows = decision_rows(LOG);
        assert_eq!(rows.len(), 4);
        let s = "2026-10-01";
        assert!((share(&rows, s, "Corrective").unwrap() - 100.0 / 3.0).abs() < 1e-9);
        assert!((share(&rows, s, "Preventive").unwrap() - 100.0 / 3.0).abs() < 1e-9);
    }

    // REQ PC-6
    #[test]
    fn no_data_gives_none_not_zero() {
        assert_eq!(share(&decision_rows(LOG), "2027-01-01", "Corrective"), None);
        assert_eq!(median(vec![]), None);
    }

    // REQ PC-6
    #[test]
    fn median_of_even_and_odd_lists() {
        assert_eq!(median(vec![3.0, 1.0, 2.0]), Some(2.0));
        assert_eq!(median(vec![4.0, 1.0, 2.0, 3.0]), Some(2.5));
    }
}
