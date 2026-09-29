use super::*;
use rig::agent::{CompletionCallAction, CompletionCallEvent};
use std::time::Duration;

pub(crate) const DELAYS: [u64; 5] = [2, 5, 10, 20, 30];
#[derive(Debug, Default)]
pub(crate) struct Budget {
    attempt: usize,
    deadline: Option<tokio::time::Instant>,
}
impl Budget {
    pub fn attempt(&self) -> usize {
        self.attempt
    }
    pub fn new() -> Self {
        Self {
            attempt: 0,
            deadline: None,
        }
    }
    pub fn deadline(&self) -> tokio::time::Instant {
        self.deadline
            .unwrap_or_else(|| tokio::time::Instant::now() + Duration::from_secs(600))
    }
    pub fn next(&mut self, error: &str, retry_after: Option<u64>) -> Option<(usize, Duration)> {
        if !transient(error) || self.attempt >= DELAYS.len() {
            return None;
        }
        let deadline = *self
            .deadline
            .get_or_insert_with(|| tokio::time::Instant::now() + Duration::from_secs(600));
        let delay = Duration::from_millis(
            retry_after
                .unwrap_or(DELAYS[self.attempt])
                .saturating_mul(1000)
                .saturating_add(now() % 400),
        );
        if delay >= deadline.saturating_duration_since(tokio::time::Instant::now()) {
            return None;
        }
        self.attempt += 1;
        Some((self.attempt, delay))
    }
}
pub(crate) fn transient(error: &str) -> bool {
    let lower = error.to_lowercase();
    if [
        "quota",
        "balance",
        "billing",
        "insufficient",
        "余额",
        "content_filter",
        "certificate",
        "cancelled",
        "invalid api key",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        return false;
    }
    if let Some(status) = crate::diagnostics::status_from_error(error) {
        return matches!(
            status,
            408 | 429 | 500 | 502 | 503 | 504 | 520 | 521 | 522 | 524
        );
    }
    [
        "connection reset",
        "connection refused",
        "timed out",
        "timeout",
        "connection closed",
        "connection error",
        "dns error",
        "dns lookup",
        "error sending request",
        "error decoding response body",
        "stream ended",
        "incomplete model response",
        "unexpected eof",
        "network is unreachable",
        "agent.imagetimeout",
    ]
    .iter()
    .any(|s| lower.contains(s))
}
pub(super) fn continuation(checkpoint: &Value) -> Result<(Vec<Message>, Message)> {
    let mut prior: Vec<Message> = serde_json::from_value(checkpoint["checkpointHistory"].clone())
        .map_err(|e| e.to_string())?;
    let mut prompt: Message = serde_json::from_value(checkpoint["checkpointPrompt"].clone())
        .map_err(|e| e.to_string())?;
    let offset = checkpoint["checkpointTextLength"].as_u64().unwrap_or(0) as usize;
    if let Some(partial) = string(checkpoint, "content")
        .get(offset..)
        .filter(|s| !s.is_empty())
    {
        prior.push(prompt);
        prior.push(Message::assistant(partial));
        prompt = Message::user("Continue the interrupted reply from the existing text. Do not repeat existing text or completed tools.");
    }
    Ok((prior, prompt))
}
pub(super) struct Checkpoint(pub Arc<Run>);
impl AgentHook for Checkpoint {
    async fn on_completion_call(
        &self,
        _: &HookContext,
        event: CompletionCallEvent<'_>,
    ) -> CompletionCallAction {
        let result = self.0.update(|o| {
            // Only the first call of an automatic retry inherits its retry budget.
            if o["retryPending"] != true {
                *self.0.retry_budget.lock().unwrap() = Budget::new();
                o["retryAttempt"] = json!(0);
                o["modelCalls"] = json!(o["modelCalls"].as_u64().unwrap_or(0) + 1);
            }
            o["retryPending"] = json!(false);
            o["canContinue"] = json!(true);
            o["checkpointHistory"] = json!(event.history);
            o["checkpointPrompt"] = json!(event.prompt);
            o["checkpointTextLength"] = json!(string(o, "content").len());
        });
        if lock(&self.0.output)
            .ok()
            .is_some_and(|o| o["modelCalls"].as_u64().unwrap_or(0) > 18)
        {
            return CompletionCallAction::Stop("Model call budget exhausted".into());
        }
        match result {
            Ok(()) => CompletionCallAction::Continue,
            Err(e) => CompletionCallAction::Stop(e),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retries_only_transient_errors_and_enforces_limits() {
        for error in [
            "status 520",
            "HTTP 429",
            "connection reset",
            "timed out",
            "error sending request",
            "dns error",
        ] {
            assert!(transient(error));
        }
        for error in [
            "HTTP 401 timeout",
            "HTTP 400",
            "HTTP 429 insufficient quota",
            "HTTP 500 balance exhausted",
            "user cancelled",
            "certificate error",
        ] {
            assert!(!transient(error));
        }
        let mut budget = Budget::new();
        for attempt in 1..=5 {
            assert_eq!(budget.next("timeout", None).unwrap().0, attempt);
        }
        assert!(budget.next("timeout", None).is_none());
        let mut budget = Budget::new();
        assert!(budget.next("HTTP 429", Some(601)).is_none());
        assert!(budget.next("HTTP 429", Some(u64::MAX)).is_none());
        budget.deadline = Some(tokio::time::Instant::now());
        assert!(budget.next("timeout", None).is_none());
    }
    #[test]
    fn partial_reply_is_included_in_continuation_context() {
        let value = json!({"checkpointHistory":[Message::user("earlier")],"checkpointPrompt":Message::user("draw"),"checkpointTextLength":0,"content":"已经完成第一步"});
        let (history, prompt) = continuation(&value).unwrap();
        assert_eq!(history.len(), 3);
        assert!(serde_json::to_string(&history)
            .unwrap()
            .contains("已经完成第一步"));
        assert!(serde_json::to_string(&prompt).unwrap().contains("Continue"));
    }
}
