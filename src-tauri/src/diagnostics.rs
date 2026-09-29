use crate::store::Result;
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const LIMIT: u64 = 10 * 1024 * 1024;
const FILES: usize = 10;
static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
// ponytail: one lock for bounded local log I/O; use a writer queue if logging stalls requests.
static IO: Mutex<()> = Mutex::new(());
static SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn init(directory: &Path) -> std::io::Result<()> {
    let path = directory.join("logs");
    std::fs::create_dir_all(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    }
    let _ = DIRECTORY.set(path);
    write("app.start", json!({"version":env!("CARGO_PKG_VERSION")}));
    Ok(())
}
pub fn register_secret(secret: &str) {
    if !secret.is_empty() {
        if let Ok(mut secrets) = SECRETS.lock() {
            if !secrets.iter().any(|s| s == secret) {
                secrets.push(secret.to_owned());
            }
        }
    }
}
fn scrub(value: &mut Value, secrets: &[String]) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                let key = key.to_ascii_lowercase().replace(['-', '_'], "");
                if [
                    "authorization",
                    "proxyauthorization",
                    "cookie",
                    "setcookie",
                    "apikey",
                    "password",
                    "secret",
                    "accesstoken",
                    "refreshtoken",
                ]
                .contains(&key.as_str())
                {
                    *value = json!("[REDACTED]");
                } else if key == "b64json" {
                    *value = json!("[image bytes omitted]");
                } else {
                    scrub(value, secrets);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                scrub(item, secrets);
            }
        }
        Value::String(s) => {
            if s.starts_with("data:image/") {
                *s = "[image bytes omitted]".into();
                return;
            }
            for secret in secrets {
                *s = s.replace(secret, "[REDACTED]");
            }
        }
        _ => {}
    }
}
pub fn write(stage: &str, metadata: Value) {
    let Some(directory) = DIRECTORY.get() else {
        return;
    };
    let mut entry = json!({"timestamp":crate::store::now(),"level":if stage.contains("error") || stage.contains("failed") {"error"} else {"info"},"stage":stage,"metadata":metadata});
    let Ok(secrets) = SECRETS.lock() else { return };
    scrub(&mut entry, &secrets);
    drop(secrets);
    let Ok(_guard) = IO.lock() else { return };
    if let Err(error) = append(directory, &entry, LIMIT) {
        eprintln!("Unable to write diagnostic log: {error}");
    }
}
fn append(directory: &Path, entry: &Value, limit: u64) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(entry)?;
    bytes.push(b'\n');
    // Preserve UTF-8 and correlation fields when a large entry spans files.
    let text = String::from_utf8(bytes).map_err(std::io::Error::other)?;
    let mut rest = text.as_str();
    let mut part = 0;
    let entry_id = crate::store::id();
    while !rest.is_empty() {
        let mut end = if part == 0 && rest.len() as u64 <= limit {
            rest.len()
        } else {
            rest.len().min((limit / 12).max(4) as usize)
        };
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        let chunk = &rest[..end];
        rest = &rest[end..];
        part += 1;
        let fragment = if part == 1 && rest.is_empty() {
            chunk.as_bytes().to_vec()
        } else {
            let mut data = serde_json::to_vec(
                &json!({"timestamp":entry["timestamp"],"stage":"log.fragment","entryId":entry_id,"context":entry["metadata"]["context"],"part":part,"last":rest.is_empty(),"text":chunk}),
            )?;
            data.push(b'\n');
            data
        };
        let path = directory.join("current.jsonl");
        if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) + fragment.len() as u64 > limit {
            let oldest = directory.join(format!("{}.jsonl", FILES - 1));
            if oldest.exists() {
                std::fs::remove_file(oldest)?;
            }
            for i in (1..FILES - 1).rev() {
                let from = directory.join(format!("{i}.jsonl"));
                if from.exists() {
                    std::fs::rename(from, directory.join(format!("{}.jsonl", i + 1)))?;
                }
            }
            if path.exists() {
                std::fs::rename(&path, directory.join("1.jsonl"))?;
            }
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)?.write_all(&fragment)?;
    }
    Ok(())
}
pub fn record(_: &tauri::AppHandle, stage: &str, metadata: Value) {
    write(stage, metadata);
}
fn paths(directory: &Path) -> Vec<PathBuf> {
    (1..FILES)
        .rev()
        .map(|i| directory.join(format!("{i}.jsonl")))
        .chain(std::iter::once(directory.join("current.jsonl")))
        .filter(|p| p.exists())
        .collect()
}
#[tauri::command]
pub fn read_logs(app: tauri::AppHandle, request_id: Option<String>) -> Result<String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    let _guard = IO.lock().map_err(|e| e.to_string())?;
    let files = if request_id.is_some() {
        paths(&directory)
    } else {
        vec![directory.join("current.jsonl")]
    };
    let mut result = String::new();
    for path in files {
        if !path.exists() {
            continue;
        }
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        for line in text.lines() {
            if request_id.as_ref().is_none_or(|id| line.contains(id)) {
                result.push_str(line);
                result.push('\n');
            }
        }
    }
    Ok(result)
}
#[tauri::command]
pub fn clear_logs(app: tauri::AppHandle) -> Result<()> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    let _guard = IO.lock().map_err(|e| e.to_string())?;
    for path in paths(&directory) {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn export_logs(app: tauri::AppHandle) -> Result<bool> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name("hamster-diagnostics.zip")
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(path) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");
    let _guard = IO.lock().map_err(|e| e.to_string())?;
    let file = std::fs::File::create(path.into_path().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    for path in paths(&directory) {
        archive
            .start_file(
                path.file_name().unwrap().to_string_lossy(),
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .map_err(|e| e.to_string())?;
        std::io::copy(
            &mut std::fs::File::open(path).map_err(|e| e.to_string())?,
            &mut archive,
        )
        .map_err(|e| e.to_string())?;
    }
    archive.finish().map_err(|e| e.to_string())?;
    Ok(true)
}
#[tauri::command]
pub fn frontend_error(message: String) {
    write(
        "frontend.error",
        json!({"message":message.chars().take(20000).collect::<String>()}),
    );
}
#[tauri::command]
pub fn frontend_operation(command: String, error: Option<String>) {
    write(
        if error.is_some() {
            "operation.error"
        } else {
            "operation.start"
        },
        json!({"command":command,"error":error}),
    );
}
pub fn status_from_error(error: &str) -> Option<u16> {
    ["status ", "HTTP ", "status code ", "status code: "]
        .iter()
        .find_map(|prefix| {
            let code: u16 = error.split_once(prefix)?.1.get(..3)?.parse().ok()?;
            (400..600).contains(&code).then_some(code)
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_redact_credentials_and_rotate() {
        let mut value = json!({"Authorization":"Bearer abc","nested":{"api_key":"abc"},"body":"secret abc","b64_json":"large"});
        scrub(&mut value, &["abc".into()]);
        assert!(!value.to_string().contains("abc"));
        let dir = std::env::temp_dir().join(crate::store::id());
        std::fs::create_dir(&dir).unwrap();
        for _ in 0..100 {
            append(&dir, &json!({"line":"0123456789"}), 128).unwrap();
        }
        assert_eq!(paths(&dir).len(), FILES);
        for path in paths(&dir) {
            assert!(std::fs::metadata(path).unwrap().len() <= 128);
        }
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::create_dir(&dir).unwrap();
        let original = json!({"timestamp":1,"metadata":{"context":{"messageId":"message-a"},"text":"中文🙂".repeat(500)}});
        append(&dir, &original, 4096).unwrap();
        let mut restored = String::new();
        for path in paths(&dir) {
            assert!(std::fs::metadata(&path).unwrap().len() <= 4096);
            for line in std::fs::read_to_string(path).unwrap().lines() {
                let fragment: Value = serde_json::from_str(line).unwrap();
                assert_eq!(fragment["context"]["messageId"], "message-a");
                restored.push_str(fragment["text"].as_str().unwrap());
            }
        }
        assert_eq!(serde_json::from_str::<Value>(&restored).unwrap(), original);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn extracts_only_http_status_from_untrusted_error() {
        assert_eq!(status_from_error("HTTP 429"), Some(429));
        assert_eq!(
            status_from_error("Invalid status code 503 with message"),
            Some(503)
        );
        assert_eq!(status_from_error("private prompt"), None);
    }
}
