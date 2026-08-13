use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub db_path: PathBuf,
    pub media_root: PathBuf,
    pub frontend_root: PathBuf,
    pub export_root: PathBuf,
}

impl Config {
    pub fn from_env() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("backend has a project parent")
            .to_path_buf();
        Self {
            bind: env::var("IELTS_VOCAB_BIND").unwrap_or_else(|_| "127.0.0.1:8770".into()),
            db_path: env_path("IELTS_VOCAB_CONTENT_DB", root.join("var/content/content.sqlite")),
            media_root: env_path("IELTS_VOCAB_MEDIA_ROOT", root.join("var/content/media")),
            frontend_root: env_path("IELTS_VOCAB_FRONTEND_ROOT", root.join("frontend/dist")),
            export_root: env_path("IELTS_VOCAB_EXPORT_ROOT", root.join("var/content/exports")),
        }
    }
}

fn env_path(key: &str, default: PathBuf) -> PathBuf {
    env::var_os(key).map(PathBuf::from).unwrap_or(default)
}
