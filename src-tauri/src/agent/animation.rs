use super::*;
use image::{GenericImageView, RgbaImage};

const MAX_FRAMES: usize = 24;
const MAX_PIXELS: u64 = 16_000_000;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SplitArgs {
    image_id: String,
    columns: u32,
    rows: u32,
    frame_count: u32,
    #[serde(default)]
    margin: u32,
    #[serde(default)]
    spacing: u32,
}
fn rectangles(width: u32, height: u32, args: &SplitArgs) -> Result<Vec<(u32, u32, u32, u32)>> {
    if args.columns == 0
        || args.rows == 0
        || args.columns > 24
        || args.rows > 24
        || args.frame_count == 0
        || args.frame_count > 24
        || args.frame_count > args.columns * args.rows
    {
        return Err("Use 1–24 frames and a valid grid".into());
    }
    let inner = |size: u32, cells: u32| -> Result<u32> {
        let padding = u64::from(args.margin) * 2 + u64::from(args.spacing) * u64::from(cells - 1);
        if padding >= u64::from(size) {
            return Err("Grid margins exceed image size".into());
        }
        let available = size - padding as u32;
        if available % cells != 0 {
            return Err(
                "Grid does not divide evenly; adjust rows, columns, margin or spacing".into(),
            );
        }
        Ok(available / cells)
    };
    let w = inner(width, args.columns)?;
    let h = inner(height, args.rows)?;
    if u64::from(w) * u64::from(h) * u64::from(args.frame_count) > MAX_PIXELS {
        return Err("Animation exceeds 16 million total pixels".into());
    }
    Ok((0..args.frame_count)
        .map(|i| {
            (
                args.margin + (i % args.columns) * (w + args.spacing),
                args.margin + (i / args.columns) * (h + args.spacing),
                w,
                h,
            )
        })
        .collect())
}
fn load(path: &std::path::Path) -> Result<image::DynamicImage> {
    let reader = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let (w, h) = image::image_dimensions(path).map_err(|e| e.to_string())?;
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err("Image exceeds 16 million pixels".into());
    }
    reader.decode().map_err(|e| e.to_string())
}
pub struct SplitSheet(pub Arc<Run>);
impl Tool for SplitSheet {
    const NAME: &'static str = "split_sprite_sheet";
    type Args = SplitArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Split a session image into 1–24 equal PNG frames, row-major (left to right, top to bottom). Specify exact grid, frame count, optional outer margin and cell spacing in pixels. Does not generate images or fix misalignment. Returns ordered frame image IDs.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"image_id":{"type":"string"},"columns":{"type":"integer","minimum":1,"maximum":24},"rows":{"type":"integer","minimum":1,"maximum":24},"frame_count":{"type":"integer","minimum":1,"maximum":24},"margin":{"type":"integer","minimum":0},"spacing":{"type":"integer","minimum":0}},"required":["image_id","columns","rows","frame_count"],"additionalProperties":false})
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        args: SplitArgs,
    ) -> std::result::Result<Value, Self::Error> {
        let run = self.0.clone();
        let result=tokio::task::spawn_blocking(move || -> Result<Value> {
            let state=run.app.state::<AppState>();
            let token=lock(&state.active)?.get(&run.session_id).cloned().ok_or("ui.taskStopped")?;
            if lock(&run.output)?["frameSets"].as_array().is_some_and(|items|items.len()>=3) {return Err("At most 3 frame sets per task".into());}
            if token.is_cancelled() {return Err("ui.taskStopped".into());}
            let file=assets::resolve_image(&run,&args.image_id)?;
            let source=load(&crate::image_path(&state,&file)?)?;
            let cells=rectangles(source.width(),source.height(),&args)?;
            let mut frames=Vec::new();
            let result=(|| -> Result<Value> {
                for (x,y,w,h) in cells {
                    if token.is_cancelled() {return Err("ui.taskStopped".into());}
                    let name=format!("{}.png",id());
                    frames.push(name.clone());
                    source.view(x,y,w,h).to_image().save(crate::image_path(&state,&name)?).map_err(|e|e.to_string())?;
                }
                let set=json!({"sourceImageId":file,"frameFiles":frames,"columns":args.columns,"rows":args.rows});
                if token.is_cancelled() {return Err("ui.taskStopped".into());}
                run.update(|o| { if !o["frameSets"].is_array() {o["frameSets"]=json!([]);} o["frameSets"].as_array_mut().unwrap().push(set.clone()); })?;
                Ok(set)
            })();
            if result.is_err() { for name in frames { let _=std::fs::remove_file(state.directory.join("images").join(name)); } }
            result
        }).await.map_err(std::io::Error::other)?;
        Ok(result.unwrap_or_else(|error| json!({"error":error,"recoverable":true})))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposeArgs {
    frame_ids: Vec<String>,
    fps: u32,
    #[serde(default = "loop_default")]
    looped: bool,
}
fn loop_default() -> bool {
    true
}
fn encode(frames: Vec<RgbaImage>, fps: u32, looped: bool) -> Result<Vec<u8>> {
    if frames.is_empty() || frames.len() > MAX_FRAMES || !(1..=30).contains(&fps) {
        return Err("Use 1–24 frames and 1–30 FPS".into());
    }
    let size = frames[0].dimensions();
    if frames.iter().any(|f| f.dimensions() != size)
        || u64::from(size.0) * u64::from(size.1) * frames.len() as u64 > MAX_PIXELS
    {
        return Err("Frames must share dimensions and total at most 16 million pixels".into());
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new_with_speed(&mut bytes, 10);
        if looped {
            encoder
                .set_repeat(image::codecs::gif::Repeat::Infinite)
                .map_err(|e| e.to_string())?;
        }
        for frame in frames {
            encoder
                .encode_frame(image::Frame::from_parts(
                    frame,
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(1000, fps),
                ))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(bytes)
}
pub struct ComposeAnimation(pub Arc<Run>);
impl Tool for ComposeAnimation {
    const NAME: &'static str = "compose_animation";
    type Args = ComposeArgs;
    type Output = Value;
    type Error = std::io::Error;
    fn description(&self) -> String {
        "Compose ordered session image IDs into a GIF, 1–24 equal-size frames, 1–30 FPS, optional looping (default true). Frames are not interpolated or automatically aligned. Returns animation and frame IDs for playback and export.".into()
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{"frame_ids":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":24},"fps":{"type":"integer","minimum":1,"maximum":30},"looped":{"type":"boolean"}},"required":["frame_ids","fps"],"additionalProperties":false})
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        args: ComposeArgs,
    ) -> std::result::Result<Value, Self::Error> {
        let run = self.0.clone();
        let result=tokio::task::spawn_blocking(move || -> Result<Value> {
            if args.frame_ids.is_empty() || args.frame_ids.len()>MAX_FRAMES || !(1..=30).contains(&args.fps) {return Err("Use 1–24 frames and 1–30 FPS".into());}
            let state=run.app.state::<AppState>();
            let token=lock(&state.active)?.get(&run.session_id).cloned().ok_or("ui.taskStopped")?;
            if lock(&run.output)?["animations"].as_array().is_some_and(|items|items.len()>=3) {return Err("At most 3 animations per task".into());}
            let mut frames=Vec::new();let mut files=Vec::new();let mut pixels=0;
            for reference in &args.frame_ids {
                if token.is_cancelled() {return Err("ui.taskStopped".into());}
                let file=assets::resolve_image(&run,reference)?;
                let frame=load(&crate::image_path(&state,&file)?)?;
                pixels+=u64::from(frame.width())*u64::from(frame.height());
                if pixels>MAX_PIXELS {return Err("Animation exceeds 16 million total pixels".into());}
                frames.push(frame.to_rgba8()); files.push(file);
            }
            let width=frames[0].width();let height=frames[0].height();
            let bytes=encode(frames,args.fps,args.looped)?;
            if token.is_cancelled() {return Err("ui.taskStopped".into());}
            let file=format!("{}.gif",id());let path=state.directory.join("images").join(&file);
            std::fs::write(&path,bytes).map_err(|e|e.to_string())?;
            let animation=json!({"file":file,"frameFiles":files,"fps":args.fps,"looped":args.looped,"width":width,"height":height});
            if let Err(error)=run.update(|o| {if !o["animations"].is_array(){o["animations"]=json!([]);}o["animations"].as_array_mut().unwrap().push(animation.clone());}) {let _=std::fs::remove_file(path);return Err(error);}
            Ok(animation)
        }).await.map_err(std::io::Error::other)?;
        Ok(result.unwrap_or_else(|error| json!({"error":error,"recoverable":true})))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use image::AnimationDecoder;
    #[test]
    fn grid_order_and_gif_roundtrip() {
        let args = SplitArgs {
            image_id: "sheet.png".into(),
            columns: 2,
            rows: 2,
            frame_count: 3,
            margin: 1,
            spacing: 1,
        };
        assert_eq!(
            rectangles(7, 7, &args).unwrap(),
            vec![(1, 1, 2, 2), (4, 1, 2, 2), (1, 4, 2, 2)]
        );
        assert!(rectangles(6, 7, &args).is_err());
        let frames = vec![
            RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255])),
            RgbaImage::from_pixel(2, 2, image::Rgba([0, 0, 255, 255])),
        ];
        let bytes = encode(frames, 10, true).unwrap();
        let decoded = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(bytes))
            .unwrap()
            .into_frames()
            .collect_frames()
            .unwrap();
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].buffer().get_pixel(0, 0)[0], 255);
        assert_eq!(decoded[1].buffer().get_pixel(0, 0)[2], 255);
        assert_eq!(decoded[0].delay().numer_denom_ms(), (100, 1));
        assert!(encode(vec![], 10, true).is_err());
        assert!(encode(vec![RgbaImage::new(1, 1), RgbaImage::new(2, 2)], 10, true).is_err());
    }
}

fn saved_animation(state: &AppState, message_id: &str, file: &str) -> Result<Value> {
    let message = lock(&state.store)?.get("messages", message_id)?;
    message["animations"]
        .as_array()
        .and_then(|items| items.iter().find(|a| a["file"] == file))
        .cloned()
        .ok_or("Animation does not belong to this message".into())
}
fn gif_path(state: &AppState, file: &str) -> Result<std::path::PathBuf> {
    if file.contains('/')
        || file.contains('\\')
        || !file.ends_with(".gif")
        || uuid::Uuid::parse_str(file.trim_end_matches(".gif")).is_err()
    {
        return Err("Invalid animation file".into());
    }
    Ok(state.directory.join("images").join(file))
}
#[tauri::command]
pub async fn export_animation(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    file: String,
    frames: bool,
) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;
    let animation = saved_animation(&state, &message_id, &file)?;
    let source = gif_path(&state, &file)?;
    let name = crate::image_export::filename(&state, &file, &source)?;
    let name = if frames {
        format!("{}-frames.zip", name.trim_end_matches(".gif"))
    } else {
        name
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(name)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    if !frames {
        crate::image_export::copy_unique(&source, &path)?;
        return Ok(true);
    }
    let message = lock(&state.store)?.get("messages", &message_id)?;
    let temporary = state.directory.join(format!("{}.zip", id()));
    let result = (|| -> Result<()> {
        let mut zip =
            zip::ZipWriter::new(std::fs::File::create(&temporary).map_err(|e| e.to_string())?);
        for (index, frame) in animation["frameFiles"]
            .as_array()
            .ok_or("Invalid animation frames")?
            .iter()
            .enumerate()
        {
            let frame = frame.as_str().ok_or("Invalid frame")?;
            if !lock(&state.store)?.owns_image(string(&message, "sessionId"), frame)? {
                return Err("Frame does not belong to session".into());
            }
            zip.start_file(
                format!("frame-{:03}.png", index + 1),
                zip::write::SimpleFileOptions::default(),
            )
            .map_err(|e| e.to_string())?;
            let image = load(&crate::image_path(&state, frame)?)?;
            let mut bytes = std::io::Cursor::new(Vec::new());
            image
                .write_to(&mut bytes, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            use std::io::Write;
            zip.write_all(bytes.get_ref()).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        crate::image_export::copy_unique(&temporary, &path)?;
        Ok(())
    })();
    let _ = std::fs::remove_file(temporary);
    result?;
    Ok(true)
}
