// Experimental: deterministic, non-generative edits through a local PhotoCraft CLI.
// Each call starts a headless `photocraft-cli mcp` whose read/write roots are a
// private temporary directory, so PhotoCraft never sees the image library.
use super::*;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub(crate) const CLI_ENV: &str = "HAMSTER_PHOTOCRAFT_CLI";
const MAX_STEPS: usize = 16;
const MAX_EDITS: usize = 3;
const MAX_OUTPUT_BYTES: u64 = 50 * 1024 * 1024;
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
// Pixel and document edits only; file, app, automation and plug-in commands stay unavailable.
const ALLOWED_PREFIXES: &[&str] = &["image.", "filter.", "select.", "layer.flattenImage"];

pub(crate) fn cli() -> Option<PathBuf> {
    std::env::var_os(CLI_ENV).map(PathBuf::from).filter(|path| path.is_file())
}

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Step {
    id: String,
    #[serde(default)]
    params: Option<Value>,
}
fn validate_steps(steps: &[Step]) -> Result<()> {
    if steps.is_empty() || steps.len() > MAX_STEPS {
        return Err(format!("Provide 1 to {MAX_STEPS} PhotoCraft steps."));
    }
    for step in steps {
        if !ALLOWED_PREFIXES.iter().any(|prefix| step.id.starts_with(prefix)) {
            return Err(format!("PhotoCraft command {} is not allowed. Use image.*, filter.*, select.* or layer.flattenImage commands.", step.id));
        }
        if step.params.as_ref().is_some_and(|params| !params.is_object()) {
            return Err(format!("Params for {} must be a JSON object.", step.id));
        }
    }
    Ok(())
}

struct WorkDir(PathBuf);
impl WorkDir {
    fn new() -> Result<Self> {
        let path = std::env::temp_dir().join(format!("hamster-photocraft-{}", id()));
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
            .map_err(|e| format!("Could not start PhotoCraft: {e}"))?;
        let stdin = child.stdin.take().ok_or("PhotoCraft stdin unavailable")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("PhotoCraft stdout unavailable")?).lines();
        let mut mcp = Self { _child: child, stdin, stdout, next: 0 };
        mcp.request("initialize", json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hamster-studio","version":env!("CARGO_PKG_VERSION")}})).await?;
        mcp.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await?;
        Ok(mcp)
    }
    async fn send(&mut self, message: &Value) -> Result<()> {
        let mut line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.stdin.write_all(&line).await.map_err(|e| format!("PhotoCraft connection failed: {e}"))?;
        self.stdin.flush().await.map_err(|e| format!("PhotoCraft connection failed: {e}"))
    }
    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        self.next += 1;
        let request_id = self.next;
        self.send(&json!({"jsonrpc":"2.0","id":request_id,"method":method,"params":params})).await?;
        tokio::time::timeout(REQUEST_TIMEOUT, async {
            loop {
                let line = self.stdout.next_line().await.map_err(|e| e.to_string())?.ok_or("PhotoCraft exited unexpectedly")?;
                // Skip notifications and anything that is not our response.
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if message["id"] != json!(request_id) { continue; }
                if let Some(error) = message.get("error") {
                    return Err(format!("PhotoCraft {method} failed: {}", error["message"].as_str().unwrap_or("unknown error")));
                }
                return Ok(message["result"].clone());
            }
        }).await.map_err(|_| format!("PhotoCraft {method} timed out"))?
    }
    async fn call(&mut self, tool: &str, arguments: Value) -> Result<Value> {
        let result = self.request("tools/call", json!({"name":tool,"arguments":arguments})).await?;
        let text = result["content"].as_array().into_iter().flatten()
            .filter_map(|item| item["text"].as_str()).collect::<Vec<_>>().join("\n");
        if result["isError"] == true {
            return Err(format!("PhotoCraft {tool} failed: {text}"));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }
}

// Opens the input, runs the steps and returns the flattened PNG bytes plus the batch report.
pub(crate) async fn process(cli: &Path, input: &[u8], extension: &str, steps: &[Step]) -> Result<(Vec<u8>, Value)> {
    validate_steps(steps)?;
    let work = WorkDir::new()?;
    let source = format!("input.{extension}");
    std::fs::write(work.0.join(&source), input).map_err(|e| e.to_string())?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    mcp.call("doc_open", json!({"path":source})).await?;
    let steps_json: Vec<Value> = steps.iter().map(|step| json!({"id":step.id,"params":step.params.clone().unwrap_or_else(|| json!({}))})).collect();
    let report = mcp.call("command_batch", json!({"steps":steps_json,"stop_on_error":true})).await?;
    if report["failed"].as_u64() != Some(0) {
        let errors: Vec<_> = report["results"].as_array().into_iter().flatten()
            .filter_map(|result| result["error"].as_str()).collect();
        return Err(format!("PhotoCraft step failed: {}", if errors.is_empty() { report.to_string() } else { errors.join("; ") }));
    }
    mcp.call("doc_save", json!({"path":"output.png","format":"png"})).await?;
    drop(mcp);
    let output = work.0.join("output.png");
    let size = std::fs::metadata(&output).map_err(|_| "PhotoCraft did not write an output image")?.len();
    if size == 0 || size > MAX_OUTPUT_BYTES {
        return Err("PhotoCraft output is empty or exceeds 50 MB".into());
    }
    let bytes = std::fs::read(&output).map_err(|e| e.to_string())?;
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(|_| "PhotoCraft output is not a valid PNG")?;
    Ok((bytes, report))
}

pub(crate) async fn commands(cli: &Path, filter: &str) -> Result<Value> {
    let work = WorkDir::new()?;
    let mut mcp = Mcp::start(cli, &work.0).await?;
    let all = mcp.call("command_list", json!({"filter":filter})).await?;
    let matches: Vec<Value> = all.as_array().into_iter().flatten()
        .filter(|command| command["id"].as_str().is_some_and(|id| ALLOWED_PREFIXES.iter().any(|prefix| id.starts_with(prefix))))
        .map(|command| json!({"id":command["id"],"label":command["label"],"params":command["params"]}))
        .collect();
    Ok(json!({"total":matches.len(),"commands":matches.into_iter().take(40).collect::<Vec<_>>()}))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EditArgs {
    source_image_id: String,
    description: String,
    steps: Vec<Step>,
}
pub(super) struct PhotocraftEdit(pub Arc<Run>, pub PathBuf);
impl Tool for PhotocraftEdit {
    const NAME: &'static str = "photocraft_edit";
    type Args = EditArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Edit a session image with PhotoCraft, a local non-generative image editor. Use for exact, deterministic operations: resize (image.imageSize), crop, rotate, blur, sharpen and colour adjustments. It is free, needs no image model and leaves the original untouched; the result is saved as a new PNG image. Use photocraft_commands to find command ids and parameter formats. Steps run in order on one document.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{
            "source_image_id":{"type":"string","description":"attachment_N handle or exact session imageId"},
            "description":{"type":"string","description":"Short summary of the edit shown to the user"},
            "steps":{"type":"array","minItems":1,"maxItems":MAX_STEPS,"items":{"type":"object","properties":{"id":{"type":"string"},"params":{"type":"object"}},"required":["id"],"additionalProperties":false}}
        },"required":["source_image_id","description","steps"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: EditArgs) -> std::result::Result<Value, std::io::Error> {
        self.execute(args).await.map_err(std::io::Error::other)
    }
}
impl PhotocraftEdit {
    async fn execute(&self, args: EditArgs) -> Result<Value> {
        let run = &self.0;
        let used = lock(&run.output)?["steps"].as_array().into_iter().flatten().filter(|step| step["operation"] == "photocraft").count();
        if used >= MAX_EDITS {
            return Ok(json!({"error":format!("Each task can run up to {MAX_EDITS} PhotoCraft edits."),"recoverable":false}));
        }
        if let Err(error) = validate_steps(&args.steps) {
            return Ok(json!({"error":error,"recoverable":true}));
        }
        let Ok(source) = assets::resolve_image(run, &args.source_image_id) else { return Ok(assets::invalid_reference()) };
        let state = run.app.state::<AppState>();
        let path = crate::image_path(&state, &source)?;
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_owned();
        let input = std::fs::read(&path).map_err(|e| e.to_string())?;
        let step_id = id();
        run.update(|o| {
            o["steps"].as_array_mut().unwrap().push(json!({
                "id":step_id,"operation":"photocraft","prompt":args.description,"count":1,"status":"running","needsConfiguration":false,
                "sourceImageId":source,"sourceImageIds":[source],"commands":args.steps,"imageFiles":[],"error":"","providerName":"PhotoCraft","model":"local"
            }));
        })?;
        let started = std::time::Instant::now();
        let result = async {
            let (bytes, report) = process(&self.1, &input, &extension, &args.steps).await?;
            let name = format!("{}.png", id());
            std::fs::write(state.directory.join("images").join(&name), bytes).map_err(|e| e.to_string())?;
            Ok::<_, String>((name, report))
        }.await;
        crate::diagnostics::record(&run.app, "photocraft.step", json!({"sessionId":run.session_id,"stepId":step_id,"elapsedMs":started.elapsed().as_millis(),"success":result.is_ok(),"commands":args.steps.iter().map(|s| &s.id).collect::<Vec<_>>()}));
        match result {
            Ok((name, report)) => {
                run.update(|o| {
                    o["imageFiles"].as_array_mut().unwrap().push(json!(name));
                    let step = step_mut(o, &step_id);
                    step["imageFiles"] = json!([name]);
                    step["status"] = json!("done");
                })?;
                Ok(json!({"imageFiles":[name],"sourceImageId":source,"operation":"photocraft","results":report["results"]}))
            }
            // Report failures to the model so it can correct command ids or params.
            Err(error) => {
                run.update(|o| {
                    let step = step_mut(o, &step_id);
                    step["status"] = json!("error");
                    step["error"] = json!(error);
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
pub(super) struct PhotocraftCommands(pub PathBuf);
impl Tool for PhotocraftCommands {
    const NAME: &'static str = "photocraft_commands";
    type Args = CommandArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Search PhotoCraft commands usable with photocraft_edit by id or label (for example \"size\", \"crop\", \"rotate\", \"blur\", \"levels\"). Returns ids with their parameter formats.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"filter":{"type":"string"}},"required":["filter"],"additionalProperties":false})
    }
    async fn call(&self, _: &mut ToolContext, args: CommandArgs) -> std::result::Result<Value, std::io::Error> {
        Ok(commands(&self.0, &args.filter).await.unwrap_or_else(|error| json!({"error":error})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn steps(value: Value) -> Vec<Step> {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn steps_are_limited_to_pixel_commands() {
        assert!(validate_steps(&steps(json!([{"id":"image.imageSize","params":{"width":10}},{"id":"filter.blur.gaussianBlur"}]))).is_ok());
        for invalid in [
            json!([]),
            json!([{"id":"file.save","params":{"path":"/tmp/x.png"}}]),
            json!([{"id":"app.quit"}]),
            json!([{"id":"image.imageSize","params":[1]}]),
        ] {
            assert!(validate_steps(&steps(invalid)).is_err());
        }
        assert!(validate_steps(&vec![Step { id: "image.trim".into(), params: None }; MAX_STEPS + 1]).is_err());
        assert!(serde_json::from_value::<Step>(json!({"id":"image.trim","path":"x"})).is_err());
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, y| image::Rgba([(x * 4) as u8, (y * 4) as u8, 128, 255]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    // Integration test against a real PhotoCraft build. Skipped unless
    // HAMSTER_PHOTOCRAFT_CLI points at a photocraft-cli binary.
    #[tokio::test]
    async fn photocraft_cli_round_trip() {
        let Some(cli) = cli() else {
            eprintln!("skipping: set {CLI_ENV} to a photocraft-cli binary");
            return;
        };
        let leftover = || std::fs::read_dir(std::env::temp_dir()).unwrap().filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("hamster-photocraft-")).count();
        let before = leftover();

        let (bytes, report) = process(&cli, &png(64, 48), "png", &steps(json!([
            {"id":"image.imageSize","params":{"width":32,"height":24}},
            {"id":"filter.blur.gaussianBlur","params":{"radius":2}},
        ]))).await.unwrap();
        assert_eq!(report["completed"], 2, "{report}");
        let output = image::load_from_memory(&bytes).unwrap();
        assert_eq!((output.width(), output.height()), (32, 24));

        let error = process(&cli, &png(8, 8), "png", &steps(json!([{"id":"filter.blur.noSuchBlur"}]))).await.unwrap_err();
        assert!(error.contains("noSuchBlur") || error.contains("unknown") || error.contains("Unknown"), "{error}");
        assert!(process(&cli, b"not an image", "png", &steps(json!([{"id":"image.trim"}]))).await.is_err());

        let listed = commands(&cli, "gaussian").await.unwrap();
        assert!(listed["commands"].as_array().unwrap().iter().any(|c| c["id"] == "filter.blur.gaussianBlur"), "{listed}");
        let files = commands(&cli, "file.").await.unwrap();
        assert_eq!(files["total"], 0, "file commands must not be offered: {files}");

        assert_eq!(leftover(), before, "temporary PhotoCraft work directories must be removed");
    }
}
