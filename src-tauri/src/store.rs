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
            CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id);").map_err(|e| e.to_string())?;
        let store = Self { db };
        for mut message in store.rows("messages")? {
            if message["status"] == "streaming" {
                message["status"] = json!("error");
                message["error"] = json!("上次生成中断");
                store.message(&message)?;
            }
        }
        Ok(store)
    }
    fn rows(&self, table: &str) -> Result<Vec<Value>> {
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
        if !["chat", "image"].contains(&string(&value, "modelKind")) {
            return Err("Invalid model kind".into());
        }
        if string(&value, "chatModel").is_empty() && string(&value, "imageModel").is_empty() {
            return Err("请先配置可用模型".into());
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
        store.delete("providers", "p").unwrap();
        assert!(store.get("sessions", "a").is_ok());
        store.delete("sessions", "a").unwrap();
        assert!(!store
            .message(&json!({"id":"late","sessionId":"a"}))
            .unwrap());
    }
}
