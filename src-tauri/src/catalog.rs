use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

pub const URL: &str =
    "https://raw.githubusercontent.com/xrdavies/hamster-studio/main/config/model-capabilities.json";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub version: u64,
    pub models: BTreeMap<String, String>,
    pub prefixes: Vec<Rule>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Rule {
    pub prefix: String,
    pub kind: String,
}
fn valid_kind(kind: &str) -> bool {
    kind == "chat" || kind == "image"
}
impl Catalog {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 1024 * 1024 {
            return Err("Model catalog exceeds 1 MB".into());
        }
        let table: Self = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if table.schema_version != 1
            || table.version == 0
            || table.version > 9_007_199_254_740_991
            || table.models.len() > 10000
            || table.prefixes.len() > 1000
            || table.models.iter().any(|(id, kind)| {
                id.trim().is_empty() || id.chars().count() > 200 || !valid_kind(kind)
            })
            || table.prefixes.iter().any(|r| {
                r.prefix.trim().is_empty() || r.prefix.chars().count() > 200 || !valid_kind(&r.kind)
            })
        {
            return Err("Invalid model catalog".into());
        }
        Ok(table)
    }
    pub fn bundled() -> Self {
        Self::parse(include_bytes!("../../config/model-capabilities.json"))
            .expect("valid bundled catalog")
    }
    pub fn load(path: &Path) -> Self {
        let bundled = Self::bundled();
        std::fs::read(path)
            .ok()
            .and_then(|b| Self::parse(&b).ok())
            .filter(|t| t.version > bundled.version)
            .unwrap_or(bundled)
    }
    pub fn kind<'a>(&'a self, id: &str, hint: Option<&'a str>) -> &'a str {
        if let Some(kind) = self.models.get(id.trim()) {
            return kind;
        }
        self.prefixes
            .iter()
            .filter(|r| id.trim().starts_with(&r.prefix))
            .max_by_key(|r| r.prefix.len())
            .map(|r| r.kind.as_str())
            .unwrap_or_else(|| hint.filter(|k| valid_kind(k)).unwrap_or("chat"))
    }
    pub fn classify(&self, rows: &[Value]) -> Value {
        let mut result = json!({"chatModels": [], "imageModels": [], "unknownModels": []});
        for row in rows {
            let Some(id) = row
                .as_str()
                .or_else(|| row["id"].as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let hint = if row["capabilities"]["image_generation"] == true {
                Some("image")
            } else {
                row["type"].as_str()
            };
            let key = match self.kind(id, hint) {
                "chat" => "chatModels",
                "image" => "imageModels",
                _ => "unknownModels",
            };
            let list = result[key].as_array_mut().unwrap();
            if !list.contains(&json!(id)) {
                list.push(json!(id))
            }
        }
        result
    }
    pub fn provider(&self, provider: &mut Value) {
        let mut rows = Vec::new();
        for (key, kind) in [
            ("imageModels", "image"),
            ("chatModels", "chat"),
            ("unknownModels", "unknown"),
        ] {
            if let Some(ids) = provider[key].as_array() {
                for id in ids {
                    if !rows.iter().any(|r: &Value| r["id"] == *id) {
                        rows.push(json!({"id": id, "type": kind}))
                    }
                }
            }
        }
        let classified = self.classify(&rows);
        for key in ["chatModels", "imageModels", "unknownModels"] {
            provider[key] = classified[key].clone()
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classification_and_validation() {
        let t = Catalog::bundled();
        assert_eq!(t.kind("gpt-image-2", Some("chat")), "image");
        assert_eq!(t.kind("image-reader", None), "chat");
        assert_eq!(
            t.classify(&[
                json!(null),
                json!({"id":"alias", "type":"image"}),
                json!("alias")
            ])["imageModels"],
            json!(["alias"])
        );
        assert_eq!(t.kind("gpt-image-future", Some("chat")), "image");
        let mut p = json!({"chatModels":["gpt-image-future"],"unknownModels":["custom-chat"],"imageModels":[]});
        t.provider(&mut p);
        assert_eq!(p["chatModels"], json!(["custom-chat"]));
        assert_eq!(p["imageModels"], json!(["gpt-image-future"]));
        assert_eq!(p["unknownModels"], json!([]));
        assert!(Catalog::parse(br#"{"schemaVersion":2}"#).is_err());
    }
}
