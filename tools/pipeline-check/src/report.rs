//! The report written to `report.json`: the only contact point between this program and the review skill.
use serde::Serialize;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Aviso,
    Falha,
    Pulado,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Local,
    Ci,
}

#[derive(Serialize, Debug, Clone)]
pub struct Check {
    pub id: String,
    pub status: Status,
    pub valor: Option<f64>,
    pub limite: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nota: Option<String>,
}

impl Check {
    pub fn new(id: &str, status: Status, valor: Option<f64>, limite: Option<f64>, nota: Option<String>) -> Check {
        Check { id: id.to_string(), status, valor, limite, nota }
    }
    pub fn skipped(id: &str, required: bool, why: &str) -> Check {
        let status = if required { Status::Falha } else { Status::Pulado };
        let nota = if required { format!("obrigatório mas não rodou: {why}") } else { why.to_string() };
        Check::new(id, status, None, None, Some(nota))
    }
}

#[derive(Serialize, Debug, Default, Clone)]
pub struct Dora {
    /// beta + stable releases per week
    pub frequencia: Option<f64>,
    /// median hours from source commit to stable release
    pub lead_time: Option<f64>,
    /// percent of decision-log rows of type Corrective
    pub retrabalho: Option<f64>,
    /// percent of decision-log rows of type Preventive
    pub parcela_preventiva: Option<f64>,
    /// percent of recent CI runs that succeeded (local mode, needs gh)
    pub ci_taxa_sucesso: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct Report {
    pub schema_version: u32,
    pub projeto: String,
    pub data: String,
    pub modo: Mode,
    pub checks: Vec<Check>,
    pub dora: Dora,
}

impl Report {
    /// 1 if any check failed, else 0. A warning never fails.
    pub fn exit_code(&self) -> i32 {
        i32::from(self.checks.iter().any(|c| c.status == Status::Falha))
    }
}

/// Level of a measured value against its limit: warn from `aviso_a` of the limit, fail at 100 %.
pub fn classify(valor: f64, limite: f64, aviso_a: f64) -> Status {
    let share = valor / limite;
    if share >= 1.0 {
        Status::Falha
    } else if share >= aviso_a {
        Status::Aviso
    } else {
        Status::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // REQ PC-2
    #[test]
    fn share_bands_are_ok_below_80_aviso_up_to_limit_falha_from_limit() {
        assert_eq!(classify(79.0, 100.0, 0.8), Status::Ok);
        assert_eq!(classify(80.0, 100.0, 0.8), Status::Aviso);
        assert_eq!(classify(85.0, 100.0, 0.8), Status::Aviso);
        assert_eq!(classify(99.0, 100.0, 0.8), Status::Aviso);
        assert_eq!(classify(100.0, 100.0, 0.8), Status::Falha);
        assert_eq!(classify(250.0, 100.0, 0.8), Status::Falha);
    }

    // REQ PC-2
    #[test]
    fn warning_share_is_configurable() {
        assert_eq!(classify(60.0, 100.0, 0.5), Status::Aviso);
        assert_eq!(classify(60.0, 100.0, 0.9), Status::Ok);
    }

    fn report(statuses: &[Status]) -> Report {
        Report {
            schema_version: SCHEMA_VERSION,
            projeto: "p".into(),
            data: "2026-01-01".into(),
            modo: Mode::Local,
            checks: statuses.iter().map(|s| Check::new("x", *s, None, None, None)).collect(),
            dora: Dora::default(),
        }
    }

    // REQ PC-1
    #[test]
    fn exit_code_is_nonzero_only_when_some_check_failed() {
        assert_eq!(report(&[Status::Ok, Status::Aviso, Status::Pulado]).exit_code(), 0);
        assert_eq!(report(&[Status::Ok, Status::Falha, Status::Aviso]).exit_code(), 1);
        assert_eq!(report(&[]).exit_code(), 0);
    }

    // REQ PC-1
    #[test]
    fn json_has_the_agreed_fields_and_lowercase_values() {
        let v = serde_json::to_value(report(&[Status::Aviso])).unwrap();
        for key in ["schema_version", "projeto", "data", "modo", "checks", "dora"] {
            assert!(v.get(key).is_some(), "missing field {key}");
        }
        assert_eq!(v["modo"], "local");
        assert_eq!(v["checks"][0]["status"], "aviso");
        for key in ["frequencia", "lead_time", "retrabalho", "parcela_preventiva"] {
            assert!(v["dora"].get(key).is_some(), "missing dora field {key}");
        }
    }

    // REQ PC-4
    #[test]
    fn skipped_check_is_pulado_unless_required_then_falha() {
        assert_eq!(Check::skipped("c", false, "no gh").status, Status::Pulado);
        assert_eq!(Check::skipped("c", true, "no gh").status, Status::Falha);
    }
}
