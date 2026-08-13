use crate::{config::Config, error::AppError, exports, models::{BatchRequest, ExportRequest, ItemQuery}, repository};
use axum::{extract::{Path, Query, State}, http::StatusCode, response::Json};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState { pub config: Arc<Config> }

pub async fn summary(State(state): State<AppState>) -> Result<Json<crate::models::Summary>, AppError> {
    let connection = repository::open(&state.config)?;
    Ok(Json(repository::summary(&connection)?))
}

pub async fn chapters(State(state): State<AppState>) -> Result<Json<Vec<crate::models::Chapter>>, AppError> {
    let connection = repository::open(&state.config)?;
    Ok(Json(repository::chapters(&connection)?))
}

pub async fn items(State(state): State<AppState>, Query(query): Query<ItemQuery>) -> Result<Json<Vec<crate::models::ItemSummary>>, AppError> {
    let connection = repository::open(&state.config)?;
    Ok(Json(repository::items(&connection, &query)?))
}

pub async fn item(State(state): State<AppState>, Path(stable_id): Path<String>) -> Result<Json<crate::models::ItemDetail>, AppError> {
    let connection = repository::open(&state.config)?;
    Ok(Json(repository::item(&connection, &stable_id)?))
}

pub async fn batch(State(state): State<AppState>, Json(body): Json<BatchRequest>) -> Result<Json<Vec<crate::models::ItemSummary>>, AppError> {
    let connection = repository::open(&state.config)?;
    Ok(Json(repository::batch(&connection, &body.stable_ids)?))
}

pub async fn flagged_export(State(state): State<AppState>, Json(body): Json<ExportRequest>) -> Result<Json<crate::models::ExportResponse>, AppError> {
    let config = state.config.clone();
    let response = tokio::task::spawn_blocking(move || exports::create(&config, body.chapter, &body.stable_ids)).await
        .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))??;
    Ok(Json(response))
}

pub async fn health() -> (StatusCode, &'static str) { (StatusCode::OK, "ok") }
