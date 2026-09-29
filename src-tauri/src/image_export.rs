use crate::{
    lock,
    store::{string, Result},
    AppState,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub fn filename(state: &AppState, file: &str, source: &Path) -> Result<String> {
    let store = lock(&state.store)?;
    let row = store.image_rows()?.into_iter().find(|row| {
        row["imageFiles"]
            .as_array()
            .is_some_and(|files| files.iter().any(|item| item == file))
            || row["animations"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["file"] == file))
    });
    let session = row
        .as_ref()
        .map(|row| store.get("sessions", string(row, "sessionId")))
        .transpose()?;
    let timestamp = fs::metadata(source)
        .and_then(|m| m.created())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as i64)
        .or_else(|| row.as_ref().and_then(|row| row["createdAt"].as_i64()))
        .unwrap_or(0);
    let date = chrono::DateTime::from_timestamp_millis(timestamp)
        .ok_or("Invalid image creation time")?
        .with_timezone(&chrono::Local)
        .format("%Y%m%d-%H%M%S")
        .to_string();
    Ok(name(
        session.as_ref().map(|s| string(s, "title")).unwrap_or(""),
        &date,
        file,
    ))
}
fn name(title: &str, date: &str, file: &str) -> String {
    let title: String = title
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(40)
        .collect();
    let title = title.trim().trim_matches('.').trim();
    let title = if title.is_empty()
        || matches!(title, "新对话" | "New conversation" | "New Conversation")
    {
        "hamster-image"
    } else {
        title
    };
    let path = Path::new(file);
    let short: String = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .take(8)
        .collect();
    let extension = path.extension().unwrap_or_default().to_string_lossy();
    format!("{title}-{date}-{short}.{extension}")
}
// Atomically reserve the destination so concurrent exports never overwrite each other.
pub fn copy_unique(source: &Path, target: &Path) -> Result<PathBuf> {
    let mut number = 1;
    loop {
        let path = if number == 1 {
            target.to_owned()
        } else {
            let stem = target.file_stem().unwrap_or_default().to_string_lossy();
            let extension = target
                .extension()
                .map(|s| format!(".{}", s.to_string_lossy()))
                .unwrap_or_default();
            target.with_file_name(format!("{stem}-{number}{extension}"))
        };
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut destination) => {
                let result = fs::File::open(source)
                    .and_then(|mut input| std::io::copy(&mut input, &mut destination));
                if let Err(error) = result {
                    drop(destination);
                    let _ = fs::remove_file(&path);
                    return Err(error.to_string());
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => number += 1,
            Err(error) => return Err(error.to_string()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_readable_and_exports_never_overwrite() {
        assert_eq!(
            name("角色/设定:*", "20260930-143052", "a8f3c201-abcd.png"),
            "角色设定-20260930-143052-a8f3c201.png"
        );
        assert_eq!(
            name("新对话", "20260930-143052", "a8f3c201-abcd.webp"),
            "hamster-image-20260930-143052-a8f3c201.webp"
        );
        assert!(name(&"汉".repeat(100), "20260930-143052", "a8f3c201.png").len() < 200);
        let dir = std::env::temp_dir().join(crate::store::id());
        fs::create_dir(&dir).unwrap();
        let source = dir.join("source.png");
        fs::write(&source, b"image").unwrap();
        let target = dir.join("export.png");
        fs::write(&target, b"original").unwrap();
        assert_eq!(
            copy_unique(&source, &target).unwrap(),
            dir.join("export-2.png")
        );
        assert_eq!(
            copy_unique(&source, &target).unwrap(),
            dir.join("export-3.png")
        );
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert_eq!(fs::read(dir.join("export-2.png")).unwrap(), b"image");
        assert!(copy_unique(&dir.join("missing.png"), &dir.join("failed.png")).is_err());
        assert!(!dir.join("failed.png").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
