use crate::{config::Config, error::AppError, models::ExportResponse, repository};
use std::{fs, path::{Path, PathBuf}, process::Command};
use tempfile::NamedTempFile;

pub fn create(config: &Config, chapter: i64, ids: &[String]) -> Result<ExportResponse, AppError> {
    let connection = repository::open(config)?;
    let media = repository::export_items(&connection, chapter, ids)?;
    fs::create_dir_all(&config.export_root)?;
    let stamp = timestamp();
    let file_name = format!("flagged-chapter{chapter:02}-{stamp}.mp3");
    let output = config.export_root.join(&file_name);
    let silence_one = create_silence(&config.export_root, &format!(".silence-1-{stamp}.mp3"), 1)?;
    let silence_two = create_silence(&config.export_root, &format!(".silence-2-{stamp}.mp3"), 2)?;
    let list = NamedTempFile::new_in(&config.export_root)?;
    let mut contents = String::new();
    for (index, (word, sentence)) in media.iter().enumerate() {
        add_concat_line(&mut contents, &config.media_root.join(word));
        add_concat_line(&mut contents, &silence_one);
        add_concat_line(&mut contents, &config.media_root.join(sentence));
        if index + 1 != media.len() { add_concat_line(&mut contents, &silence_two); }
    }
    std::fs::write(list.path(), contents)?;
    let status = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"])
        .arg(list.path())
        .args(["-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "3"])
        .arg(&output)
        .status()?;
    let _ = fs::remove_file(&silence_one);
    let _ = fs::remove_file(&silence_two);
    if !status.success() { return Err(AppError::Internal(anyhow::anyhow!("ffmpeg failed to create flagged export"))); }
    Ok(ExportResponse { ok: true, chapter, item_count: ids.len(), audio_url: format!("/exports/{file_name}"), file_name })
}

fn add_concat_line(contents: &mut String, path: &Path) {
    let escaped = path.to_string_lossy().replace('\'', "'\\''");
    contents.push_str("file '");
    contents.push_str(&escaped);
    contents.push_str("'\n");
}

fn create_silence(root: &Path, name: &str, seconds: i64) -> Result<PathBuf, AppError> {
    let target = root.join(name);
    let status = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t"])
        .arg(seconds.to_string())
        .args(["-c:a", "libmp3lame", "-q:a", "3"])
        .arg(&target)
        .status()?;
    if !status.success() { return Err(AppError::Internal(anyhow::anyhow!("ffmpeg failed to create silence"))); }
    Ok(target)
}

fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}
