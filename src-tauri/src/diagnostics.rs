use serde_json::{json, Value};
use tauri::Emitter;

/// Only explicitly selected metadata belongs here, never request/response bodies.
pub fn record(app: &tauri::AppHandle, stage: &str, metadata: Value) {
    let entry = json!({"timestamp":crate::store::now(),"stage":stage,"metadata":metadata});
    eprintln!("[Hamster Studio] {entry}");
    let _ = app.emit("diagnostic", entry);
}

pub fn status_from_error(error: &str) -> Option<u16> {
    ["status ", "HTTP "].iter().find_map(|prefix| {
        let suffix = error.split_once(prefix)?.1;
        let code: u16 = suffix.get(..3)?.parse().ok()?;
        (400..600).contains(&code).then_some(code)
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_only_http_status_from_untrusted_error() {
        assert_eq!(status_from_error("ProviderResponseError: status 520 <unknown>: secret"), Some(520));
        assert_eq!(status_from_error("HTTP 401: private response"), Some(401));
        assert_eq!(status_from_error("private prompt"), None);
    }
}
