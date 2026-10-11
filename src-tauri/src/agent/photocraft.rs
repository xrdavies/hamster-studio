// Local, non-generative editing through a bundled `photocraft-cli` (an internal
// detail: user-facing text says "PSD editing", never the engine name). Each call
// starts a headless MCP server whose read/write roots are a private temporary
// directory, so the editor never sees the image or document library.
use crate::store::{id, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub(crate) const CLI_ENV: &str = "HAMSTER_PHOTOCRAFT_CLI";
pub(crate) const MAX_STEPS: usize = 16;
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024 * 1024;
const PREVIEW_SIDE: u32 = 1024;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const ALLOWED_PREFIXES: &[&str] = &[
    "image.", "filter.", "select.", "layer.", "type.", "path.", "shape.",
    "edit.fill", "edit.clear", "edit.stroke", "edit.transform", "edit.findAndReplaceText",
    "edit.contentAwareFill", "edit.contentAwareScale", "edit.deleteAndFillSelection", "edit.puppetWarp", "edit.perspectiveWarp",
];
// Commands that read or write files, or change the editor's own presets.
const DENIED: &[&str] = &["export", "Export", "relink", "Relink", "replaceContents", "saveContents", "convertToLinked", "FromFile", "Footage", "DefaultTypeStyles", ".presets."];
const MAX_LAYERS: usize = 200;
const MAX_DEPTH: usize = 8;

// Developer override first, then the sidecar bundled next to the app executable,
// then (debug builds only) the binary produced by scripts/build-photocraft.mjs.
pub(crate) fn cli() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(CLI_ENV) {
        return Some(PathBuf::from(path)).filter(|path| path.is_file());
    }
    let bundled = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("photocraft-cli")));
    if let Some(path) = bundled.filter(|path| path.is_file()) {
        return Some(path);
    }
    #[cfg(debug_assertions)]
    {
        let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("photocraft-cli-{}-apple-darwin", std::env::consts::ARCH));
        if built.is_file() {
            return Some(built);
        }
    }
    None
}

pub(crate) fn allowed(command: &str) -> bool {
    ALLOWED_PREFIXES.iter().any(|prefix| command.starts_with(prefix)) && !DENIED.iter().any(|word| command.contains(word))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Step {
    pub id: String,
    #[serde(default)]
    pub params: Option<Value>,
}
pub(crate) fn validate_steps(steps: &[Step]) -> Result<()> {
    if steps.is_empty() || steps.len() > MAX_STEPS {
        return Err(format!("Provide 1 to {MAX_STEPS} editing steps."));
    }
    for step in steps {
        if !allowed(&step.id) {
            return Err(format!("Command {} is not available. Use find_edit_commands to look up supported commands.", step.id));
        }
        if step.params.as_ref().is_some_and(|params| !params.is_object()) {
            return Err(format!("Params for {} must be a JSON object.", step.id));
        }
    }
    Ok(())
}

// The engine name never reaches users through error text.
fn neutral(text: &str) -> String {
    text.replace("PhotoCraft", "editor").replace("photocraft", "editor")
}

struct WorkDir(PathBuf);
impl WorkDir {
    fn new() -> Result<Self> {
        let path = std::env::temp_dir().join(format!("hamster-edit-{}", id()));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self(path.canonicalize().map_err(|e| e.to_string())?))
    }
}
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// Minimal MCP stdio client: newline-delimited JSON-RPC, one request at a time.
struct Mcp {
    _child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    next: u64,
}
impl Mcp {
    async fn start(cli: &Path, root: &Path) -> Result<Self> {
        let mut child = tokio::process::Command::new(cli)
            .arg("mcp")
            .arg("--automation-read-root").arg(root)
            .arg("--automation-write-root").arg(root)
            .current_dir(root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Could not start the editor: {e}"))?;
        let stdin = child.stdin.take().ok_or("Editor stdin unavailable")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("Editor stdout unavailable")?).lines();
        let mut mcp = Self { _child: child, stdin, stdout, next: 0 };
        mcp.request("initialize", json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hamster-studio","version":env!("CARGO_PKG_VERSION")}})).await?;
        mcp.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await?;
        Ok(mcp)
    }
    async fn send(&mut self, message: &Value) -> Result<()> {
        let mut line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.stdin.write_all(&line).await.map_err(|e| format!("Editor connection failed: {e}"))?;
        self.stdin.flush().await.map_err(|e| format!("Editor connection failed: {e}"))
    }
    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next += 1;
        let request_id = self.next;
        self.send(&json!({"jsonrpc":"2.0","id":request_id,"method":method,"params":params})).await?;
        tokio::time::timeout(REQUEST_TIMEOUT, async {
            loop {
                let line = self.stdout.next_line().await.map_err(|e| e.to_string())?.ok_or("The editor exited unexpectedly")?;
                // Skip notifications and anything that is not our response.
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if message["id"] != json!(request_id) { continue; }
                if let Some(error) = message.get("error") {
                    return Err(format!("Editor {method} failed: {}", neutral(error["message"].as_str().unwrap_or("unknown error"))));
                }
                return Ok(message["result"].clone());
            }
        }).await.map_err(|_| format!("Editor {method} timed out"))?
    }
    async fn call_raw(&mut self, tool: &str, arguments: Value) -> Result<Value> {
        let result = self.request("tools/call", json!({"name":tool,"arguments":arguments})).await?;
        if result["isError"] == true {
            return Err(format!("Editor {tool} failed: {}", neutral(&text(&result))));
        }
        Ok(result)
    }
    async fn call(&mut self, tool: &str, arguments: Value) -> Result<Value> {
        let result = self.call_raw(tool, arguments).await?;
        let text = text(&result);
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }
    async fn batch(&mut self, steps: &[Step]) -> Result<Value> {
        let steps: Vec<Value> = steps.iter().map(|step| json!({"id":step.id,"params":step.params.clone().unwrap_or_else(|| json!({}))})).collect();
        let report = self.call("command_batch", json!({"steps":steps,"stop_on_error":true})).await?;
        if report["failed"].as_u64() != Some(0) {
            let errors: Vec<_> = report["results"].as_array().into_iter().flatten().filter_map(|result| result["error"].as_str()).collect();
            return Err(neutral(&format!("Editing step failed: {}", if errors.is_empty() { report.to_string() } else { errors.join("; ") })));
        }
        Ok(report)
    }
    async fn preview(&mut self) -> Result<Vec<u8>> {
        let result = self.call_raw("render_preview", json!({"max_side":PREVIEW_SIDE})).await?;
        let data = result["content"].as_array().into_iter().flatten()
            .find(|item| item["type"] == "image" && item["mimeType"] == "image/png")
            .and_then(|item| item["data"].as_str()).ok_or("The editor returned no preview")?;
        base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())
    }
}
fn text(result: &Value) -> String {
    result["content"].as_array().into_iter().flatten().filter_map(|item| item["text"].as_str()).collect::<Vec<_>>().join("\n")
}
fn check_output(path: &Path) -> Result<()> {
    let size = std::fs::metadata(path).map_err(|_| "The editor did not write an output file")?.len();
    if size == 0 || size > MAX_OUTPUT_BYTES {
        return Err("Editor output is empty or too large".into());
    }
    Ok(())
}
fn read_output(path: &Path) -> Result<Vec<u8>> {
    check_output(path)?;
    std::fs::read(path).map_err(|e| e.to_string())
}
// Copies the result out of the work directory; a partial destination is removed on failure.
fn deliver(output: &Path, destination: &Path) -> Result<()> {
    check_output(output)?;
    if let Err(error) = std::fs::copy(output, destination) {
        let _ = std::fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(())
}
fn stage(work: &WorkDir, source: &Path) -> Result<()> {
    std::fs::copy(source, work.0.join("input.psd")).map(|_| ()).map_err(|e| e.to_string())
}

// Compact layer tree for the model: ids, names, kinds, visibility and text, bounded in size.
pub(crate) fn summarize(inspect: &Value) -> Value {
    fn layers(items: &Value, depth: usize, budget: &mut usize) -> Vec<Value> {
        let mut result = Vec::new();
        for layer in items.as_array().into_iter().flatten() {
            if *budget == 0 { break; }
            *budget -= 1;
            let mut item = json!({"id":layer["id"],"name":layer["name"],"kind":layer["kind"],"visible":layer["visible"],"bounds":layer["bounds"]});
            if layer["opacity"].as_f64().is_some_and(|o| o < 1.0) { item["opacity"] = layer["opacity"].clone(); }
            if layer["blend"].as_str().is_some_and(|b| b != "Normal") { item["blend"] = layer["blend"].clone(); }
            if let Some(text) = layer["text"]["text"].as_str() {
                item["text"] = json!(text.chars().take(300).collect::<String>());
                item["font"] = layer["text"]["font"].clone();
                item["sizePt"] = layer["text"]["sizePt"].clone();
            }
            let children = layer.get("layers").or_else(|| layer.get("children"));
            if let Some(children) = children.filter(|c| c.as_array().is_some_and(|c| !c.is_empty())) {
                item["layers"] = if depth + 1 < MAX_DEPTH { json!(layers(children, depth + 1, budget)) } else { json!("(nested too deep)") };
            }
            result.push(item);
        }
        result
    }
    let mut budget = MAX_LAYERS;
    let tree = layers(&inspect["layers"], 0, &mut budget);
    json!({"width":inspect["width"],"height":inspect["height"],"mode":inspect["mode"],"depth":inspect["depth"],"layers":tree,"truncated":budget == 0})
}

pub(crate) struct Inspection {
    pub summary: Value,
    pub preview: Vec<u8>,
    pub warnings: Value,
}
// Opens a document in a fresh process so layer ids match what the next edit will see.
pub(crate) async fn inspect(cli: &Path, source: &Path) -> Result<Inspection> {
    let work = WorkDir::new()?;
    stage(&work, source)?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    let opened = mcp.call("doc_open", json!({"path":"input.psd"})).await?;
    let summary = summarize(&mcp.call("doc_inspect", json!({})).await?);
    let preview = mcp.preview().await?;
    Ok(Inspection { summary, preview, warnings: opened["warnings"].clone() })
}

// Runs the steps and writes a new layered PSD to `destination`. Returns step results and warnings.
// Open warnings are included: anything the editor could not read on open is dropped on save.
pub(crate) async fn edit_document(cli: &Path, source: &Path, destination: &Path, steps: &[Step]) -> Result<(Value, Value)> {
    validate_steps(steps)?;
    let work = WorkDir::new()?;
    stage(&work, source)?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    let opened = mcp.call("doc_open", json!({"path":"input.psd"})).await?;
    let report = mcp.batch(steps).await?;
    let saved = mcp.call("doc_save", json!({"path":"output.psd","format":"psd"})).await?;
    drop(mcp);
    let warnings: Vec<Value> = [&opened["warnings"], &saved["warnings"]].into_iter()
        .flat_map(|w| w.as_array().cloned().unwrap_or_default())
        .map(|w| json!(neutral(w.as_str().unwrap_or_default()))).collect();
    deliver(&work.0.join("output.psd"), destination)?;
    Ok((report["results"].clone(), json!(warnings)))
}

// Flattens a document to a full-resolution PNG.
pub(crate) async fn export_png(cli: &Path, source: &Path, destination: &Path) -> Result<()> {
    let work = WorkDir::new()?;
    stage(&work, source)?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    mcp.call("doc_open", json!({"path":"input.psd"})).await?;
    mcp.call("doc_save", json!({"path":"output.png","format":"png"})).await?;
    drop(mcp);
    deliver(&work.0.join("output.png"), destination)
}

// Exact edits on a flat image; the result is always a PNG.
pub(crate) async fn edit_image(cli: &Path, input: &[u8], extension: &str, steps: &[Step]) -> Result<(Vec<u8>, Value)> {
    validate_steps(steps)?;
    let work = WorkDir::new()?;
    let source = format!("input.{extension}");
    std::fs::write(work.0.join(&source), input).map_err(|e| e.to_string())?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    mcp.call("doc_open", json!({"path":source})).await?;
    let report = mcp.batch(steps).await?;
    mcp.call("doc_save", json!({"path":"output.png","format":"png"})).await?;
    drop(mcp);
    let bytes = read_output(&work.0.join("output.png"))?;
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(|_| "Editor output is not a valid PNG")?;
    Ok((bytes, report["results"].clone()))
}

pub(crate) async fn commands(cli: &Path, filter: &str) -> Result<Value> {
    let work = WorkDir::new()?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    let all = mcp.call("command_list", json!({"filter":filter})).await?;
    let matches: Vec<Value> = all.as_array().into_iter().flatten()
        .filter(|command| command["id"].as_str().is_some_and(allowed))
        .map(|command| json!({"id":command["id"],"label":command["label"],"params":neutral(command["params"].as_str().unwrap_or(""))}))
        .collect();
    Ok(json!({"total":matches.len(),"commands":matches.into_iter().take(40).collect::<Vec<_>>()}))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn steps(value: Value) -> Vec<Step> {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn steps_are_limited_to_document_commands() {
        assert!(validate_steps(&steps(json!([{"id":"image.imageSize","params":{"width":10}},{"id":"type.edit","params":{"layer":3,"text":"Hi"}},{"id":"layer.renameLayer"}]))).is_ok());
        for invalid in [
            json!([]),
            json!([{"id":"file.save","params":{"path":"/tmp/x.png"}}]),
            json!([{"id":"app.quit"}]),
            json!([{"id":"layer.exportAs"}]),
            json!([{"id":"layer.smartObjects.relinkToFile"}]),
            json!([{"id":"layer.smartObjects.replaceContents"}]),
            json!([{"id":"type.loadDefaultTypeStyles"}]),
            json!([{"id":"shape.presets.new"}]),
            json!([{"id":"edit.copy"}]),
            json!([{"id":"edit.preferences.general"}]),
            json!([{"id":"image.imageSize","params":[1]}]),
        ] {
            assert!(validate_steps(&steps(invalid.clone())).is_err(), "{invalid}");
        }
        assert!(validate_steps(&vec![Step { id: "image.trim".into(), params: None }; MAX_STEPS + 1]).is_err());
        assert!(serde_json::from_value::<Step>(json!({"id":"image.trim","path":"x"})).is_err());
    }
    #[test]
    fn errors_and_summaries_never_name_the_engine() {
        assert!(!neutral("PhotoCraft step failed in photocraft-engine").to_lowercase().contains("photocraft"));
        let inspect = json!({"width":10,"height":5,"mode":"Rgb","depth":8,"layers":[
            {"id":2,"name":"Title","kind":"Type","visible":true,"opacity":1.0,"blend":"Normal","bounds":[0,0,5,5],"text":{"text":"Hi","font":"Inter","sizePt":24.0}},
            {"id":1,"name":"Group","kind":"Group","visible":false,"opacity":0.5,"blend":"Multiply","layers":[{"id":0,"name":"Inner","kind":"Pixel","visible":true}]}
        ]});
        let summary = summarize(&inspect);
        assert_eq!(summary["layers"][0]["text"], "Hi");
        assert!(summary["layers"][0].get("opacity").is_none());
        assert_eq!(summary["layers"][1]["blend"], "Multiply");
        assert_eq!(summary["layers"][1]["layers"][0]["name"], "Inner");
        let many = json!({"layers": (0..500).map(|i| json!({"id":i,"name":"x"})).collect::<Vec<_>>()});
        let summary = summarize(&many);
        assert_eq!(summary["layers"].as_array().unwrap().len(), MAX_LAYERS);
        assert_eq!(summary["truncated"], true);
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, y| image::Rgba([(x * 4) as u8, (y * 4) as u8, 128, 255]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }
    // Builds a small layered PSD with the editor itself, so no binary fixture is committed.
    pub(crate) async fn sample_psd(cli: &Path, destination: &Path) {
        let work = WorkDir::new().unwrap();
        let mut mcp = Mcp::start(cli, &work.0).await.unwrap();
        mcp.call("doc_new", json!({"width":200,"height":120,"background":"white","name":"poster"})).await.unwrap();
        mcp.batch(&steps(json!([
            {"id":"type.create","params":{"x":20,"y":60,"text":"Summer Sale","name":"Title","size":24,"color":"#ff0000"}},
            {"id":"layer.new.layer","params":{"name":"Paint"}},
        ]))).await.unwrap();
        mcp.call("doc_save", json!({"path":"poster.psd"})).await.unwrap();
        drop(mcp);
        std::fs::copy(work.0.join("poster.psd"), destination).unwrap();
    }
    fn leftover() -> usize {
        std::fs::read_dir(std::env::temp_dir()).unwrap().filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("hamster-edit-")).count()
    }
    fn find<'a>(layers: &'a Value, name: &str) -> &'a Value {
        layers.as_array().unwrap().iter().find(|l| l["name"] == name).unwrap_or_else(|| panic!("no layer {name} in {layers}"))
    }

    // Integration tests against a real editor build. Skipped unless the CLI is available
    // (HAMSTER_PHOTOCRAFT_CLI or the binary built by scripts/build-photocraft.mjs).
    // One test so the leftover-directory check cannot race with another editor run.
    #[tokio::test]
    async fn editor_integration() {
        let Some(cli) = cli() else { eprintln!("skipping: editor CLI not available"); return };
        let before = leftover();
        image_round_trip(&cli).await;
        psd_round_trip_keeps_layers(&cli).await;
        real_psd(&cli).await;
        assert_eq!(leftover(), before, "temporary work directories must be removed");
    }
    async fn image_round_trip(cli: &Path) {
        let cli = cli.to_path_buf();
        let (bytes, results) = edit_image(&cli, &png(64, 48), "png", &steps(json!([
            {"id":"image.imageSize","params":{"width":32,"height":24}},
            {"id":"filter.blur.gaussianBlur","params":{"radius":2}},
        ]))).await.unwrap();
        assert_eq!(results.as_array().unwrap().len(), 2, "{results}");
        let output = image::load_from_memory(&bytes).unwrap();
        assert_eq!((output.width(), output.height()), (32, 24));
        let error = edit_image(&cli, &png(8, 8), "png", &steps(json!([{"id":"filter.blur.noSuchBlur"}]))).await.unwrap_err();
        assert!(!error.to_lowercase().contains("photocraft"), "{error}");
        assert!(edit_image(&cli, b"not an image", "png", &steps(json!([{"id":"image.trim"}]))).await.is_err());
        let listed = commands(&cli, "gaussian").await.unwrap();
        assert!(listed["commands"].as_array().unwrap().iter().any(|c| c["id"] == "filter.blur.gaussianBlur"), "{listed}");
        assert_eq!(commands(&cli, "file.").await.unwrap()["total"], 0);
        assert_eq!(commands(&cli, "exportAs").await.unwrap()["total"], 0);
    }

    // Optional check against a real designer PSD: HAMSTER_TEST_PSD=/path/to/file.psd.
    // The file is never copied into the repository.
    async fn real_psd(cli: &Path) {
        let Some(original) = std::env::var_os("HAMSTER_TEST_PSD").map(PathBuf::from) else { eprintln!("skipping real PSD: set HAMSTER_TEST_PSD"); return };
        let out = WorkDir::new().unwrap();
        let edited = out.0.join("edited.psd");
        let first = inspect(cli, &original).await.unwrap();
        let text = first_text_layer(&first.summary["layers"]).expect("a visible text layer");
        let (_, warnings) = edit_document(cli, &original, &edited, &steps(json!([
            {"id":"type.edit","params":{"layer":text["id"],"text":"Hamster test"}},
        ]))).await.unwrap();
        // Open warnings must survive into the edit result.
        assert!(warnings.as_array().unwrap().len() >= first.warnings.as_array().map_or(0, Vec::len), "{warnings}");
        let second = inspect(cli, &edited).await.unwrap();
        assert_eq!(count(&second.summary["layers"]), count(&first.summary["layers"]));
        assert_ne!(first.preview, second.preview);
    }
    fn first_text_layer(layers: &Value) -> Option<Value> {
        layers.as_array()?.iter().find_map(|l| if l["kind"] == "Type" && l["visible"] == true && l["text"].as_str().is_some_and(|t| !t.is_empty()) { Some(l.clone()) } else { first_text_layer(&l["layers"]) })
    }
    fn count(layers: &Value) -> usize {
        layers.as_array().map_or(0, |items| items.iter().map(|l| 1 + count(&l["layers"])).sum())
    }
    async fn psd_round_trip_keeps_layers(cli: &Path) {
        let cli = cli.to_path_buf();
        let out = WorkDir::new().unwrap();
        let (original, edited, flat_png, broken) = (out.0.join("a.psd"), out.0.join("b.psd"), out.0.join("c.png"), out.0.join("broken.psd"));
        sample_psd(&cli, &original).await;
        assert!(std::fs::read(&original).unwrap().starts_with(b"8BPS"));
        let first = inspect(&cli, &original).await.unwrap();
        assert_eq!((first.summary["width"].as_u64(), first.summary["height"].as_u64()), (Some(200), Some(120)));
        let title = find(&first.summary["layers"], "Title");
        assert_eq!(title["text"], "Summer Sale");
        image::load_from_memory_with_format(&first.preview, image::ImageFormat::Png).unwrap();

        // Ids from the inspection address the same layers in the edit.
        let (results, _warnings) = edit_document(&cli, &original, &edited, &steps(json!([
            {"id":"type.edit","params":{"layer":title["id"],"text":"夏日特卖"}},
            {"id":"layer.renameLayer","params":{"layer":find(&first.summary["layers"], "Paint")["id"],"name":"Notes"}},
        ]))).await.unwrap();
        assert_eq!(results.as_array().unwrap().len(), 2, "{results}");
        assert!(std::fs::read(&edited).unwrap().starts_with(b"8BPS"));
        let second = inspect(&cli, &edited).await.unwrap();
        assert_eq!(second.summary["layers"].as_array().unwrap().len(), 3, "{}", second.summary);
        assert_eq!(find(&second.summary["layers"], "Title")["text"], "夏日特卖");
        find(&second.summary["layers"], "Notes");
        assert_ne!(first.preview, second.preview, "the preview must reflect the edit");

        export_png(&cli, &edited, &flat_png).await.unwrap();
        let flat = image::open(&flat_png).unwrap();
        assert_eq!((flat.width(), flat.height()), (200, 120));
        let failed = out.0.join("failed.psd");
        assert!(edit_document(&cli, &original, &failed, &steps(json!([{"id":"type.edit","params":{"layer":9999,"text":"x"}}]))).await.is_err());
        assert!(!failed.exists(), "a failed edit must not leave a document behind");
        std::fs::write(&broken, b"8BPS broken").unwrap();
        assert!(inspect(&cli, &broken).await.is_err());
    }
}
