use crate::{store::{id, now, Result}, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

const TOOLS: &[&str] = &["create_images", "list_images", "view_image", "read_webpage"];
const SECTIONS: &[&str] = &["Purpose", "Inputs", "Outputs", "Steps", "Acceptance", "Limits"];
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Requirements {
    pub min_images: usize,
    pub max_images: usize,
    pub capabilities: Vec<String>,
}
impl Default for Requirements {
    fn default() -> Self {Self {min_images:0,max_images:6,capabilities:vec![]}}
}
fn default_schema() -> u32 {1}
fn validate_sections(text: &str) -> Result<()> {
    let mut found = Vec::new();
    let mut body = false;
    for line in text.lines() {
        if let Some(title) = line.trim().strip_prefix("## ") {
            if !found.is_empty() && !body {return Err("skills.invalidTemplate".into());}
            found.push(title.to_owned()); body = false;
        } else if !line.trim().is_empty() {body = true;}
    }
    if found != SECTIONS || !body {return Err("skills.invalidTemplate".into());}
    Ok(())
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Skill {
    #[serde(default = "default_schema", rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(default)]
    pub requirements: Requirements,
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
        if ![1,2].contains(&self.schema_version) {return Err("Unsupported skill schema".into());}
        if self.schema_version == 2 {validate_sections(&self.instructions)?;}
        let r = &self.requirements;
        if r.min_images > r.max_images || r.max_images > 6 || r.capabilities.len() > 32 || r.capabilities.iter().any(|c| c.trim().is_empty() || c.len() > 100) {return Err("skills.invalidRequirements".into());}
        if self.name.trim().is_empty() || self.name.len() > 160 || self.description.len() > 1000 || self.instructions.trim().is_empty() || self.instructions.len() > 20000 || self.version == 0 {
            return Err("Invalid skill: name or instructions empty/too long, or invalid version".into());
        }
        if self.tools.len() > 32 || self.tools.iter().any(|tool| tool.trim().is_empty() || tool.len() > 100 || (!creator && tool == "draft_skill")) {
            return Err("Invalid tool declaration or reserved Creator tool".into());
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
pub fn preflight(skill: &Skill, images: usize, mask: bool, image_model: bool) -> Result<Vec<String>> {
    skill.validate(skill.id == "builtin-creator")?;
    let r = &skill.requirements;
    let mut warnings = Vec::new();
    if images < r.min_images || images > r.max_images {warnings.push(format!("Reference images: expected {}–{}, supplied {}",r.min_images,r.max_images,images));}
    if skill.allows("create_images") && !image_model {warnings.push("skills.imageModelMissing".into());}
    if r.capabilities.iter().any(|c|c == "mask") && !mask {warnings.push("skills.maskRequired".into());}
    warnings.push("tool_calling".into());
    for tool in &skill.tools { if !TOOLS.contains(&tool.as_str()) && tool != "draft_skill" {warnings.push(format!("Unavailable tool: {tool}"));} }
    if images > 0 || skill.allows("view_image") || r.capabilities.iter().any(|c|c == "vision") {warnings.push("vision".into());}
    if skill.allows("create_images") && images > 0 {warnings.push("image_edit".into());}
    if skill.allows("create_images") && images > 1 {warnings.push("multi_reference".into());}
    if skill.allows("create_images") && mask {warnings.push("mask".into());}
    for c in &r.capabilities {if !warnings.contains(c) {warnings.push(c.clone());}}
    Ok(warnings.into_iter().map(|warning| match warning.as_str() {
        "tool_calling" => "skills.toolCallingUnknown".into(),
        "vision" => "skills.visionUnknown".into(),
        "image_edit" => "skills.imageEditUnknown".into(),
        "multi_reference" => "skills.multiReferenceUnknown".into(),
        "mask" => "skills.maskUnknown".into(),
        _ => warning,
    }).collect())
}
#[tauri::command]
pub fn preflight_skill(state: State<AppState>, session_id: String, images: usize, mask: bool) -> Result<Vec<String>> {
    let session = crate::lock(&state.store)?.get("sessions", &session_id)?;
    let Some(skill) = snapshot(&session["skill"])? else {return Ok(vec![])};
    if session["modelKind"] != "chat" {return Err("ui.selectAChatModelFirst".into());}
    let mut provider = crate::lock(&state.store)?.get("providers", crate::store::string(&session,"providerId"))?;
    crate::lock(&state.catalog)?.provider(&mut provider);
    if !provider["chatModels"].as_array().is_some_and(|models|models.contains(&session["chatModel"])) {return Err("ui.selectAChatModelFirst".into());}
    preflight(&skill, images, mask, crate::agent::image_config(&state,&session).ok().flatten().is_some())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftArgs {
    name: String,
    description: String,
    tools: Vec<String>,
    requirements: Requirements,
    instructions: String,
}
pub struct DraftSkill(pub std::sync::Arc<crate::agent::Run>);
impl rig::tool::Tool for DraftSkill {
    const NAME: &'static str = "draft_skill";
    type Args = DraftArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String { "Propose a local skill draft for user review, testing and explicit save. Does not install or execute it.".into() }
    fn parameters(&self) -> Value {json!({"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"tools":{"type":"array","items":{"type":"string"}},"instructions":{"type":"string","description":"Exactly six nonempty Markdown sections in this order: ## Purpose, ## Inputs, ## Outputs, ## Steps, ## Acceptance, ## Limits. Body text in the user language."},"requirements":{"type":"object","properties":{"minImages":{"type":"integer","minimum":0,"maximum":6},"maxImages":{"type":"integer","minimum":0,"maximum":6},"capabilities":{"type":"array","items":{"type":"string"}}},"required":["minImages","maxImages","capabilities"],"additionalProperties":false}},"required":["name","description","tools","instructions","requirements"],"additionalProperties":false})}
    async fn call(&self, _: &mut rig::tool::ToolContext, args: DraftArgs) -> std::result::Result<Value,Self::Error> {
        let skill = Skill {schema_version:2,requirements:args.requirements,id:format!("draft-{}",now()),version:1,name:args.name,description:args.description,tools:args.tools,instructions:args.instructions};
        if let Err(error) = skill.validate(false) {return Ok(json!({"error":error,"recoverable":true}));}
        self.0.update(|output| output["skillDraft"] = json!(skill)).map_err(std::io::Error::other)?;
        Ok(json!({"status":"Draft ready for user review. Not saved or tested."}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_and_advisory_preflight() {
        let mut skill = builtins().remove(1);
        skill.instructions = "## Purpose\nOnly one section".into();
        assert!(skill.validate(false).is_err());
        skill = builtins().remove(1);
        skill.requirements = Requirements {min_images:2,max_images:3,capabilities:vec!["mask".into(),"animation".into()]};
        skill.tools.push("animate".into());
        let warnings = preflight(&skill,0,false,false).unwrap();
        assert!(warnings.contains(&"skills.imageModelMissing".into()));
        assert!(warnings.contains(&"skills.maskRequired".into()));
        assert!(warnings.iter().any(|s|s.contains("animate")));
        assert!(warnings.iter().any(|s|s.contains("Reference images")));
        skill.requirements.min_images = 4;
        assert!(preflight(&skill,0,false,false).is_err());
        skill.schema_version = 1;
        skill.requirements = Requirements::default();
        skill.instructions = "legacy workflow".into();
        assert!(skill.validate(false).is_ok());
    }
    #[test]
    fn validates_skills_and_protects_creator() {
        for skill in builtins() {assert!(snapshot(&json!(skill)).is_ok());}
        let mut skill = builtins().remove(1);
        skill.tools.push("shell".into());
        assert!(preflight(&skill, 0, false, true).unwrap().iter().any(|warning|warning.contains("shell")));
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
