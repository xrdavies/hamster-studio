use crate::catalog::Catalog;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id);").map_err(|e| e.to_string())?;
        let store = Self { db };
        for mut message in store.rows("messages")? {
            let mut migrated = false;
            if let Some(error) = message["error"].as_str() {
                let key = legacy_error(error);
                if key != error { message["error"] = json!(key); migrated = true; }
            }
            if let Some(steps) = message["steps"].as_array_mut() {
                for step in steps {
                    if let Some(error) = step["error"].as_str() {
                        let key = legacy_error(error);
                        if key != error { step["error"] = json!(key); migrated = true; }
                    }
                }
            }
            if migrated { store.message(&message)?; }
            if message["status"] == "streaming" {
                if message["steps"].as_array().is_some_and(|steps| steps.iter().any(|step| step["status"] == "running" || step["status"] == "waiting" || step["status"] == "error")) { message["canContinue"] = json!(false); }
                message["status"] = json!("error");
                message["error"] = json!("ui.previousGenerationWasInterrupted");
                if let Some(steps) = message["steps"].as_array_mut() {
                    for step in steps {
                        if step["status"] == "running" || step["status"] == "waiting" {
                            step["status"] = json!("error");
                            step["error"] = json!("ui.previousGenerationWasInterrupted");
                        }
                    }
                }
                store.message(&message)?;
            }
        }
        Ok(store)
    }
    pub(crate) fn rows(&self, table: &str) -> Result<Vec<Value>> {
        let mut stmt = self
            .db
            .prepare(&format!("SELECT data FROM {table} ORDER BY rowid"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn get(&self, table: &str, id: &str) -> Result<Value> {
        let text: Option<String> = self
            .db
            .query_row(&format!("SELECT data FROM {table} WHERE id=?"), [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&text.ok_or_else(|| format!("{table}: not found"))?)
            .map_err(|e| e.to_string())
    }
    pub fn data(&self, catalog: &Catalog) -> Result<Value> {
        let mut providers = self.rows("providers")?;
        for p in &mut providers {
            catalog.provider(p)
        }
        let mut sessions = self.rows("sessions")?;
        sessions.sort_by_key(|s| {
            std::cmp::Reverse((
                s["pinned"].as_bool().unwrap_or(false),
                s["updatedAt"].as_u64().unwrap_or(0),
            ))
        });
        let mut messages = self.rows("messages")?;
        messages.sort_by_key(|m| m["createdAt"].as_u64().unwrap_or(0));
        Ok(json!({"providers": providers, "sessions": sessions, "messages": messages}))
    }
    pub fn import_image(&self, session: &str, file: &str) -> Result<()> {
        let value = json!({"sessionId":session,"imageFiles":[file],"createdAt":now(),"content":"Imported local image"});
        self.db.execute("INSERT INTO images VALUES (?, ?, ?)", params![file, session, value.to_string()]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn image_rows(&self) -> Result<Vec<Value>> {
        let mut rows = self.rows("messages")?;
        rows.extend(self.rows("images")?);
        Ok(rows)
    }
    pub fn owns_image(&self, session: &str, file: &str) -> Result<bool> {
        Ok(self.image_rows()?.iter().any(|m| m["sessionId"] == session && m["imageFiles"].as_array().is_some_and(|files| files.contains(&json!(file)))))
    }
    pub fn provider(&self, value: &Value) -> Result<()> {
        self.db.execute("INSERT INTO providers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![string(value,"id"), value.to_string()]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn session(&self, input: &Value) -> Result<()> {
        let session_id = input["id"].as_str().map(str::to_owned).unwrap_or_else(id);
        let mut value = self.get("sessions", &session_id).unwrap_or_else(|_| json!({"id":session_id,"title":"新对话","providerId":"","chatModel":"","imageModel":"","modelKind":"chat","systemPrompt":"","createdAt":now(),"pinned":false,"archived":false}));
        let object = input.as_object().ok_or("Invalid session")?;
        for key in [
            "title",
            "providerId",
            "chatModel",
            "imageModel",
            "modelKind",
            "imageProviderId",
            "skill",
            "systemPrompt",
            "pinned",
            "archived",
        ] {
            if let Some(v) = object.get(key) {
                value[key] = v.clone()
            }
        }
        for key in [
            "title",
            "providerId",
            "chatModel",
            "imageModel",
            "systemPrompt",
        ] {
            if !value[key].is_string() {
                return Err("Invalid session field".into());
            }
        }
        for key in ["pinned", "archived"] {
            if !value[key].is_boolean() {
                return Err("Invalid session flag".into());
            }
        }
        if let Some(v) = value.get("imageProviderId") {
            if !v.is_string() {
                return Err("Invalid image provider".into());
            }
        }
        if !["chat", "image"].contains(&string(&value, "modelKind")) {
            return Err("Invalid model kind".into());
        }
        if string(&value, "chatModel").is_empty() && string(&value, "imageModel").is_empty() {
            return Err("ui.configureASupportedModelFirst".into());
        }
        if self.get("sessions", &session_id).is_err() {
            self.get("providers", string(&value, "providerId"))?;
        }
        value["updatedAt"] = json!(now());
        self.db.execute("INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![session_id,value.to_string()]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn delete(&self, table: &str, id: &str) -> Result<()> {
        self.db
            .execute(&format!("DELETE FROM {table} WHERE id=?"), [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn message(&self, value: &Value) -> Result<bool> {
        let Ok(mut session) = self.get("sessions", string(value, "sessionId")) else {
            return Ok(false);
        };
        self.db.execute("INSERT INTO messages VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![string(value,"id"),string(value,"sessionId"),value.to_string()]).map_err(|e| e.to_string())?;
        session["updatedAt"] = json!(now());
        self.db
            .execute(
                "UPDATE sessions SET data=? WHERE id=?",
                params![session.to_string(), string(value, "sessionId")],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
    pub fn history(&self, id: &str) -> Result<Vec<Value>> {
        Ok(self
            .rows("messages")?
            .into_iter()
            .filter(|m| {
                string(m, "sessionId") == id && m["kind"] == "chat" && m["status"] == "done"
            })
            .map(|m| json!({"role":m["role"],"content":m["content"]}))
            .collect())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sessions_are_isolated_and_deletion_drops_late_messages() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        store.provider(&json!({"id":"p"})).unwrap();
        for id in ["a", "b"] {
            store
                .session(&json!({"id":id,"providerId":"p","chatModel":"chat"}))
                .unwrap();
        }
        store
            .session(&json!({"id":"a","modelKind":"image","imageModel":"gpt-image-2"}))
            .unwrap();
        store.session(&json!({"id":"a","title":"new"})).unwrap();
        assert_eq!(store.get("sessions", "a").unwrap()["modelKind"], "image");
        assert_eq!(store.get("sessions", "b").unwrap()["modelKind"], "chat");
        store.import_image("a", "local.jpg").unwrap();
        assert!(store.owns_image("a", "local.jpg").unwrap());
        assert!(!store.owns_image("b", "local.jpg").unwrap());
        store.delete("providers", "p").unwrap();
        assert!(store.get("sessions", "a").is_ok());
        store.delete("sessions", "a").unwrap();
        assert!(!store.owns_image("a", "local.jpg").unwrap());
        assert!(store.import_image("a", "late.jpg").is_err());
        assert!(!store
            .message(&json!({"id":"late","sessionId":"a"}))
            .unwrap());
    }
    #[test]
    fn restart_preserves_completed_images_and_interrupts_pending_steps() {
        let file = std::env::temp_dir().join(format!("{}.db", id()));
        {
            let store = Store::open(&file).unwrap();
            store.provider(&json!({"id":"p"})).unwrap();
            store.session(&json!({"id":"a","providerId":"p","chatModel":"chat","imageProviderId":"images","imageModel":"image"})).unwrap();
            store.message(&json!({"id":"m","sessionId":"a","status":"streaming","imageFiles":["done.png"],"steps":[{"status":"done"},{"status":"waiting"},{"status":"running","dispatchState":"unknown","fingerprint":["paid"],"imageFiles":["partial.png"]}]})).unwrap();
        }
        let store = Store::open(&file).unwrap();
        let m = store.get("messages", "m").unwrap();
        assert_eq!(m["status"], "error");
        assert_eq!(m["imageFiles"], json!(["done.png"]));
        assert_eq!(m["steps"][0]["status"], "done");
        assert_eq!(m["steps"][1]["status"], "error");
        assert_eq!(m["steps"][2]["status"], "error");
        assert_eq!(m["steps"][2]["dispatchState"], "unknown");
        assert_eq!(m["steps"][2]["fingerprint"], json!(["paid"]));
        assert_eq!(m["steps"][2]["imageFiles"], json!(["partial.png"]));
        assert_eq!(
            store.get("sessions", "a").unwrap()["imageProviderId"],
            "images"
        );
        drop(store);
        std::fs::remove_file(file).unwrap();
    }
}

fn legacy_error(error: &str) -> &str {
    match error {
        "Provider 未返回图片" => "ui.providerReturnedNoImage",
        "已停止生成" => "ui.generationStopped",
        "Provider 名称不能为空" => "ui.providerNameIsRequired",
        "上次生成中断" => "ui.previousGenerationWasInterrupted",
        "请等待生成完成或停止生成后再更新" => "ui.waitForGenerationToFinishOrStopItBeforeUpdating",
        "请先检查模型能力表更新" => "ui.checkModelCapabilitiesUpdatesFirst",
        "请先配置可用模型" => "ui.configureASupportedModelFirst",
        "模型能力已变化或不可用，请重新选择模型" => "ui.modelCapabilityChangedOrIsUnavailableSelectAModelAgain",
        "用户取消了图片生成" => "ui.imageGenerationCancelledByUser",
        "请先配置图片模型" => "ui.configureAnImageModelFirst",
        "请先选择聊天模型" => "ui.selectAChatModelFirst",
        "任务超时，已停止" => "ui.taskTimedOutAndStopped",
        "Agent 未返回完整结果" => "ui.theAgentDidNotReturnACompleteResult",
        "每次任务最多生成 3 张图片" => "ui.eachTaskCanGenerateUpTo3Images",
        "图片提示词不能为空或超过 16000 字节" => "ui.imagePromptMustBeNonemptyAndNoLongerThan16000Bytes",
        "任务已结束或已确认" => "ui.taskFinishedOrAlreadyConfirmed",
        "任务已结束" => "ui.taskFinished",
        "任务已停止" => "ui.taskStopped",
        _ => error,
    }
}
