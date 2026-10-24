use std::path::{Path, PathBuf};

/// All regular files under `dir`, sorted; a missing directory yields nothing; symbolic links are skipped.
pub fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        // file_type() does not follow links, so a link that points back up cannot loop forever (PC-10).
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() {
            out.extend(walk(&e.path()));
        } else if kind.is_file() {
            out.push(e.path());
        }
    }
    out.sort();
    out
}

pub fn has_ext(p: &Path, exts: &[String]) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| exts.iter().any(|x| x == e))
}

/// Days since 1970-01-01 -> (year, month, day), proleptic Gregorian (Howard Hinnant's algorithm).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn iso_date(unix: u64) -> String {
    let (y, m, d) = civil_from_days((unix / 86_400) as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // REQ PC-1
    #[test]
    fn dates_are_formatted_correctly() {
        assert_eq!(iso_date(0), "1970-01-01");
        assert_eq!(iso_date(951_782_400), "2000-02-29");
        assert_eq!(iso_date(1_792_800_000), "2026-10-24");
    }
}
