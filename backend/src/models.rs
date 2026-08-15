use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Summary {
    pub collection_code: String,
    pub title: String,
    pub content_version: String,
    pub chapters: i64,
    pub items: i64,
    pub book_reference_items: i64,
    pub book_order_review_items: i64,
}

#[derive(Debug, Serialize)]
pub struct Chapter {
    pub number: i64,
    pub title: String,
    pub item_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct BookReference {
    pub book_word_id: String,
    pub headword: String,
    pub ipa: String,
    pub part_of_speech: String,
    pub meaning_zh: String,
    pub example_en: String,
    pub example_zh: String,
    pub collocations: String,
    pub word_formation: String,
    pub notes: String,
    pub source_page: String,
    pub pdf_page: i64,
    pub printed_page: Option<i64>,
    pub position_on_page: i64,
    pub alignment_status: String,
    pub alignment_evidence: String,
    pub sentence_match: String,
    pub needs_review: bool,
    pub review_reasons: Vec<String>,
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
    pub meaning_status: String,
    pub word_audio_url: String,
    pub sentence_audio_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_translation_audio_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentence_translation_audio_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_reference: Option<BookReference>,
}

pub type ItemDetail = ItemSummary;

#[derive(Debug, Deserialize)]
pub struct ItemQuery {
    pub chapter: Option<i64>,
    pub search: Option<String>,
    pub book_alignment: Option<String>,
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
