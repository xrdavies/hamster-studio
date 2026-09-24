#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
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
    if name.is_empty() || name.contains('/') || name.contains('\\') || !name.ends_with(".png") {
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
        return Err("Provider 名称不能为空".into());
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
    let response = s
        .client
        .get(requests::url(string(&input, "baseUrl"), "/models")?)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
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
    let table = candidate.as_ref().ok_or("请先检查模型能力表更新")?;
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
#[tauri::command]
fn read_image(s: State<AppState>, file: String) -> Result<String> {
    Ok(format!(
        "data:image/png;base64,{}",
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
        .set_file_name("hamster-image.png")
        .add_filter("PNG", &["png"])
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
fn stop_chat(s: State<AppState>, id: String) -> Result<()> {
    if let Some(token) = lock(&s.active)?.get(&id) {
        token.cancel()
    }
    Ok(())
}
#[tauri::command]
fn can_install(s: State<AppState>) -> Result<()> {
    if !lock(&s.active)?.is_empty() {
        return Err("请等待生成完成或停止生成后再更新".into());
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
                use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, HELP_SUBMENU_ID};
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
                app.set_menu(menu)?;
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
            export_image,
            stop_chat,
            can_install,
            requests::generate
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Hamster Studio");
}
