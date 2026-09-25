use crate::{
    data, lock, password,
    store::{id, now, string, Result},
    AppState,
};
use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{Emitter, State};
pub fn url(base: &str, path: &str) -> Result<String> {
    let base = base.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(base).map_err(|e| e.to_string())?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Invalid provider URL".into());
    }
    Ok(format!(
        "{}{}{}",
        base,
        if base.ends_with("/v1") { "" } else { "/v1" },
        path
    ))
}
pub(crate) fn emit(app: &tauri::AppHandle, s: &AppState, message: &Value) -> Result<()> {
    if lock(&s.store)?.message(message)? {
        app.emit("message", message).map_err(|e| e.to_string())?
    }
    Ok(())
}
fn delta(line: &[u8]) -> Result<Option<String>> {
    let line = std::str::from_utf8(line).map_err(|e| e.to_string())?.trim();
    let Some(payload) = line.strip_prefix("data:").map(str::trim) else {
        return Ok(None);
    };
    if payload == "[DONE]" || payload.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
    if !value["error"].is_null() {
        return Err(value["error"].to_string());
    }
    Ok(value["choices"][0]["delta"]["content"]
        .as_str()
        .map(str::to_owned))
}
#[tauri::command]
pub async fn generate(
    app: tauri::AppHandle,
    s: State<'_, AppState>,
    session_id: String,
    text: String,
    kind: String,
    reference_file: Option<String>,
) -> Result<Value> {
    if !["chat", "image"].contains(&kind.as_str()) || text.trim().is_empty() {
        return Err("Invalid request".into());
    }
    if kind == "chat" {
        return crate::agent::generate(app, s, session_id, text, reference_file).await;
    }
    let token = tokio_util::sync::CancellationToken::new();
    {
        let mut active = lock(&s.active)?;
        if active.contains_key(&session_id) {
            return Err("Session already has an active request".into());
        }
        active.insert(session_id.clone(), token.clone());
    }
    let mut assistant: Option<Value> = None;
    let result = tokio::select! {
        _=token.cancelled()=>Err("已停止生成".to_owned()),
        result=async {
            let session=lock(&s.store)?.get("sessions",&session_id)?;
            let mut provider=lock(&s.store)?.get("providers",string(&session,"providerId"))?;
            lock(&s.catalog)?.provider(&mut provider);
            let model=string(&session,if kind=="image" {"imageModel"} else {"chatModel"});
            let models=&provider[if kind=="image" {"imageModels"} else {"chatModels"}];
            if !models.as_array().map(|v|v.contains(&json!(model))).unwrap_or(false) {return Err("模型能力已变化或不可用，请重新选择模型".into())}
            let secret=password(string(&provider,"id"))?;
            let mut history=lock(&s.store)?.history(&session_id)?;
            let user=json!({"id":id(),"sessionId":session_id,"role":"user","kind":kind,"content":text.trim(),"imageFiles":[],"providerName":provider["name"],"model":model,"createdAt":now(),"status":"done","error":""});
            emit(&app,&s,&user)?;
            assistant=Some(json!({"id":id(),"sessionId":session_id,"role":"assistant","kind":kind,"content":"","imageFiles":[],"providerName":provider["name"],"model":model,"createdAt":now(),"status":"streaming","error":""}));
            let output=assistant.as_mut().unwrap(); emit(&app,&s,output)?;
            if kind=="image" {
                let name = create_image(&s, &provider, model, &secret, text.trim(), None).await?;
                output["imageFiles"]=json!([name]);
            } else {
                if !string(&session,"systemPrompt").is_empty() {history.insert(0,json!({"role":"system","content":session["systemPrompt"]}));}
                history.push(json!({"role":"user","content":text.trim()}));
                let response=s.client.post(url(string(&provider,"baseUrl"),"/chat/completions")?).bearer_auth(&secret).json(&json!({"model":model,"stream":true,"messages":history})).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
                let mut stream=response.bytes_stream(); let mut buffer=Vec::new(); let mut content=String::new();
                while let Some(chunk)=stream.next().await {
                    buffer.extend_from_slice(&chunk.map_err(|e|e.to_string())?);
                    while let Some(end)=buffer.iter().position(|b|*b==b'\n') {
                        let line:Vec<_>=buffer.drain(..=end).collect();
                        if let Some(part)=delta(&line)? {content.push_str(&part); output["content"]=json!(content); emit(&app,&s,output)?;}
                    }
                    if buffer.len()>1024*1024 {return Err("SSE frame too large".into())}
                }
                if !buffer.is_empty() {if let Some(part)=delta(&buffer)? {content.push_str(&part);output["content"]=json!(content);}}
            }
            output["status"]=json!("done"); emit(&app,&s,output)?; Ok(())
        }=>result
    };
    lock(&s.active)?.remove(&session_id);
    if let Err(error) = result {
        if let Some(mut output) = assistant {
            output["status"] = json!("error");
            output["error"] = json!(error);
            emit(&app, &s, &output)?;
        }
        return Err(error);
    }
    data(&s)
}

/// Both direct generation and Agent tools use the same image transport.
pub(crate) async fn create_image(
    s: &AppState,
    provider: &Value,
    model: &str,
    secret: &str,
    prompt: &str,
    reference: Option<&str>,
) -> Result<String> {
    let request = if let Some(file) = reference {
        let bytes = std::fs::read(crate::image_path(s, file)?).map_err(|e| e.to_string())?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("reference.png")
            .mime_str("image/png")
            .map_err(|e| e.to_string())?;
        s.client
            .post(url(string(provider, "baseUrl"), "/images/edits")?)
            .multipart(
                reqwest::multipart::Form::new()
                    .text("model", model.to_owned())
                    .text("prompt", prompt.to_owned())
                    .text("n", "1")
                    .text("response_format", "b64_json")
                    .part("image", part),
            )
    } else {
        s.client
            .post(url(string(provider, "baseUrl"), "/images/generations")?)
            .json(&json!({"model":model,"prompt":prompt,"n":1,"response_format":"b64_json"}))
    };
    let response = request
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {}: {}",
            status.as_u16(),
            body.chars().take(1500).collect::<String>()
        ));
    }
    let result: Value = response.json().await.map_err(|e| e.to_string())?;
    let image = &result["data"][0];
    let bytes = if let Some(encoded) = image["b64_json"].as_str() {
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| e.to_string())?
    } else if let Some(address) = image["url"].as_str() {
        let parsed = reqwest::Url::parse(address).map_err(|e| e.to_string())?;
        if !["https", "http"].contains(&parsed.scheme()) {
            return Err("Invalid image URL".into());
        }
        s.client
            .get(parsed)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?
            .to_vec()
    } else {
        return Err("Provider 未返回图片".into());
    };
    if bytes.is_empty() {
        return Err("Provider 未返回图片".into());
    }
    let name = format!("{}.png", id());
    std::fs::write(s.directory.join("images").join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_and_sse() {
        assert_eq!(
            url("https://example.com/v1/", "/models").unwrap(),
            "https://example.com/v1/models"
        );
        assert!(url("file:///tmp", "/models").is_err());
        assert_eq!(
            delta("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\r\n".as_bytes())
                .unwrap(),
            Some("你好".into())
        );
        assert_eq!(delta(b"data: [DONE]").unwrap(), None);
    }
    #[tokio::test]
    async fn image_transport_generates_edits_and_surfaces_errors() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0; 4096];
                loop {
                    let n = socket.read(&mut buf).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let len: usize = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= end + 4 + len {
                            break;
                        }
                    }
                }
                let request = String::from_utf8_lossy(&bytes);
                assert!(request
                    .to_lowercase()
                    .contains("authorization: bearer test-key"));
                if index == 1 {
                    assert!(request.starts_with("POST /v1/images/edits"));
                    assert!(request.contains("reference.png"));
                } else {
                    assert!(request.starts_with("POST /v1/images/generations"));
                    assert!(request.contains("b64_json"));
                }
                let (status, body) = if index == 2 {
                    (
                        "400 Bad Request",
                        r#"{"error":{"message":"unsupported model"}}"#,
                    )
                } else {
                    ("200 OK", r#"{"data":[{"b64_json":"aW1hZ2U="}]}"#)
                };
                write!(socket,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        let directory = std::env::temp_dir().join(id());
        std::fs::create_dir_all(directory.join("images")).unwrap();
        let state = AppState {
            store: std::sync::Mutex::new(
                crate::Store::open(std::path::Path::new(":memory:")).unwrap(),
            ),
            catalog: std::sync::Mutex::new(crate::Catalog::bundled()),
            candidate: std::sync::Mutex::new(None),
            active: std::sync::Mutex::new(Default::default()),
            approvals: std::sync::Mutex::new(Default::default()),
            directory: directory.clone(),
            client: reqwest::Client::new(),
        };
        let provider = json!({"baseUrl":format!("http://{address}")});
        let first = create_image(&state, &provider, "image-model", "test-key", "draw", None)
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(crate::image_path(&state, &first).unwrap()).unwrap(),
            b"image"
        );
        let second = create_image(
            &state,
            &provider,
            "image-model",
            "test-key",
            "edit",
            Some(&first),
        )
        .await
        .unwrap();
        assert_ne!(first, second);
        assert!(
            create_image(&state, &provider, "image-model", "test-key", "draw", None)
                .await
                .unwrap_err()
                .contains("unsupported model")
        );
        server.join().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
