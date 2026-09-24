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
fn emit(app: &tauri::AppHandle, s: &AppState, message: &Value) -> Result<()> {
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
) -> Result<Value> {
    if !["chat", "image"].contains(&kind.as_str()) || text.trim().is_empty() {
        return Err("Invalid request".into());
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
                let response=s.client.post(url(string(&provider,"baseUrl"),"/images/generations")?).bearer_auth(&secret).json(&json!({"model":model,"prompt":text.trim(),"n":1,"response_format":"b64_json"})).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
                let result:Value=response.json().await.map_err(|e|e.to_string())?;
                let image=&result["data"][0];
                let bytes=if let Some(encoded)=image["b64_json"].as_str() {base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e|e.to_string())?}
                    else if let Some(address)=image["url"].as_str() {
                        let parsed=reqwest::Url::parse(address).map_err(|e|e.to_string())?;
                        if !["https","http"].contains(&parsed.scheme()) {return Err("Invalid image URL".into())}
                        s.client.get(parsed).send().await.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?.bytes().await.map_err(|e|e.to_string())?.to_vec()
                    } else {return Err("Provider 未返回图片".into())};
                let name=format!("{}.png",id()); std::fs::write(s.directory.join("images").join(&name),bytes).map_err(|e|e.to_string())?;
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
}
