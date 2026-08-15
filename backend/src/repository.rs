use crate::{
    config::Config,
    error::AppError,
    models::{BookReference, Chapter, ItemDetail, ItemQuery, ItemSummary, Summary},
};
use rusqlite::{params, Connection, OptionalExtension};

pub fn open(config: &Config) -> Result<Connection, AppError> {
    let connection = Connection::open(&config.db_path)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(connection)
}

pub fn summary(connection: &Connection) -> Result<Summary, AppError> {
    let row = connection.query_row(
        "SELECT code, title, content_version FROM collections LIMIT 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )?;
    let chapters = connection.query_row("SELECT COUNT(*) FROM chapters", [], |row| row.get(0))?;
    let items = connection.query_row("SELECT COUNT(*) FROM word_items", [], |row| row.get(0))?;
    let book_reference_items =
        connection.query_row("SELECT COUNT(*) FROM book_references", [], |row| row.get(0))?;
    let book_order_review_items = connection.query_row(
        "SELECT COUNT(*) FROM book_references WHERE alignment_status='matched_order' AND needs_review=1",
        [],
        |row| row.get(0),
    )?;
    Ok(Summary {
        collection_code: row.0,
        title: row.1,
        content_version: row.2,
        chapters,
        items,
        book_reference_items,
        book_order_review_items,
    })
}

pub fn chapters(connection: &Connection) -> Result<Vec<Chapter>, AppError> {
    let mut statement = connection.prepare(
        "SELECT number, title, item_count FROM chapters ORDER BY number",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Chapter {
            number: row.get(0)?,
            title: row.get(1)?,
            item_count: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

const ITEM_COLUMNS: &str = "w.stable_id, w.item_uuid, w.chapter_number, w.position, w.headword,
    w.part_of_speech, w.meaning_en, w.meaning_zh, e.text,
    w.meaning_status, w.word_audio, e.sentence_audio,
    b.book_word_id, b.headword, b.ipa, b.part_of_speech, b.meaning_zh,
    b.example_en, b.example_zh, b.collocations, b.word_formation, b.notes,
    b.source_page, b.pdf_page, b.printed_page, b.position_on_page,
    b.alignment_status, b.alignment_evidence, b.sentence_match, b.needs_review,
    b.review_reasons";
const ITEM_FROM: &str = "FROM word_items w JOIN examples e ON e.word_stable_id=w.stable_id AND e.position=0 LEFT JOIN book_references b ON b.stable_id=w.stable_id";

fn book_review_reasons(value: Option<String>) -> Vec<String> {
    value
        .as_deref()
        .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
        .unwrap_or_default()
}

fn map_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ItemSummary> {
    let book_word_id: Option<String> = row.get(12)?;
    let book_review_reasons = book_review_reasons(row.get(30)?);
    let book_reference = book_word_id.map(|book_word_id| BookReference {
        book_word_id,
        headword: row.get(13).unwrap_or_default(),
        ipa: row.get(14).unwrap_or_default(),
        part_of_speech: row.get(15).unwrap_or_default(),
        meaning_zh: row.get(16).unwrap_or_default(),
        example_en: row.get(17).unwrap_or_default(),
        example_zh: row.get(18).unwrap_or_default(),
        collocations: row.get(19).unwrap_or_default(),
        word_formation: row.get(20).unwrap_or_default(),
        notes: row.get(21).unwrap_or_default(),
        source_page: row.get(22).unwrap_or_default(),
        pdf_page: row.get(23).unwrap_or_default(),
        printed_page: row.get(24).unwrap_or_default(),
        position_on_page: row.get(25).unwrap_or_default(),
        alignment_status: row.get(26).unwrap_or_default(),
        alignment_evidence: row.get(27).unwrap_or_default(),
        sentence_match: row.get(28).unwrap_or_default(),
        needs_review: row.get::<_, i64>(29).unwrap_or_default() != 0,
        review_reasons: book_review_reasons,
    });
    Ok(ItemSummary {
        stable_id: row.get(0)?,
        item_uuid: row.get(1)?,
        chapter: row.get(2)?,
        position: row.get(3)?,
        headword: row.get(4)?,
        part_of_speech: row.get(5)?,
        meaning_en: row.get(6)?,
        meaning_zh: row.get(7)?,
        sentence: row.get(8)?,
        meaning_status: row.get(9)?,
        word_audio_url: format!("/media/{}", row.get::<_, String>(10)?),
        sentence_audio_url: format!("/media/{}", row.get::<_, String>(11)?),
        book_reference,
    })
}

pub fn items(connection: &Connection, query: &ItemQuery) -> Result<Vec<ItemSummary>, AppError> {
    let mut sql = format!("SELECT {} {} WHERE 1=1", ITEM_COLUMNS, ITEM_FROM);
    match query.book_alignment.as_deref() {
        Some("order_only") => sql.push_str(" AND b.alignment_status='matched_order' AND b.needs_review=1"),
        Some(value) => return Err(AppError::BadRequest(format!("Unsupported book alignment filter: {value}"))),
        None => {}
    }
    if query.chapter.is_some() {
        sql.push_str(" AND w.chapter_number=?");
    }
    if query.search.as_ref().is_some_and(|v| !v.trim().is_empty()) {
        sql.push_str(" AND (LOWER(w.headword) LIKE LOWER(?) OR LOWER(w.part_of_speech) LIKE LOWER(?) OR LOWER(w.meaning_en) LIKE LOWER(?) OR w.meaning_zh LIKE ? OR LOWER(e.text) LIKE LOWER(?) OR LOWER(b.headword) LIKE LOWER(?) OR b.meaning_zh LIKE ? OR LOWER(b.example_en) LIKE LOWER(?) OR LOWER(b.collocations) LIKE LOWER(?) OR LOWER(b.word_formation) LIKE LOWER(?))");
    }
    sql.push_str(" ORDER BY w.chapter_number, w.position");
    let mut statement = connection.prepare(&sql)?;
    let mut values: Vec<String> = Vec::new();
    if let Some(chapter) = query.chapter {
        values.push(chapter.to_string());
    }
    if let Some(search) = query.search.as_ref().filter(|v| !v.trim().is_empty()) {
        let value = format!("%{}%", search.trim());
        values.extend(std::iter::repeat(value).take(10));
    }
    let rows = statement.query_map(rusqlite::params_from_iter(values.iter()), map_item)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn item(connection: &Connection, stable_id: &str) -> Result<ItemDetail, AppError> {
    let mut statement = connection.prepare(&format!(
        "SELECT {} {} WHERE w.stable_id=?",
        ITEM_COLUMNS, ITEM_FROM
    ))?;
    let Some(item) = statement.query_row([stable_id], map_item).optional()? else {
        return Err(AppError::NotFound(format!("Unknown item: {stable_id}")));
    };
    Ok(item)
}

pub fn batch(connection: &Connection, ids: &[String]) -> Result<Vec<ItemSummary>, AppError> {
    if ids.len() > 500 {
        return Err(AppError::BadRequest(
            "At most 500 IDs can be requested".into(),
        ));
    }
    let mut result = Vec::with_capacity(ids.len());
    for id in ids {
        result.push(item(connection, id)?);
    }
    Ok(result)
}

pub fn export_items(
    connection: &Connection,
    chapter: i64,
    ids: &[String],
) -> Result<Vec<(String, String)>, AppError> {
    if ids.is_empty() {
        return Err(AppError::BadRequest("At least one item is required".into()));
    }
    if ids.len() > 500 {
        return Err(AppError::BadRequest(
            "At most 500 items can be exported".into(),
        ));
    }
    let mut result = Vec::with_capacity(ids.len());
    for id in ids {
        let row = connection.query_row(
            "SELECT w.word_audio, e.sentence_audio FROM word_items w JOIN examples e ON e.word_stable_id=w.stable_id AND e.position=0 WHERE w.stable_id=? AND w.chapter_number=?",
            params![id, chapter], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let Some(value) = row else {
            return Err(AppError::BadRequest(format!(
                "Item {id} is not in chapter {chapter}"
            )));
        };
        result.push(value);
    }
    Ok(result)
}
