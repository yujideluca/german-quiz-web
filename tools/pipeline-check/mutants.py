#!/usr/bin/env python3
"""Hand-made mutation check for pipeline-check: plants one fault at a time and demands that cargo test fails.
usage: python3 -I tools/pipeline-check/mutants.py   (a SURVIVED line is a gap in the tests; COMPILE-ERR is an invalid mutant)"""
import subprocess, shutil, os, sys
root = os.path.dirname(os.path.abspath(__file__))
muts = [
 ("src/report.rs", "if share >= 1.0 {", "if share > 1.0 {"),
 ("src/report.rs", "} else if share >= aviso_a {", "} else if share > aviso_a {"),
 ("src/report.rs", "i32::from(self.checks.iter().any(|c| c.status == Status::Falha))", "i32::from(self.checks.iter().any(|c| c.status != Status::Ok))"),
 ("src/report.rs", "let status = if required { Status::Falha } else { Status::Pulado };", "let status = Status::Pulado;"),
 ("src/arch.rs", "let status = if violations.is_empty() { Status::Ok } else { Status::Falha };", "let status = Status::Ok;"),
 ("src/arch.rs", "if !code.starts_with(\"//\") && cfg.forbidden", "if cfg.forbidden"),
 ("src/arch.rs", "!code[..i].chars().next_back().is_some_and(ident)", "true"),
 ("src/gate.rs", "Ok(s) if s.success() =>", "Ok(_s) if true =>"),
 ("src/config.rs", "#[serde(deny_unknown_fields)]\npub struct Config", "pub struct Config"),
 ("src/config.rs", "if !(0.0 < self.aviso_a && self.aviso_a < 1.0)", "if false"),
 ("src/dora.rs", "d.as_str() >= since", "d.as_str() <= since"),
 ("src/dora.rs", "if n % 2 == 1 { v[n / 2] }", "if n % 2 == 0 { v[n / 2] }"),
 ("src/github.rs", "Err(e) if e.contains(\"404\")", "Err(e) if e.contains(\"405\")"),
 ("src/github.rs", "Some(r) if r[\"conclusion\"] == \"success\" =>", "Some(_r) if true =>"),
 ("src/fitness.rs", ".filter(|f| !(measure_only && f.kind == Kind::GateSeconds))", ""),
 ("src/lib.rs", "let github = if opts.measure_only { &None } else { &cfg.github };", "let github = &cfg.github;"),
 ("src/lib.rs", "dora: if opts.measure_only { report::Dora::default() } else {", "dora: if false { report::Dora::default() } else {"),
 ("src/fsutil.rs", "} else if kind.is_file() {", "} else if !kind.is_dir() {"),
 ("src/fsutil.rs", "let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;", "let m = if mp < 10 { mp + 2 } else { mp - 9 } as u32;"),
 ("src/main.rs", "ExitCode::from(report.exit_code() as u8)", "ExitCode::from(0)"),
 ("src/main.rs", "return ExitCode::from(2);\n        }\n    };\n    if let Some(cmd)", "return ExitCode::from(1);\n        }\n    };\n    if let Some(cmd)"),
]
res = []
for f, a, b in muts:
    p = os.path.join(root, f)
    orig = open(p).read()
    if a not in orig:
        res.append(("NOT FOUND", f, a[:50])); continue
    open(p, "w").write(orig.replace(a, b, 1))
    r = subprocess.run(["cargo", "test", "--quiet"], cwd=root, capture_output=True, text=True)
    open(p, "w").write(orig)
    built = "error[" in r.stderr or "error:" in r.stderr and "could not compile" in r.stderr
    res.append(("COMPILE-ERR" if built else ("killed" if r.returncode else "SURVIVED"), f, a[:60]))
for r in res: print(*r, sep=" | ")
