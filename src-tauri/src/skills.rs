use crate::{store::{id, now, Result}, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

const TOOLS: &[&str] = &["create_images", "list_images", "view_image", "read_webpage"];
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Skill {
    pub id: String,
    pub version: u32,
    pub name: String,
    pub description: String,
    pub tools: Vec<String>,
    pub instructions: String,
}
impl Skill {
    pub fn allows(&self, tool: &str) -> bool { self.tools.iter().any(|item|item == tool) }
    pub fn validate(&self, creator: bool) -> Result<()> {
        if self.name.trim().is_empty() || self.name.len() > 160 || self.description.len() > 1000 || self.instructions.trim().is_empty() || self.instructions.len() > 20000 || self.version == 0 {
            return Err("Invalid skill: name or instructions empty/too long, or invalid version".into());
        }
        if self.tools.len() > 4 || self.tools.iter().any(|tool| !TOOLS.contains(&tool.as_str()) && !(creator && tool == "draft_skill")) {
            return Err("Skill requires unsupported tools".into());
        }
        Ok(())
    }
}
pub fn builtins() -> Vec<Skill> {
    [include_str!("../skills/creator.json"), include_str!("../skills/character-sheet.json")].iter().map(|text|serde_json::from_str(text).expect("Valid bundled skill")).collect()
}
pub fn snapshot(value: &Value) -> Result<Option<Skill>> {
    if value.is_null() { return Ok(None); }
    let skill: Skill = serde_json::from_value(value.clone()).map_err(|e|e.to_string())?;
    if skill.id == "builtin-creator" {
        let builtin = builtins().remove(0);
        if serde_json::to_value(&skill).unwrap() != serde_json::to_value(&builtin).unwrap() {return Err("Creator cannot be overridden; copy it as a local workflow".into());}
    }
    skill.validate(skill.id == "builtin-creator")?;
    Ok(Some(skill))
}
#[tauri::command]
pub fn list_skills(state: State<AppState>) -> Result<Vec<Skill>> {
    let mut result = builtins();
    let directory = state.directory.join("skills");
    if !directory.exists() {return Ok(result);}
    for entry in std::fs::read_dir(directory).map_err(|e|e.to_string())? {
        let path = entry.map_err(|e|e.to_string())?.path();
        if path.extension().and_then(|s|s.to_str()) != Some("json") {continue;}
        let skill: Skill = serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|format!("Invalid local skill: {e}"))?;
        skill.validate(false)?;
        if skill.id.starts_with("builtin-") { return Err("Local skills cannot replace built-in IDs".into()); }
        result.push(skill);
    }
    result[2..].sort_by(|a,b|a.name.cmp(&b.name));
    Ok(result)
}
#[tauri::command]
pub fn save_skill(state: State<AppState>, mut skill: Skill) -> Result<Skill> {
    skill.validate(false)?;
    // Saved editions are immutable: changes create a new ID and preserve running sessions.
    skill.id = id();
    skill.version = 1;
    let directory = state.directory.join("skills");
    std::fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
    let path = directory.join(format!("{}.json",skill.id));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec_pretty(&skill).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    Ok(skill)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftArgs {
    name: String,
    description: String,
    tools: Vec<String>,
    instructions: String,
}
pub struct DraftSkill(pub std::sync::Arc<crate::agent::Run>);
impl rig::tool::Tool for DraftSkill {
    const NAME: &'static str = "draft_skill";
    type Args = DraftArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String { "Propose a local skill draft for user review, testing and explicit save. Does not install or execute it.".into() }
    fn parameters(&self) -> Value {json!({"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"tools":{"type":"array","items":{"type":"string","enum":TOOLS}},"instructions":{"type":"string"}},"required":["name","description","tools","instructions"],"additionalProperties":false})}
    async fn call(&self, _: &mut rig::tool::ToolContext, args: DraftArgs) -> std::result::Result<Value,Self::Error> {
        let skill = Skill {id:format!("draft-{}",now()),version:1,name:args.name,description:args.description,tools:args.tools,instructions:args.instructions};
        if let Err(error) = skill.validate(false) {return Ok(json!({"error":error,"recoverable":true}));}
        self.0.update(|output| output["skillDraft"] = json!(skill)).map_err(std::io::Error::other)?;
        Ok(json!({"status":"Draft ready for user review. Not saved or tested."}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_skills_and_protects_creator() {
        for skill in builtins() {assert!(snapshot(&json!(skill)).is_ok());}
        let mut skill = builtins().remove(1);
        skill.tools.push("shell".into());
        assert!(snapshot(&json!(skill)).is_err());
        let mut creator = builtins().remove(0);
        creator.instructions = "override".into();
        assert!(snapshot(&json!(creator)).is_err());
        assert!(snapshot(&Value::Null).unwrap().is_none());
        let creator = builtins().remove(0);
        assert!(creator.allows("draft_skill"));
        assert!(!creator.allows("create_images"));
        assert!(!creator.allows("read_webpage"));
        let original = builtins().remove(1);
        let value = json!(original);
        let running = snapshot(&value).unwrap().unwrap();
        let mut edited = running.clone();
        edited.instructions = "changed after run started".into();
        assert_ne!(running.instructions, edited.instructions);
        assert!(running.allows("create_images"));
        assert!(!running.allows("draft_skill"));
    }
}
