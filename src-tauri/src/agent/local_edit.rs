// Agent tools for local, non-generative editing: layered PSD documents and exact
// edits on session images. They are free and need no image model, so they do not
// count toward the paid image budget and never ask for approval.
use super::*;
use super::photocraft::{self, Step};
use std::path::PathBuf;

pub(super) const MAX_LOCAL_EDITS: usize = 5;
const MAX_DIFF: usize = 50;

fn local_edits(run: &Run) -> Result<usize> {
    Ok(lock(&run.output)?["steps"].as_array().into_iter().flatten()
        .filter(|step| step["operation"] == "psd_edit" || step["operation"] == "exact_edit").count())
}
fn budget_error() -> Value {
    json!({"error":format!("Each task can run up to {MAX_LOCAL_EDITS} local edits."),"recoverable":false})
}

// Layer changes between two summaries, keyed by layer id.
pub(super) fn diff(before: &Value, after: &Value) -> Value {
    fn flatten(layers: &Value, out: &mut Vec<Value>) {
        for layer in layers.as_array().into_iter().flatten() {
            out.push(layer.clone());
            flatten(&layer["layers"], out);
        }
    }
    let (mut old, mut new) = (Vec::new(), Vec::new());
    flatten(&before["layers"], &mut old);
    flatten(&after["layers"], &mut new);
    let find = |list: &[Value], id: &Value| list.iter().find(|l| &l["id"] == id).cloned();
    let mut changes = Vec::new();
    for layer in &new {
        match find(&old, &layer["id"]) {
            None => changes.push(json!({"added":{"id":layer["id"],"name":layer["name"],"kind":layer["kind"]}})),
            Some(previous) => {
                let mut fields = serde_json::Map::new();
                for key in ["name", "visible", "text", "opacity", "blend", "bounds"] {
                    if previous[key] != layer[key] { fields.insert(key.into(), json!({"from":previous[key],"to":layer[key]})); }
                }
                if !fields.is_empty() { changes.push(json!({"id":layer["id"],"name":layer["name"],"changed":fields})); }
            }
        }
    }
    for layer in &old {
        if find(&new, &layer["id"]).is_none() { changes.push(json!({"removed":{"id":layer["id"],"name":layer["name"]}})); }
    }
    for key in ["width", "height", "mode"] {
        if before[key] != after[key] { changes.push(json!({"document":key,"from":before[key],"to":after[key]})); }
    }
    let total = changes.len();
    changes.truncate(MAX_DIFF);
    json!({"changes":changes,"total":total})
}

pub(super) fn manifest(documents: &[Value]) -> Value {
    json!(documents.iter().map(|d| json!({"documentId":d["id"],"name":d["name"],"version":d["version"],"previewImageId":d["previewImageId"],"width":d["width"],"height":d["height"],"layerCount":d["layerCount"]})).collect::<Vec<_>>())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct InspectArgs {
    document_id: String,
}
pub(super) struct InspectPsd(pub Arc<Run>);
impl Tool for InspectPsd {
    const NAME: &'static str = "inspect_psd";
    type Args = InspectArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Show a PSD document's layer tree (ids, names, kinds, visibility, text, bounds) and its version history. Layer ids are valid for edit_psd on this exact documentId.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"document_id":{"type":"string"}},"required":["document_id"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: InspectArgs) -> std::result::Result<Value, std::io::Error> {
        let state = self.0.app.state::<AppState>();
        let store = lock(&state.store).map_err(std::io::Error::other)?;
        let Ok(document) = store.owned_document(&self.0.session_id, &args.document_id) else {
            return Ok(json!({"error":"Document is unavailable in this session. Use a documentId from the attachment manifest or an edit_psd result.","recoverable":true}));
        };
        let versions: Vec<Value> = store.session_documents(&self.0.session_id).map_err(std::io::Error::other)?.into_iter()
            .filter(|d| d["originId"] == document["originId"])
            .map(|d| json!({"documentId":d["id"],"version":d["version"],"parentId":d["parentId"]})).collect();
        Ok(json!({"documentId":document["id"],"name":document["name"],"version":document["version"],"previewImageId":document["previewImageId"],"summary":document["summary"],"warnings":document["warnings"],"versions":versions}))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EditPsdArgs {
    document_id: String,
    description: String,
    steps: Vec<Step>,
}
pub(super) struct EditPsd(pub Arc<Run>, pub PathBuf);
impl Tool for EditPsd {
    const NAME: &'static str = "edit_psd";
    type Args = EditPsdArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Edit a layered PSD document with exact commands (type.edit to change text, layer.* to rename, hide, move or add adjustment layers, image.* to resize or crop, filter.* and more). Layers are kept. Each call saves a NEW version and leaves the previous one untouched; its preview is supplied as visual context on the next turn. Use inspect_psd for layer ids and find_edit_commands for command ids and params.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "document_id":{"type":"string"},
            "description":{"type":"string","description":"Short summary of the edit shown to the user"},
            "steps":{"type":"array","minItems":1,"maxItems":photocraft::MAX_STEPS,"items":{"type":"object","properties":{"id":{"type":"string"},"params":{"type":"object"}},"required":["id"],"additionalProperties":false}}
        },"required":["document_id","description","steps"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: EditPsdArgs) -> std::result::Result<Value, std::io::Error> {
        self.execute(args).await.map_err(std::io::Error::other)
    }
}
impl EditPsd {
    async fn execute(&self, args: EditPsdArgs) -> Result<Value> {
        let run = &self.0;
        if local_edits(run)? >= MAX_LOCAL_EDITS { return Ok(budget_error()); }
        if let Err(error) = photocraft::validate_steps(&args.steps) { return Ok(json!({"error":error,"recoverable":true})); }
        let state = run.app.state::<AppState>();
        let Ok(parent) = lock(&state.store)?.owned_document(&run.session_id, &args.document_id) else {
            return Ok(json!({"error":"Document is unavailable in this session. Use a documentId from the attachment manifest or an edit_psd result.","recoverable":true}));
        };
        let source = crate::documents::document_path(&state, string(&parent, "file"))?;
        let step_id = id();
        run.update(|o| {
            o["steps"].as_array_mut().unwrap().push(json!({
                "id":step_id,"operation":"psd_edit","prompt":args.description,"count":1,"status":"running","needsConfiguration":false,
                "documentId":parent["id"],"commands":args.steps,"imageFiles":[],"error":""
            }));
        })?;
        let started = std::time::Instant::now();
        let file = format!("{}.psd", id());
        let destination = state.directory.join("documents").join(&file);
        let result = async {
            let (results, warnings) = photocraft::edit_document(&self.1, &source, &destination, &args.steps).await?;
            let row = crate::documents::register(&state, &run.session_id, &file, string(&parent, "name"), Some(&parent), None).await?;
            Ok::<_, String>((row, results, warnings))
        }.await;
        crate::diagnostics::record(&run.app, "local_edit.step", json!({"sessionId":run.session_id,"stepId":step_id,"operation":"psd_edit","elapsedMs":started.elapsed().as_millis(),"success":result.is_ok(),"commands":args.steps.iter().map(|s| &s.id).collect::<Vec<_>>()}));
        match result {
            Ok((row, results, warnings)) => {
                let preview = string(&row, "previewImageId").to_owned();
                // The new preview replaces earlier previews of the same document in visual context.
                let replaced: Vec<String> = lock(&state.store)?.session_documents(&run.session_id)?.into_iter()
                    .filter(|d| d["originId"] == row["originId"]).filter_map(|d| d["previewImageId"].as_str().map(str::to_owned)).collect();
                let ids = {
                    let mut viewed = lock(&run.viewed)?;
                    viewed.retain(|file| !replaced.contains(file));
                    if viewed.len() < 6 { viewed.push(preview.clone()); }
                    viewed.clone()
                };
                run.update(|o| {
                    if !o["documentIds"].is_array() { o["documentIds"] = json!([]); }
                    o["documentIds"].as_array_mut().unwrap().push(row["id"].clone());
                    o["viewedImageIds"] = json!(ids);
                    let step = step_mut(o, &step_id);
                    step["status"] = json!("done");
                    step["resultDocumentId"] = row["id"].clone();
                    step["warnings"] = warnings.clone();
                })?;
                Ok(json!({"documentId":row["id"],"version":row["version"],"previewImageId":preview,"results":results,"warnings":warnings,"diff":diff(&parent["summary"], &row["summary"]),
                    "note":"The preview is a flattened render supplied as visual context on the next turn; describe what it shows rather than promising identical output in other apps."}))
            }
            Err(error) => {
                let _ = std::fs::remove_file(&destination);
                run.update(|o| {
                    let step = step_mut(o, &step_id);
                    step["status"] = json!("error");
                    step["error"] = json!("documents.editFailed");
                    step["detail"] = json!(error);
                })?;
                Ok(json!({"error":error,"recoverable":true}))
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ExactArgs {
    source_image_id: String,
    description: String,
    steps: Vec<Step>,
}
pub(super) struct ExactImageEdit(pub Arc<Run>, pub PathBuf);
impl Tool for ExactImageEdit {
    const NAME: &'static str = "exact_image_edit";
    type Args = ExactArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Edit a session image with exact, non-generative operations: resize to exact pixels (image.imageSize), crop, rotate, flip, blur, sharpen, colour adjustments. Free, needs no image model and leaves the original untouched; the result is a new PNG image. Use find_edit_commands for command ids and params.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "source_image_id":{"type":"string","description":"attachment_N handle or exact session imageId"},
            "description":{"type":"string","description":"Short summary of the edit shown to the user"},
            "steps":{"type":"array","minItems":1,"maxItems":photocraft::MAX_STEPS,"items":{"type":"object","properties":{"id":{"type":"string"},"params":{"type":"object"}},"required":["id"],"additionalProperties":false}}
        },"required":["source_image_id","description","steps"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: ExactArgs) -> std::result::Result<Value, std::io::Error> {
        self.execute(args).await.map_err(std::io::Error::other)
    }
}
impl ExactImageEdit {
    async fn execute(&self, args: ExactArgs) -> Result<Value> {
        let run = &self.0;
        if local_edits(run)? >= MAX_LOCAL_EDITS { return Ok(budget_error()); }
        if let Err(error) = photocraft::validate_steps(&args.steps) { return Ok(json!({"error":error,"recoverable":true})); }
        let Ok(source) = assets::resolve_image(run, &args.source_image_id) else { return Ok(assets::invalid_reference()) };
        let state = run.app.state::<AppState>();
        let path = crate::image_path(&state, &source)?;
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_owned();
        let input = std::fs::read(&path).map_err(|e| e.to_string())?;
        let step_id = id();
        run.update(|o| {
            o["steps"].as_array_mut().unwrap().push(json!({
                "id":step_id,"operation":"exact_edit","prompt":args.description,"count":1,"status":"running","needsConfiguration":false,
                "sourceImageId":source,"sourceImageIds":[source],"commands":args.steps,"imageFiles":[],"error":""
            }));
        })?;
        let started = std::time::Instant::now();
        let result = async {
            let (bytes, results) = photocraft::edit_image(&self.1, &input, &extension, &args.steps).await?;
            let name = format!("{}.png", id());
            std::fs::write(state.directory.join("images").join(&name), bytes).map_err(|e| e.to_string())?;
            Ok::<_, String>((name, results))
        }.await;
        crate::diagnostics::record(&run.app, "local_edit.step", json!({"sessionId":run.session_id,"stepId":step_id,"operation":"exact_edit","elapsedMs":started.elapsed().as_millis(),"success":result.is_ok(),"commands":args.steps.iter().map(|s| &s.id).collect::<Vec<_>>()}));
        match result {
            Ok((name, results)) => {
                run.update(|o| {
                    o["imageFiles"].as_array_mut().unwrap().push(json!(name));
                    let step = step_mut(o, &step_id);
                    step["imageFiles"] = json!([name]);
                    step["status"] = json!("done");
                })?;
                Ok(json!({"imageFiles":[name],"sourceImageId":source,"results":results}))
            }
            Err(error) => {
                run.update(|o| {
                    let step = step_mut(o, &step_id);
                    step["status"] = json!("error");
                    step["error"] = json!("documents.editFailed");
                    step["detail"] = json!(error);
                })?;
                Ok(json!({"error":error,"recoverable":true}))
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CommandArgs {
    filter: String,
}
pub(super) struct FindEditCommands(pub PathBuf);
impl Tool for FindEditCommands {
    const NAME: &'static str = "find_edit_commands";
    type Args = CommandArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Search commands usable with edit_psd and exact_image_edit by id or label (for example \"type.edit\", \"rename\", \"size\", \"crop\", \"blur\", \"levels\"). Returns ids with their parameter formats.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"filter":{"type":"string"}},"required":["filter"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: CommandArgs) -> std::result::Result<Value, std::io::Error> {
        Ok(photocraft::commands(&self.0, &args.filter).await.unwrap_or_else(|error| json!({"error":error})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diff_reports_text_visibility_and_structure_changes() {
        let before = json!({"width":10,"height":10,"layers":[
            {"id":1,"name":"Title","kind":"Type","visible":true,"text":"Sale"},
            {"id":2,"name":"Group","kind":"Group","visible":true,"layers":[{"id":3,"name":"Logo","kind":"Pixel","visible":false}]},
            {"id":4,"name":"Old","kind":"Pixel","visible":true}
        ]});
        let after = json!({"width":20,"height":10,"layers":[
            {"id":1,"name":"Title","kind":"Type","visible":true,"text":"特卖"},
            {"id":2,"name":"Group","kind":"Group","visible":true,"layers":[{"id":3,"name":"Logo","kind":"Pixel","visible":true}]},
            {"id":5,"name":"Curves 1","kind":"Adjustment","visible":true}
        ]});
        let result = diff(&before, &after);
        let text = result.to_string();
        assert!(text.contains("特卖") && text.contains("Curves 1") && text.contains("\"removed\""), "{text}");
        assert_eq!(result["changes"].as_array().unwrap().iter().filter(|c| c["changed"]["visible"]["to"] == true).count(), 1);
        assert!(text.contains("\"document\":\"width\""));
        assert_eq!(diff(&before, &before)["total"], 0);
    }
    #[test]
    fn manifest_has_ids_but_no_paths() {
        let text = manifest(&[json!({"id":"d","name":"poster.psd","file":"x.psd","version":2,"previewImageId":"p.png","sourcePath":"/Users/me/poster.psd"})]).to_string();
        assert!(text.contains("\"documentId\":\"d\"") && !text.contains("/Users/me") && !text.contains("x.psd"));
    }
}
