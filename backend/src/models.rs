use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Summary {
    pub collection_code: String,
    pub title: String,
    pub content_version: String,
    pub chapters: i64,
    pub items: i64,
    pub transcript_review_items: i64,
}

#[derive(Debug, Serialize)]
pub struct Chapter {
    pub number: i64,
    pub title: String,
    pub item_count: i64,
    pub transcript_review_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ReviewReason {
    pub source: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ItemSummary {
    pub stable_id: String,
    pub item_uuid: String,
    pub chapter: i64,
    pub position: i64,
    pub headword: String,
    pub part_of_speech: String,
    pub meaning_en: String,
    pub meaning_zh: String,
    pub sentence: String,
    pub transcript_status: String,
    pub meaning_status: String,
    pub word_audio_url: String,
    pub sentence_audio_url: String,
}

#[derive(Debug, Serialize)]
pub struct ItemDetail {
    #[serde(flatten)]
    pub item: ItemSummary,
    pub accepted_word_source: String,
    pub accepted_sentence_source: String,
    pub review_reasons: Vec<ReviewReason>,
}

#[derive(Debug, Deserialize)]
pub struct ItemQuery {
    pub chapter: Option<i64>,
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchRequest {
    pub stable_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExportRequest {
    pub chapter: i64,
    pub stable_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ExportResponse {
    pub ok: bool,
    pub chapter: i64,
    pub item_count: usize,
    pub audio_url: String,
    pub file_name: String,
}
