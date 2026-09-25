#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod agent;
mod diagnostics;
mod catalog;
mod requests;
mod store;
use base64::Engine;
use catalog::Catalog;
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use store::{string, Result, Store};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;

struct AppState {
    store: Mutex<Store>,
    catalog: Mutex<Catalog>,
    candidate: Mutex<Option<Catalog>>,
    active: Mutex<HashMap<String, CancellationToken>>,
    approvals: Mutex<HashMap<String, (String, tokio::sync::oneshot::Sender<bool>)>>,
    directory: PathBuf,
    client: reqwest::Client,
}
fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    mutex.lock().map_err(|_| "State lock poisoned".into())
}
fn data(s: &AppState) -> Result<Value> {
    let catalog = lock(&s.catalog)?.clone();
    lock(&s.store)?.data(&catalog)
}
fn key(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("com.hamster.studio", id).map_err(|e| e.to_string())
}
fn password(id: &str) -> Result<String> {
    key(id)?.get_password().map_err(|e| e.to_string())
}
fn image_path(s: &AppState, name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || ![".png", ".jpg", ".webp"].iter().any(|ext| name.ends_with(ext)) {
        return Err("Invalid image file".into());
    }
    let path = s.directory.join("images").join(name);
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(
        s.directory
            .join("images")
            .canonicalize()
            .map_err(|e| e.to_string())?,
    ) {
        return Err("Invalid image path".into());
    }
    Ok(resolved)
}
#[tauri::command]
fn load(s: State<AppState>) -> Result<Value> {
    data(&s)
}
#[tauri::command]
fn save_session(s: State<AppState>, session: Value) -> Result<Value> {
    lock(&s.store)?.session(&session)?;
    data(&s)
}
#[tauri::command]
fn delete_session(s: State<AppState>, id: String) -> Result<Value> {
    if let Some(token) = lock(&s.active)?.get(&id) {
        token.cancel()
    }
    lock(&s.store)?.delete("sessions", &id)?;
    data(&s)
}
#[tauri::command]
fn save_provider(s: State<AppState>, input: Value) -> Result<()> {
    let id = input["id"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(store::id);
    let name = string(&input, "name").trim();
    if name.is_empty() {
        return Err("ui.providerNameIsRequired".into());
    }
    requests::url(string(&input, "baseUrl"), "/models")?;
    let mut p = json!({"id":id,"name":name,"baseUrl":string(&input,"baseUrl").trim().trim_end_matches('/')});
    for field in ["chatModels", "imageModels", "unknownModels"] {
        let mut list = Vec::new();
        if let Some(items) = input[field].as_array() {
            for item in items {
                let id = item.as_str().ok_or("Invalid model")?.trim();
                if !id.is_empty() && !list.contains(&id) {
                    list.push(id)
                }
            }
        }
        p[field] = json!(list);
    }
    let secret = string(&input, "apiKey").trim();
    if !secret.is_empty() {
        key(&id)?.set_password(secret).map_err(|e| e.to_string())?;
    }
    p["hasKey"] = json!(
        !secret.is_empty()
            || lock(&s.store)?
                .get("providers", &id)
                .map(|p| p["hasKey"] == true)
                .unwrap_or(false)
    );
    lock(&s.catalog)?.provider(&mut p);
    lock(&s.store)?.provider(&p)
}
#[tauri::command]
fn delete_provider(s: State<AppState>, id: String) -> Result<()> {
    match key(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(e) => return Err(e.to_string()),
    }
    lock(&s.store)?.delete("providers", &id)
}
#[tauri::command]
async fn fetch_models(s: State<'_, AppState>, input: Value) -> Result<Value> {
    let secret = if string(&input, "apiKey").trim().is_empty() {
        password(string(&input, "id"))?
    } else {
        string(&input, "apiKey").trim().to_owned()
    };
    let payload: Value = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        for attempt in 0..3 {
            let response = s.client.get(requests::url(string(&input,"baseUrl"), "/models")?)
                .bearer_auth(&secret).send().await;
            match response {
                Ok(response) => {
                    let status = response.status();
                    let delay = response.headers().get("retry-after").and_then(|h| h.to_str().ok()).and_then(|h| h.parse::<u64>().ok());
                    if status.is_success() { return response.json::<Value>().await.map_err(|e| e.to_string()); }
                    let body = response.text().await.unwrap_or_default();
                    let error = format!("HTTP {}: {}",status.as_u16(),body.chars().take(1500).collect::<String>());
                    if attempt == 2 || !agent::retry::transient(&error) { return Err(error); }
                    tokio::time::sleep(std::time::Duration::from_secs(delay.unwrap_or(if attempt == 0 {2} else {5}))).await;
                }
                Err(error) => {
                    if attempt == 2 || !(error.is_connect() || error.is_timeout()) { return Err(error.to_string()); }
                    tokio::time::sleep(std::time::Duration::from_secs(if attempt == 0 {2} else {5})).await;
                }
            }
        }
        Err("Model list request failed".into())
    }).await.map_err(|_| "Model list request timed out".to_string())??;
    let rows = payload["data"]
        .as_array()
        .ok_or("Invalid provider models response")?;
    Ok(lock(&s.catalog)?.classify(rows))
}
#[tauri::command]
fn classify_models(s: State<AppState>, models: Vec<String>) -> Result<Value> {
    Ok(lock(&s.catalog)?.classify(&models.into_iter().map(Value::String).collect::<Vec<_>>()))
}
#[tauri::command]
fn catalog_state(s: State<AppState>) -> Result<Value> {
    Ok(
        json!({"version":lock(&s.catalog)?.version,"availableVersion":lock(&s.candidate)?.as_ref().map(|c|c.version)}),
    )
}
#[tauri::command]
async fn check_catalog(s: State<'_, AppState>) -> Result<Value> {
    let mut response = s
        .client
        .get(catalog::URL)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("Model catalog exceeds 1 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let table = Catalog::parse(&bytes)?;
    let current = lock(&s.catalog)?.version;
    *lock(&s.candidate)? = if table.version > current {
        Some(table)
    } else {
        None
    };
    catalog_state(s)
}
#[tauri::command]
fn install_catalog(s: State<AppState>) -> Result<Value> {
    let mut candidate = lock(&s.candidate)?;
    let table = candidate.as_ref().ok_or("ui.checkModelCapabilitiesUpdatesFirst")?;
    let file = s.directory.join("model-capabilities.json");
    std::fs::write(
        file.with_extension("tmp"),
        serde_json::to_vec(table).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(file.with_extension("tmp"), file).map_err(|e| e.to_string())?;
    *lock(&s.catalog)? = table.clone();
    *candidate = None;
    drop(candidate);
    catalog_state(s)
}
fn image_mime(file: &str) -> &'static str {
    if file.ends_with(".jpg") { "image/jpeg" } else if file.ends_with(".webp") { "image/webp" } else { "image/png" }
}
fn imported_extension(bytes: &[u8]) -> Result<&'static str> {
    if bytes.len() > 10 * 1024 * 1024 { return Err("images.tooLarge".into()); }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Ok("png") }
    else if bytes.starts_with(b"\xff\xd8\xff") { Ok("jpg") }
    else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { Ok("webp") }
    else { Err("images.unsupportedFormat".into()) }
}
#[tauri::command]
async fn import_images(app: tauri::AppHandle, s: State<'_, AppState>, session_id: String, remaining: usize) -> Result<Vec<String>> {
    lock(&s.store)?.get("sessions", &session_id)?;
    if remaining == 0 || remaining > 6 { return Err("images.referenceLimit".into()); }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().add_filter("Images", &["png", "jpg", "jpeg", "webp"]).pick_files(move |paths| { let _ = sender.send(paths); });
    let Some(files) = receiver.await.map_err(|e| e.to_string())? else { return Ok(vec![]) };
    if files.len() > remaining { return Err("images.referenceLimit".into()); }
    // Validate the whole selection before importing any files.
    let paths = files.into_iter().map(|file| file.into_path().map_err(|e| e.to_string())).collect::<Result<Vec<_>>>()?;
    for path in &paths {
        if std::fs::metadata(path).map_err(|e|e.to_string())?.len() > 10 * 1024 * 1024 { return Err("images.tooLarge".into()); }
        imported_extension(&std::fs::read(path).map_err(|e|e.to_string())?)?;
    }
    paths.into_iter().map(|path| save_imported_image(&s, &session_id, path)).collect()
}
#[tauri::command]
fn import_dropped_image(s: State<AppState>, session_id: String, path: PathBuf) -> Result<String> {
    save_imported_image(&s, &session_id, path)
}
fn save_imported_image(s: &AppState, session_id: &str, path: PathBuf) -> Result<String> {
    lock(&s.store)?.get("sessions", session_id)?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 10 * 1024 * 1024 { return Err("images.tooLarge".into()); }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let extension = imported_extension(&bytes)?;
    let name = format!("{}.{}", store::id(), extension);
    let directory = s.directory.join("images");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let destination = directory.join(&name);
    std::fs::write(&destination, bytes).map_err(|e| e.to_string())?;
    if let Err(error) = lock(&s.store)?.import_image(&session_id, &name) {
        let _ = std::fs::remove_file(destination);
        return Err(error);
    }
    Ok(name)
}
// Masks are bound to the source file name and cannot be reused for a different source.
#[tauri::command]
fn save_mask(s: State<AppState>, file: String, data: String) -> Result<String> {
    crate::image_path(&s, &file)?;
    if data.len() > 14 * 1024 * 1024 { return Err("images.tooLarge".into()); }
    let encoded = data.strip_prefix("data:image/png;base64,").ok_or("Invalid mask format")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    validate_mask(&bytes)?;
    let name = format!("mask-{}-{}.png", file, store::id());
    std::fs::write(s.directory.join("images").join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}
fn validate_mask(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 33 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" || bytes[25] != 6 { return Err("Invalid RGBA PNG mask".into()); }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as u64;
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as u64;
    if width == 0 || height == 0 || width * height > 32_000_000 { return Err("images.regionTooLarge".into()); }
    Ok(())
}
fn validate_edit_mask(s: &AppState, references: &[String], mask: Option<&str>) -> Result<()> {
    if let Some(mask) = mask {
        let source = references.first().ok_or("A mask requires a source image")?;
        if !mask.starts_with(&format!("mask-{source}-")) { return Err("Mask does not belong to the source image".into()); }
        let bytes = std::fs::read(image_path(s, mask)?).map_err(|e| e.to_string())?;
        validate_mask(&bytes)?;
    }
    Ok(())
}
#[tauri::command]
fn read_image(s: State<AppState>, file: String) -> Result<String> {
    Ok(format!(
        "data:{};base64,{}",
        image_mime(&file),
        base64::engine::general_purpose::STANDARD
            .encode(std::fs::read(image_path(&s, &file)?).map_err(|e| e.to_string())?)
    ))
}
#[tauri::command]
async fn export_image(app: tauri::AppHandle, s: State<'_, AppState>, file: String) -> Result<bool> {
    let source = image_path(&s, &file)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(format!("hamster-image.{}", file.rsplit('.').next().unwrap_or("png")))
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    if let Some(path) = receiver.await.map_err(|e| e.to_string())? {
        std::fs::copy(source, path.into_path().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}
#[tauri::command]
async fn export_images(app: tauri::AppHandle, s: State<'_, AppState>, files: Vec<String>) -> Result<bool> {
    if files.is_empty() || files.len() > 100 { return Err("Invalid image selection".into()); }
    let sources = files.iter().map(|file|image_path(&s, file)).collect::<Result<Vec<_>>>()?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| { let _ = sender.send(path); });
    let Some(folder) = receiver.await.map_err(|e|e.to_string())? else { return Ok(false) };
    let directory = folder.into_path().map_err(|e|e.to_string())?.join(format!("hamster-images-{}",store::id()));
    std::fs::create_dir(&directory).map_err(|e|e.to_string())?;
    for (index, source) in sources.iter().enumerate() {
        let extension = source.extension().and_then(|v|v.to_str()).unwrap_or("png");
        std::fs::copy(source, directory.join(format!("{:02}.{extension}",index+1))).map_err(|e|e.to_string())?;
    }
    Ok(true)
}
#[tauri::command]
fn stop_chat(s: State<AppState>, id: String) -> Result<()> {
    if let Some(token) = lock(&s.active)?.get(&id) {
        token.cancel()
    }
    Ok(())
}
#[tauri::command]
fn can_install(s: State<AppState>) -> Result<()> {
    if !lock(&s.active)?.is_empty() {
        return Err("ui.waitForGenerationToFinishOrStopItBeforeUpdating".into());
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{
                    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, HELP_SUBMENU_ID,
                };
                let menu = Menu::default(app.handle())?;
                if let Some(application_menu) =
                    menu.items()?.first().and_then(|item| item.as_submenu())
                {
                    application_menu.remove_at(0)?;
                    application_menu.insert(
                        &PredefinedMenuItem::about(
                            app,
                            Some("About Hamster Studio"),
                            Some(AboutMetadata {
                                name: Some("Hamster Studio".into()),
                                version: Some(app.package_info().version.to_string()),
                                copyright: Some("Copyright © 2026 Frozen · MIT License".into()),
                                credits: Some(
                                    concat!(
                                "An open-source desktop app for AI chat and image generation.\n",
                                "Connect your own OpenAI Compatible providers.\n",
                                "No account required. Conversations stay on your device.\n\n",
                                "Created by Frozen\n",
                                "GitHub: https://github.com/xrdavies/hamster-studio\n",
                                "X: https://x.com/xrdavies"
                            )
                                    .into(),
                                ),
                                icon: app.default_window_icon().cloned(),
                                ..Default::default()
                            }),
                        )?,
                        0,
                    )?;
                }
                if let Some(help) = menu
                    .get(HELP_SUBMENU_ID)
                    .and_then(|item| item.as_submenu().cloned())
                {
                    if help.items()?.is_empty() {
                        menu.remove(&help)?;
                    }
                }
                for item in menu.items()? {
                    if let Some(submenu) = item.as_submenu() {
                        if submenu.text()? == "View" {
                            submenu.append(&PredefinedMenuItem::separator(app)?)?;
                            submenu.append(&MenuItem::with_id(
                                app,
                                "open-devtools",
                                "Developer Tools",
                                true,
                                Some("Cmd+Alt+I"),
                            )?)?;
                        }
                    }
                }
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == "open-devtools" {
                        if let Some(window) = app.get_webview_window("main") {
                            window.open_devtools();
                        }
                    }
                });
            }

            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(directory.join("images"))?;
            let catalog = Catalog::load(&directory.join("model-capabilities.json"));
            let store = Store::open(&directory.join("studio.db")).map_err(std::io::Error::other)?;
            app.manage(AppState {
                store: Mutex::new(store),
                catalog: Mutex::new(catalog),
                candidate: Mutex::new(None),
                active: Mutex::new(HashMap::new()),
                approvals: Mutex::new(HashMap::new()),
                directory,
                client: reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(30))
                    .timeout(std::time::Duration::from_secs(600))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()?,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load,
            save_session,
            delete_session,
            save_provider,
            delete_provider,
            fetch_models,
            classify_models,
            catalog_state,
            check_catalog,
            install_catalog,
            read_image,
            save_mask,
            import_images,
            import_dropped_image,
            export_image,
            export_images,
            agent::retry_image_step,
            stop_chat,
            can_install,
            agent::approve,
            requests::generate
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Hamster Studio");
}

#[cfg(test)]
mod image_import_tests {
    use super::*;
    #[test]
    fn validates_import_content_and_size() {
        assert_eq!(imported_extension(b"\x89PNG\r\n\x1a\n").unwrap(), "png");
        assert_eq!(imported_extension(b"\xff\xd8\xff").unwrap(), "jpg");
        assert!(imported_extension(b"not an image").is_err());
        let mut bytes = vec![0; 10 * 1024 * 1024];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        assert_eq!(imported_extension(&bytes).unwrap(), "png");
        bytes.push(0);
        assert_eq!(imported_extension(&bytes).unwrap_err(), "images.tooLarge");
    }
}
