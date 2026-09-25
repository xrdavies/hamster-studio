use super::*;
use rig::agent::{CompletionCallAction, CompletionCallEvent};

pub(super) fn transient(error: &str) -> bool {
    let lower = error.to_lowercase();
    if ["quota", "balance", "billing", "insufficient", "余额", "content_filter"].iter().any(|s| lower.contains(s)) { return false; }
    matches!(crate::diagnostics::status_from_error(error), Some(408 | 429 | 500 | 502 | 503 | 504 | 520 | 521 | 522 | 524))
        || ["connection reset", "connection refused", "timed out", "timeout", "connection closed"].iter().any(|s| lower.contains(s))
}
pub(super) struct Checkpoint(pub Arc<Run>);
impl AgentHook for Checkpoint {
    async fn on_completion_call(&self, _: &HookContext, event: CompletionCallEvent<'_>) -> CompletionCallAction {
        if lock(&self.0.output).ok().is_some_and(|o| o["modelCalls"].as_u64().unwrap_or(0) >= 18) {
            return CompletionCallAction::Stop("Model call budget exhausted".into());
        }
        let result = self.0.update(|o| {
            o["modelCalls"] = json!(o["modelCalls"].as_u64().unwrap_or(0) + 1);
            o["canContinue"] = json!(true);
            o["checkpointHistory"] = json!(event.history);
            o["checkpointPrompt"] = json!(event.prompt);
            o["checkpointTextLength"] = json!(string(o,"content").len());
            o["retryAttempt"] = json!(0);
        });
        match result { Ok(()) => CompletionCallAction::Continue, Err(e) => CompletionCallAction::Stop(e) }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retries_only_transient_errors() {
        for error in ["status 520", "HTTP 429", "connection reset", "timed out"] { assert!(transient(error)); }
        for error in ["HTTP 401", "HTTP 400", "HTTP 429 insufficient quota", "HTTP 500 balance exhausted", "user cancelled"] { assert!(!transient(error)); }
    }
}
