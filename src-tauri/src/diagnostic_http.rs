// Logs the actual model HTTP exchange; retry decisions remain in the agent loop.
use bytes::Bytes;
use futures_util::StreamExt;
use rig::http_client::*;
use rig::wasm_compat::WasmCompatSend;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, Default)]
pub struct LoggedClient {
    pub client: ReqwestClient,
    pub budget: Arc<Mutex<crate::agent::retry::Budget>>,
    pub context: Value,
    pub retry_after: Arc<Mutex<Option<u64>>>,
}
fn headers(map: &HeaderMap) -> Value {
    Value::Object(
        map.iter()
            .map(|(k, v)| (k.to_string(), json!(v.to_str().unwrap_or("[binary]"))))
            .collect(),
    )
}
// One bounded record per response, including partial data when the stream is dropped.
struct StreamLog {
    context: Value,
    started: std::time::Instant,
    bytes: Vec<u8>,
    complete: bool,
    error: Option<String>,
    truncated: bool,
}
impl StreamLog {
    fn append(&mut self, bytes: &[u8]) {
        let remaining = (10 * 1024 * 1024usize).saturating_sub(self.bytes.len());
        self.bytes
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        self.truncated |= bytes.len() > remaining;
    }
    fn metadata(&self) -> Value {
        let raw = String::from_utf8_lossy(&self.bytes);
        let mut content = String::new();
        let events: Vec<Value> = raw
            .lines()
            .filter_map(|line| {
                let payload = line.strip_prefix("data:")?.trim();
                if payload.is_empty() {
                    return None;
                }
                let event =
                    serde_json::from_str::<Value>(payload).unwrap_or_else(|_| json!(payload));
                if let Some(text) = event["choices"][0]["delta"]["content"].as_str() {
                    content.push_str(text);
                }
                Some(event)
            })
            .collect();
        json!({"context":self.context,"elapsedMs":self.started.elapsed().as_millis(),"content":content,"events":events,"error":self.error,"complete":self.complete,"truncated":self.truncated})
    }
}
impl Drop for StreamLog {
    fn drop(&mut self) {
        if self.error.is_none()
            && String::from_utf8_lossy(&self.bytes)
                .lines()
                .any(|line| line.trim() == "data: [DONE]")
        {
            self.complete = true;
        }
        crate::diagnostics::write(
            if self.error.is_some() || !self.complete {
                "http.stream.error"
            } else {
                "http.stream.finished"
            },
            self.metadata(),
        );
    }
}
impl HttpClientExt for LoggedClient {
    fn send<T, U>(
        &self,
        req: Request<T>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + WasmCompatSend,
        U: From<Bytes> + WasmCompatSend + 'static,
    {
        self.client.send(req)
    }
    fn send_multipart<U>(
        &self,
        req: Request<MultipartForm>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + WasmCompatSend + 'static,
    {
        self.client.send_multipart(req)
    }
    async fn send_streaming<T>(&self, req: Request<T>) -> Result<StreamingResponse>
    where
        T: Into<Bytes> + WasmCompatSend,
    {
        *self.retry_after.lock().unwrap() = None;
        let deadline = self.budget.lock().unwrap().deadline();
        let request_id = crate::store::id();
        let (parts, body) = req.into_parts();
        let body: Bytes = body.into();
        let mut context = self.context.clone();
        context["requestId"] = json!(request_id);
        context["retryAttempt"] = json!(self.budget.lock().unwrap().attempt());
        crate::diagnostics::write(
            "http.request",
            json!({"context":context,"method":parts.method.as_str(),"url":parts.uri.to_string(),"headers":headers(&parts.headers),"body":serde_json::from_slice::<Value>(&body).unwrap_or_else(|_|json!(String::from_utf8_lossy(&body)))}),
        );
        let request = Request::from_parts(parts, body);
        let started = std::time::Instant::now();
        let response = tokio::time::timeout_at(deadline, self.client.send_streaming(request))
            .await
            .unwrap_or_else(|_| {
                Err(Error::Instance(Box::new(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "request timed out",
                ))))
            });
        match response {
            Err(error) => {
                if let Some(h) = error.non_success_headers() {
                    *self.retry_after.lock().unwrap() = h
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse().ok());
                }
                crate::diagnostics::write(
                    "http.error",
                    json!({"context":context,"error":error.to_string(),"headers":error.non_success_headers().map(headers),"elapsedMs":started.elapsed().as_millis()}),
                );
                Err(error)
            }
            Ok(response) => {
                crate::diagnostics::write(
                    "http.response",
                    json!({"context":context,"status":response.status().as_u16(),"headers":headers(response.headers())}),
                );
                let (parts, stream) = response.into_parts();
                let log = StreamLog {
                    context,
                    started,
                    bytes: Vec::new(),
                    complete: false,
                    error: None,
                    truncated: false,
                };
                let stream = futures_util::stream::unfold(
                    (stream, log),
                    move |(mut stream, mut log)| async move {
                        if log.error.is_some() {
                            return None;
                        }
                        let next = tokio::time::timeout_at(deadline, stream.next()).await;
                        match next {
                            Ok(Some(Ok(bytes))) => {
                                log.append(&bytes);
                                Some((Ok(bytes), (stream, log)))
                            }
                            Ok(None) => {
                                log.complete = true;
                                drop(log);
                                None
                            }
                            result => {
                                let error = match result {
                                    Ok(Some(Err(error))) => error,
                                    _ => Error::Instance(Box::new(std::io::Error::new(
                                        std::io::ErrorKind::TimedOut,
                                        "response stream timed out",
                                    ))),
                                };
                                log.error = Some(error.to_string());
                                Some((Err(error), (stream, log)))
                            }
                        }
                    },
                );
                Ok(Response::from_parts(
                    parts,
                    Box::pin(stream) as rig::http_client::sse::BoxedStream,
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aggregates_split_utf8_and_keeps_partial_errors() {
        let mut log = StreamLog {
            context: json!({"requestId":"r"}),
            started: std::time::Instant::now(),
            bytes: vec![],
            complete: false,
            error: None,
            truncated: false,
        };
        let wire = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n";
        for byte in wire.as_bytes() {
            log.append(&[*byte]);
        }
        assert_eq!(log.metadata()["content"], "你好");
        assert_eq!(log.metadata()["events"].as_array().unwrap().len(), 2);
        log.error = Some("connection reset".into());
        assert_eq!(log.metadata()["error"], "connection reset");
        assert_eq!(log.metadata()["complete"], false);
    }
    #[tokio::test]
    async fn streaming_transport_preserves_retry_after_and_response() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for attempt in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 4096];
                assert!(socket.read(&mut request).unwrap() > 0);
                let (status, content_type, body) = if attempt == 0 {
                    (
                        "429 Too Many Requests",
                        "application/json",
                        "{\"error\":\"busy\"}",
                    )
                } else {
                    (
                        "200 OK",
                        "text/event-stream",
                        "data: {\"text\":\"你好\"}\n\ndata: [DONE]\n\n",
                    )
                };
                write!(socket,"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nRetry-After: 3\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        let client = LoggedClient {
            context: json!({}),
            ..Default::default()
        };
        let request = || {
            Request::builder()
                .uri(format!("http://{address}"))
                .body(Bytes::new())
                .unwrap()
        };
        let error = match client.send_streaming(request()).await {
            Err(e) => e,
            Ok(_) => panic!("expected 429"),
        };
        assert!(crate::agent::retry::transient(&error.to_string()));
        assert_eq!(*client.retry_after.lock().unwrap(), Some(3));
        let mut response = client.send_streaming(request()).await.unwrap().into_body();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.next().await {
            bytes.extend_from_slice(&chunk.unwrap());
        }
        assert!(String::from_utf8(bytes).unwrap().contains("你好"));
        assert_eq!(*client.retry_after.lock().unwrap(), None);
        server.join().unwrap();
    }
}
