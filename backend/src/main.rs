mod config;
mod error;
mod exports;
mod models;
mod repository;
mod routes;

use axum::{routing::{get, post}, Router};
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry().with(tracing_subscriber::EnvFilter::from_default_env()).with(tracing_subscriber::fmt::layer()).init();
    let config = Arc::new(config::Config::from_env());
    tokio::fs::create_dir_all(&config.export_root).await?;
    let frontend_index = config.frontend_root.join("index.html");
    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/api/summary", get(routes::summary))
        .route("/api/chapters", get(routes::chapters))
        .route("/api/items", get(routes::items))
        .route("/api/items/{stable_id}", get(routes::item))
        .route("/api/items/batch", post(routes::batch))
        .route("/api/exports/flagged-audio", post(routes::flagged_export))
        .nest_service("/media", ServeDir::new(config.media_root.clone()))
        .nest_service("/exports", ServeDir::new(config.export_root.clone()))
        .fallback_service(ServeDir::new(config.frontend_root.clone()).fallback(ServeFile::new(frontend_index)))
        .with_state(routes::AppState { config: config.clone() });
    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!(bind = %config.bind, "IELTS vocabulary service listening");
    axum::serve(listener, app).await?;
    Ok(())
}
