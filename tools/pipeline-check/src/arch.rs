//! Check b: the pure module stays free of the forbidden packages (read from the source, not only the build file).
use crate::config::Architecture;
use crate::fsutil::{has_ext, walk};
use crate::report::{Check, Status};
use std::path::Path;

pub const ID: &str = "arquitetura";

/// The code of one line: `//` comments and `/* ... */` comments (also across lines) removed.
fn code_of(line: &str, in_block: &mut bool) -> String {
    let mut out = String::new();
    let mut rest = line;
    loop {
        if *in_block {
            match rest.find("*/") {
                Some(i) => {
                    *in_block = false;
                    rest = &rest[i + 2..];
                }
                None => return out,
            }
        } else {
            let line_c = rest.find("//");
            let block_c = rest.find("/*");
            match (line_c, block_c) {
                (Some(l), Some(b)) if l < b => return out + &rest[..l],
                (Some(l), None) => return out + &rest[..l],
                (_, Some(b)) => {
                    out.push_str(&rest[..b]);
                    *in_block = true;
                    rest = &rest[b + 2..];
                }
                (None, None) => return out + rest,
            }
        }
    }
}

/// True when the code names a forbidden package: `import [static] pkg...` or a fully qualified use `pkg.x`.
fn violates(code: &str, forbidden: &[String]) -> bool {
    let trimmed = code.trim_start();
    if let Some(rest) = trimmed.strip_prefix("import ") {
        let path = rest.trim().trim_start_matches("static ").trim().trim_end_matches(';');
        if forbidden.iter().any(|f| path == f || path.starts_with(&format!("{f}."))) {
            return true;
        }
    }
    let ident = |c: char| c.is_alphanumeric() || c == '_' || c == '.';
    forbidden.iter().any(|f| {
        let needle = format!("{f}.");
        code.match_indices(&needle).any(|(i, _)| !code[..i].chars().next_back().is_some_and(ident))
    })
}

pub fn check(root: &Path, cfg: &Architecture) -> Check {
    let exts = vec!["kt".to_string(), "java".to_string()];
    let mut violations: Vec<String> = Vec::new();
    for dir in &cfg.pure_dirs {
        for file in walk(&root.join(dir)).into_iter().filter(|p| has_ext(p, &exts)) {
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            let mut in_block = false;
            for (i, line) in text.lines().enumerate() {
                if violates(&code_of(line, &mut in_block), &cfg.forbidden) {
                    let rel = file.strip_prefix(root).unwrap_or(&file).display();
                    violations.push(format!("{rel}:{}: {}", i + 1, line.trim()));
                }
            }
        }
    }
    for build in &cfg.build_files {
        let text = std::fs::read_to_string(root.join(build)).unwrap_or_default();
        for (i, line) in text.lines().enumerate() {
            let code = line.trim_start();
            let lower = code.to_lowercase();
            if !code.starts_with("//") && cfg.forbidden.iter().any(|f| lower.contains(&f.to_lowercase())) {
                violations.push(format!("{build}:{}: {}", i + 1, code));
            }
        }
    }
    let status = if violations.is_empty() { Status::Ok } else { Status::Falha };
    let nota = (!violations.is_empty()).then(|| violations.join("; "));
    Check::new(ID, status, Some(violations.len() as f64), Some(0.0), nota)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forbidden() -> Vec<String> {
        vec!["android".into(), "androidx".into()]
    }

    // REQ PC-3
    #[test]
    fn android_and_androidx_imports_are_violations_but_lookalikes_are_not() {
        let f = forbidden();
        assert!(violates("import android.os.Bundle", &f));
        assert!(violates("  import androidx.compose.runtime.Composable", &f));
        assert!(violates("import android.*;", &f));
        assert!(!violates("import dev.yuji.androidish.Thing", &f));
        assert!(!violates("import kotlin.math.max", &f));
        assert!(!violates(&code_of("// import android.os.Bundle", &mut false), &f));
    }
}
