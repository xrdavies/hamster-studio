// PSD documents are copied into app data and addressed by id. The original
// path is kept only in the local database (for "Replace original") and never
// reaches the renderer or the model.
use crate::agent::photocraft;
use crate::{
    lock,
    store::{id, now, string, Result},
    AppState,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

pub(crate) const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;
const PRIVATE: &[&str] = &["sourcePath", "sourceModified", "sourceSize"];

pub(crate) fn document_path(s: &AppState, name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || !name.ends_with(".psd") {
        return Err("Invalid document file".into());
    }
    let directory = s.directory.join("documents");
    let resolved = directory.join(name).canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(directory.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Invalid document path".into());
    }
    Ok(resolved)
}

// PSD only: version 1 header. PSB (version 2) is refused.
fn check_psd(path: &Path) -> Result<u64> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_DOCUMENT_BYTES { return Err("documents.tooLarge".into()); }
    let mut header = [0u8; 6];
    use std::io::Read;
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut header)).map_err(|_| "documents.unsupportedFormat")?;
    if &header[..4] != b"8BPS" || header[4..6] != [0, 1] { return Err("documents.unsupportedFormat".into()); }
    Ok(size)
}

fn source_stamp(path: &Path) -> Result<(u64, u64)> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok((modified, metadata.len()))
}

fn count_layers(layers: &Value) -> usize {
    layers.as_array().map_or(0, |items| items.iter().map(|l| 1 + count_layers(&l["layers"])).sum())
}

// Renderer view of documents: private source fields removed. A version can replace
// the original when its origin document was imported from a file.
pub(crate) fn public(rows: &[Value]) -> Vec<Value> {
    let has_source = |row: &Value| row["sourcePath"].as_str().is_some_and(|p| !p.is_empty());
    rows.iter().map(|row| {
        let origin = rows.iter().find(|r| r["id"] == row["originId"]).unwrap_or(row);
        let can_replace = has_source(origin) || has_source(row);
        let mut row = row.clone();
        if let Some(object) = row.as_object_mut() {
            for key in PRIVATE { object.remove(*key); }
        }
        row["canReplaceOriginal"] = json!(can_replace);
        row
    }).collect()
}

// Inspects a file already in the documents directory, saves its preview and stores the row.
// `parent` is the document this version was edited from.
pub(crate) async fn register(s: &AppState, session_id: &str, file: &str, name: &str, parent: Option<&Value>, source: Option<&Path>) -> Result<Value> {
    let cli = photocraft::cli().ok_or("documents.editingUnavailable")?;
    let path = document_path(s, file)?;
    let inspection = photocraft::inspect(&cli, &path).await?;
    let preview = format!("{}.png", id());
    let images = s.directory.join("images");
    std::fs::create_dir_all(&images).map_err(|e| e.to_string())?;
    std::fs::write(images.join(&preview), &inspection.preview).map_err(|e| e.to_string())?;
    let document_id = id();
    let mut row = json!({
        "id":document_id,"sessionId":session_id,"file":file,"name":name,
        "version":parent.map_or(1, |p| p["version"].as_u64().unwrap_or(1) + 1),
        "parentId":parent.map(|p| p["id"].clone()),
        "originId":parent.map_or(json!(document_id), |p| p["originId"].clone()),
        "previewImageId":preview,"width":inspection.summary["width"],"height":inspection.summary["height"],
        "layerCount":count_layers(&inspection.summary["layers"]),"summary":inspection.summary,
        "warnings":inspection.warnings,"createdAt":now()
    });
    if let Some(source) = source {
        let (modified, size) = source_stamp(source)?;
        row["sourcePath"] = json!(source.to_string_lossy());
        row["sourceModified"] = json!(modified);
        row["sourceSize"] = json!(size);
    }
    let stored = {
        let store = lock(&s.store)?;
        store.document(&row).and_then(|_| store.document_preview(session_id, &preview, &document_id))
    };
    if let Err(error) = stored {
        let _ = std::fs::remove_file(images.join(&preview));
        return Err(error);
    }
    Ok(row)
}

async fn import(s: &AppState, session_id: &str, source: PathBuf) -> Result<Value> {
    lock(&s.store)?.get("sessions", session_id)?;
    photocraft::cli().ok_or("documents.editingUnavailable")?;
    check_psd(&source)?;
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "document.psd".into());
    let directory = s.directory.join("documents");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = format!("{}.psd", id());
    let destination = directory.join(&file);
    if let Err(error) = std::fs::copy(&source, &destination) {
        let _ = std::fs::remove_file(&destination);
        return Err(error.to_string());
    }
    match register(s, session_id, &file, &name, None, Some(&source)).await {
        Ok(row) => Ok(public(&[row]).remove(0)),
        Err(error) => {
            let _ = std::fs::remove_file(destination);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn import_dropped_document(s: State<'_, AppState>, session_id: String, path: PathBuf) -> Result<Value> {
    import(&s, &session_id, path).await
}

#[tauri::command]
pub async fn import_documents(app: tauri::AppHandle, s: State<'_, AppState>, session_id: String) -> Result<Vec<Value>> {
    lock(&s.store)?.get("sessions", &session_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().add_filter("Photoshop", &["psd"]).pick_files(move |paths| { let _ = sender.send(paths); });
    let Some(files) = receiver.await.map_err(|e| e.to_string())? else { return Ok(vec![]) };
    if files.len() > crate::MAX_REFERENCE_IMAGES { return Err("images.referenceLimit".into()); }
    let paths = files.into_iter().map(|file| file.into_path().map_err(|e| e.to_string())).collect::<Result<Vec<_>>>()?;
    for path in &paths { check_psd(path)?; }
    let mut imported = Vec::new();
    for path in paths { imported.push(import(&s, &session_id, path).await?); }
    Ok(imported)
}

fn export_name(row: &Value, extension: &str) -> String {
    let stem = Path::new(string(row, "name")).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stem: String = stem.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)).take(60).collect();
    let stem = if stem.trim().is_empty() { "document".to_owned() } else { stem.trim().to_owned() };
    format!("{stem}-v{}.{extension}", row["version"].as_u64().unwrap_or(1))
}

async fn pick_target(app: &tauri::AppHandle, name: String) -> Result<Option<PathBuf>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().set_file_name(name).save_file(move |path| { let _ = sender.send(path); });
    receiver.await.map_err(|e| e.to_string())?.map(|p| p.into_path().map_err(|e| e.to_string())).transpose()
}

#[tauri::command]
pub async fn save_document(app: tauri::AppHandle, s: State<'_, AppState>, session_id: String, document_id: String) -> Result<bool> {
    let row = lock(&s.store)?.owned_document(&session_id, &document_id)?;
    let source = document_path(&s, string(&row, "file"))?;
    let Some(target) = pick_target(&app, export_name(&row, "psd")).await? else { return Ok(false) };
    crate::image_export::copy_unique(&source, &target)?;
    Ok(true)
}

#[tauri::command]
pub async fn export_document_png(app: tauri::AppHandle, s: State<'_, AppState>, session_id: String, document_id: String) -> Result<bool> {
    let row = lock(&s.store)?.owned_document(&session_id, &document_id)?;
    let source = document_path(&s, string(&row, "file"))?;
    let cli = photocraft::cli().ok_or("documents.editingUnavailable")?;
    let Some(target) = pick_target(&app, export_name(&row, "png")).await? else { return Ok(false) };
    let temporary = s.directory.join("documents").join(format!("{}.png", id()));
    let result = async {
        photocraft::export_png(&cli, &source, &temporary).await?;
        crate::image_export::copy_unique(&temporary, &target).map(|_| ())
    }.await;
    let _ = std::fs::remove_file(&temporary);
    result.map(|_| true)
}

// Writes a version back over the imported file. The renderer confirms first; the
// original must not have changed since it was imported or last replaced.
#[tauri::command]
pub fn replace_original(s: State<AppState>, session_id: String, document_id: String) -> Result<()> {
    let store = lock(&s.store)?;
    let row = store.owned_document(&session_id, &document_id)?;
    let mut origin = store.owned_document(&session_id, string(&row, "originId"))?;
    drop(store);
    let target = PathBuf::from(origin["sourcePath"].as_str().filter(|p| !p.is_empty()).ok_or("documents.noOriginal")?);
    let (modified, size) = source_stamp(&target).map_err(|_| "documents.originalMissing")?;
    if origin["sourceModified"].as_u64() != Some(modified) || origin["sourceSize"].as_u64() != Some(size) {
        return Err("documents.originalChanged".into());
    }
    let source = document_path(&s, string(&row, "file"))?;
    let name = target.file_name().ok_or("documents.noOriginal")?.to_string_lossy();
    let temporary = target.with_file_name(format!(".{name}.hamster-{}", id()));
    if let Err(error) = std::fs::copy(&source, &temporary).and_then(|_| std::fs::rename(&temporary, &target)) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    let (modified, size) = source_stamp(&target)?;
    origin["sourceModified"] = json!(modified);
    origin["sourceSize"] = json!(size);
    lock(&s.store)?.document(&origin)
}

// Document files are removed with their session (rows cascade in SQLite).
pub(crate) fn remove_session_files(s: &AppState, documents: &[Value]) {
    for document in documents {
        if let Ok(path) = document_path(s, string(document, "file")) {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_rows_hide_source_paths() {
        let rows = public(&[json!({"id":"a","originId":"a","sourcePath":"/Users/me/poster.psd","sourceModified":1,"sourceSize":2}), json!({"id":"b","originId":"a"}), json!({"id":"c","originId":"x"})]);
        assert!(!serde_json::to_string(&rows).unwrap().contains("/Users/me"));
        assert_eq!(rows[0]["canReplaceOriginal"], true);
        assert_eq!(rows[1]["canReplaceOriginal"], true);
        assert_eq!(rows[2]["canReplaceOriginal"], false);
    }
    #[test]
    fn only_psd_version_1_is_accepted() {
        let dir = std::env::temp_dir().join(format!("hamster-doc-test-{}", id()));
        std::fs::create_dir(&dir).unwrap();
        for (bytes, ok) in [(&b"8BPS\x00\x01rest"[..], true), (&b"8BPS\x00\x02rest"[..], false), (&b"\x89PNG\r\n"[..], false), (&b"8B"[..], false)] {
            let path = dir.join("x.psd");
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(check_psd(&path).is_ok(), ok, "{bytes:?}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn export_names_are_safe_and_versioned() {
        assert_eq!(export_name(&json!({"name":"海报/a:b.psd","version":3}), "psd"), "ab-v3.psd");
        assert_eq!(export_name(&json!({"name":"海报.psd","version":1}), "psd"), "海报-v1.psd");
        assert_eq!(export_name(&json!({"name":"poster.psd","version":2}), "png"), "poster-v2.png");
        assert_eq!(export_name(&json!({"name":"","version":1}), "psd"), "document-v1.psd");
    }
}
