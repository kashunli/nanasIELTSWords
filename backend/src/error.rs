use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde::Serialize;

#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    BadRequest(String),
    Internal(anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody { error: String }

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Internal(error) => {
                tracing::error!(%error, "request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".into())
            }
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self { Self::Internal(value) }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self { Self::Internal(value.into()) }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self { Self::Internal(value.into()) }
}
