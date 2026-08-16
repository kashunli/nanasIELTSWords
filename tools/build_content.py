"""Build the SQLite runtime projection from accepted transcript/meaning artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from content_repairs import load_repair_plan, load_source_items, repair_artifact_hash


PROJECTION_VERSION = "accepted-book-fields-v8-no-ai-draft-english-meaning"
BOOK_WORD_ALIGNMENTS = {"matched_headword", "matched_sentence"}
BOOK_SENTENCE_MATCHES = {"exact", "normalized"}


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE collections (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE chapters (
  collection_code TEXT NOT NULL REFERENCES collections(code) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  transcript_review_count INTEGER NOT NULL,
  PRIMARY KEY (collection_code, number)
);
CREATE TABLE word_items (
  stable_id TEXT PRIMARY KEY,
  item_uuid TEXT NOT NULL UNIQUE,
  collection_code TEXT NOT NULL REFERENCES collections(code) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  position INTEGER NOT NULL,
  headword TEXT NOT NULL,
  part_of_speech TEXT NOT NULL,
  meaning_en TEXT NOT NULL,
  meaning_zh TEXT NOT NULL,
  word_audio TEXT NOT NULL,
  word_translation_audio TEXT,
  transcript_status TEXT NOT NULL,
  meaning_status TEXT NOT NULL,
  accepted_word_source TEXT NOT NULL,
  accepted_sentence_source TEXT NOT NULL,
  UNIQUE(collection_code, chapter_number, position)
);
CREATE TABLE examples (
  stable_id TEXT PRIMARY KEY,
  word_stable_id TEXT NOT NULL REFERENCES word_items(stable_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  sentence_audio TEXT NOT NULL,
  sentence_translation_audio TEXT,
  transcript_status TEXT NOT NULL,
  accepted_sentence_source TEXT NOT NULL,
  UNIQUE(word_stable_id, position)
);
CREATE TABLE book_references (
  stable_id TEXT PRIMARY KEY REFERENCES word_items(stable_id) ON DELETE CASCADE,
  book_word_id TEXT NOT NULL UNIQUE,
  headword TEXT NOT NULL,
  ipa TEXT NOT NULL,
  part_of_speech TEXT NOT NULL,
  meaning_zh TEXT NOT NULL,
  example_en TEXT NOT NULL,
  example_zh TEXT NOT NULL,
  collocations TEXT NOT NULL,
  word_formation TEXT NOT NULL,
  notes TEXT NOT NULL,
  source_page TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  printed_page INTEGER,
  position_on_page INTEGER NOT NULL,
  alignment_status TEXT NOT NULL,
  alignment_evidence TEXT NOT NULL,
  sentence_match TEXT NOT NULL,
  needs_review INTEGER NOT NULL,
  review_reasons TEXT NOT NULL
);
CREATE TABLE review_reasons (
  word_stable_id TEXT NOT NULL REFERENCES word_items(stable_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(word_stable_id, source, reason)
);
CREATE TABLE source_revisions (
  artifact_type TEXT PRIMARY KEY,
  artifact_hash TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def runtime_meaning(record: dict) -> dict:
    """Keep model-drafted English meanings in preparation, not the runtime."""
    status = str(record.get("meaning_status", "ai_draft")).strip() or "ai_draft"
    if status != "ai_draft":
        return {**record, "meaning_status": status}
    return {**record, "meaning_en": "", "meaning_status": "not_provided"}


def optional_audio_path(root: Path, value: object, stable_id: str, field_name: str) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        value = value.get("path")
    path = str(value or "").strip()
    if not path:
        return None
    media_root = (root / "var" / "content" / "media").resolve()
    target = (media_root / path).resolve()
    if not target.is_relative_to(media_root):
        raise SystemExit(f"{field_name} escapes runtime media root: {stable_id}")
    if not target.is_file():
        raise SystemExit(f"missing media: {path} ({field_name}, {stable_id})")
    return path


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_translation_audio(
    path: Path,
    media_root: Path,
    *,
    require_files: bool = False,
) -> dict[str, dict[str, dict[str, str]]]:
    """Load verified derived audio, allowing generation to remain resumable."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("provider") != "microsoft-edge-tts":
        raise SystemExit(f"unsupported translation audio manifest: {path}")
    items = payload.get("items")
    if not isinstance(items, dict):
        raise SystemExit(f"translation audio manifest items must be an object: {path}")
    result: dict[str, dict[str, dict[str, str]]] = {}
    media_root = media_root.resolve()
    for stable_id, fields in items.items():
        if not isinstance(fields, dict):
            raise SystemExit(f"translation audio fields must be an object for {stable_id}")
        result[stable_id] = {}
        for field in ("word", "example"):
            entry = fields.get(field)
            if entry is None:
                continue
            if not isinstance(entry, dict):
                raise SystemExit(f"translation audio entry must be an object for {stable_id} {field}")
            relative = str(entry.get("audio_path", "")).replace("\\", "/")
            if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
                raise SystemExit(f"translation audio path escapes media root: {relative!r}")
            target = (media_root / Path(relative)).resolve()
            try:
                target.relative_to(media_root)
            except ValueError as exc:
                raise SystemExit(f"translation audio path escapes media root: {relative!r}") from exc
            expected_audio_hash = str(entry.get("audio_sha256", ""))
            text = str(entry.get("text", ""))
            if not text or str(entry.get("text_sha256", "")) != sha256_text(text):
                raise SystemExit(f"translation audio text hash mismatch: {stable_id} {field}")
            if not target.is_file():
                if require_files:
                    raise SystemExit(f"translation audio file is missing: {target}")
                continue
            if not expected_audio_hash or sha256(target) != expected_audio_hash:
                raise SystemExit(f"translation audio hash mismatch: {target}")
            result[stable_id][field] = {"audio_path": relative, "text": text}
    return result


def translation_audio_path(
    translation_audio: dict[str, dict[str, dict[str, str]]],
    stable_id: str,
    field: str,
    text: str,
) -> str:
    """Return audio only when the manifest text is exactly the displayed text."""
    if not text:
        return ""
    entry = translation_audio.get(stable_id, {}).get(field)
    if not entry:
        return ""
    if entry["text"] != text:
        raise SystemExit(f"translation audio text mismatch for {stable_id} {field}")
    return entry["audio_path"]


def normalize_sentence(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "").casefold()
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = value.replace("’", "'")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def sentence_match(book_sentence: str, audio_sentence: str) -> str:
    if book_sentence.strip() == audio_sentence.strip():
        return "exact"
    if normalize_sentence(book_sentence) == normalize_sentence(audio_sentence):
        return "normalized"
    return "different"


def book_word_matches(reference: dict | None, asr_headword: str) -> bool:
    if not reference:
        return False
    if reference.get("alignment_status") in BOOK_WORD_ALIGNMENTS:
        return True
    return normalize_sentence(str(reference.get("headword", ""))) == normalize_sentence(asr_headword)


def book_sentence_matches(reference: dict | None) -> bool:
    return bool(reference and reference.get("sentence_match") in BOOK_SENTENCE_MATCHES)


def book_order_review_is_confirmed(record: dict, reference: dict | None) -> bool:
    """Treat the remaining flagged order pairs as book-confirmed content.

    The order-only queue still remains available for the separate book/audio
    coverage audit.  This rule applies to flagged order-only pairs that were
    manually verified against the book; it makes their learner-facing word and
    example book-backed without changing the acoustic identity.
    """
    return bool(
        reference
        and reference.get("alignment_status") == "matched_order"
        and record.get("transcript_status") == "needs_review"
    )


def accepted_transcript(record: dict, reference: dict | None) -> dict[str, str]:
    word_from_book = book_word_matches(reference, record["headword"]) or book_order_review_is_confirmed(record, reference)
    # A reliable book-word alignment identifies the whole learner-facing item.
    # The book example is authoritative even when the audio transcript uses a
    # different spelling or inflection, such as mould/Mold or moulded/molded.
    sentence_from_book = word_from_book or book_sentence_matches(reference)
    return {
        "headword": reference["headword"] if word_from_book and reference else record["headword"],
        "sentence": reference["example_en"] if sentence_from_book and reference else record["sentence"],
        "accepted_word_source": "book" if word_from_book else "asr",
        "accepted_sentence_source": "book" if sentence_from_book else "asr",
    }


def unresolved_asr_review(record: dict, reference: dict | None) -> bool:
    if record.get("transcript_status") != "needs_review":
        return False
    accepted = accepted_transcript(record, reference)
    return accepted["accepted_word_source"] != "book" or accepted["accepted_sentence_source"] != "book"


def load_book_references(path: Path, selected: list[dict]) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    selected_ids = {record["stable_id"] for record in selected}
    references: dict[str, dict] = {}
    for record in payload.get("words", []):
        stable_id = record.get("stable_id")
        if not stable_id or record.get("alignment_status") == "unmatched_ocr_word":
            continue
        if stable_id not in selected_ids:
            raise SystemExit(f"book reference points to unknown audio item: {stable_id}")
        if stable_id in references:
            raise SystemExit(f"duplicate book reference for audio item: {stable_id}")
        source = record.get("source") or {}
        alignment_status = str(record.get("alignment_status", ""))
        review_reasons = list(record.get("review_reasons") or [])
        if alignment_status == "matched_order" and "order_only_alignment" not in review_reasons:
            review_reasons.append("order_only_alignment")
        references[stable_id] = {
            "book_word_id": str(record.get("book_word_id", "")),
            "headword": str(record.get("headword", "")),
            "ipa": str(record.get("ipa", "")),
            "part_of_speech": str(record.get("part_of_speech", "")),
            "meaning_zh": str(record.get("meaning_zh", "")),
            "example_en": str(record.get("example_en", "")),
            "example_zh": str(record.get("example_zh", "")),
            "collocations": str(record.get("collocations", "")),
            "word_formation": str(record.get("word_formation", "")),
            "notes": str(record.get("notes", "")),
            "source_page": str(source.get("page_markdown", "")),
            "pdf_page": int(record.get("pdf_page", 0)),
            "printed_page": record.get("printed_page"),
            "position_on_page": int(record.get("position_on_page", 0)),
            "alignment_status": alignment_status,
            "alignment_evidence": str(record.get("alignment_evidence", "")),
            "sentence_match": str(record.get("sentence_match", "")),
            "needs_review": int(bool(record.get("needs_review")) or alignment_status == "matched_order"),
            "review_reasons": json.dumps(review_reasons, ensure_ascii=False),
        }
    return references


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--allow-missing-meanings", action="store_true", help="build a preparation preview with explicit placeholders")
    parser.add_argument("--require-translation-audio", action="store_true", help="fail unless every non-empty Chinese translation has verified Edge TTS audio")
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    source_items = load_source_items(content)
    repair_plan = load_repair_plan(content)
    selected = [json.loads(line) for line in (content / "selected-transcripts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    meaning_path = content / "meanings.jsonl"
    book_reference_path = root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_words.json"
    translation_audio_path_manifest = content / "chinese-translation-audio-manifest.json"
    meanings = {record["stable_id"]: record for record in (json.loads(line) for line in meaning_path.read_text(encoding="utf-8").splitlines() if line.strip())} if meaning_path.exists() else {}
    repaired_meanings = {
        repair["inserted_item"]["stable_id"]: {
            "part_of_speech": repair["inserted_item"]["part_of_speech"],
            "meaning_en": repair["inserted_item"]["meaning_en"],
            "meaning_zh": repair["inserted_item"]["meaning_zh"],
            "meaning_status": repair["inserted_item"].get("meaning_status", "ai_draft"),
        }
        for repair in repair_plan.get("repairs", [])
        if repair.get("inserted_item", {}).get("stable_id")
    }
    source_ids = {record["stable_id"] for record in source_items}
    # The base meanings artifact can still contain records intentionally
    # suppressed from the runtime projection.  Keep that preparation evidence
    # intact, but do not require suppressed IDs to appear in the runtime build.
    effective_meanings = {
        stable_id: runtime_meaning(record)
        for stable_id, record in {**repaired_meanings, **meanings}.items()
        if stable_id in source_ids
    }
    book_references = load_book_references(book_reference_path, selected)
    translation_audio = load_translation_audio(
        translation_audio_path_manifest,
        root / "var" / "content" / "media",
        require_files=args.require_translation_audio,
    )
    selected_ids = {record["stable_id"] for record in selected}
    if len(selected) != len(source_items) or selected_ids != source_ids:
        raise SystemExit(f"selected transcript coverage mismatch: {len(selected)} vs {len(source_items)}")
    if not args.allow_missing_meanings and set(effective_meanings) != selected_ids:
        raise SystemExit(f"meaning coverage mismatch: {len(effective_meanings)} vs {len(selected)}")
    by_id = {record["stable_id"]: record for record in selected}
    for stable_id, book_reference in book_references.items():
        if not book_reference["sentence_match"]:
            book_reference["sentence_match"] = sentence_match(book_reference["example_en"], by_id[stable_id]["sentence"])
    collection_code = "IELTS_TRUE_VOCAB"
    now = datetime.now(timezone.utc).isoformat()
    content_version = hashlib.sha256(json.dumps({"projection": PROJECTION_VERSION, "source": source["source_manifest_sha256"], "repairs": repair_artifact_hash(content), "selected": sha256(content / "selected-transcripts.jsonl"), "meanings": sha256(meaning_path) if meaning_path.exists() else "", "book_words": sha256(book_reference_path) if book_reference_path.exists() else "", "translation_audio": sha256(translation_audio_path_manifest) if translation_audio_path_manifest.exists() else ""}, sort_keys=True).encode()).hexdigest()[:16]
    database_dir = root / "var" / "content"
    database_dir.mkdir(parents=True, exist_ok=True)
    temp_path = database_dir / ".content.sqlite.tmp"
    database_path = database_dir / "content.sqlite"
    if temp_path.exists(): temp_path.unlink()
    connection = sqlite3.connect(temp_path)
    try:
        connection.executescript(SCHEMA)
        connection.execute("INSERT INTO collections VALUES (?, ?, ?, ?, ?)", (collection_code, "IELTS Vocabulary from Audio", "BV1AT4y1579F", content_version, now))
        chapters: dict[int, list[dict]] = {}
        for record in selected: chapters.setdefault(int(record["chapter"]), []).append(record)
        for number, chapter_items in sorted(chapters.items()):
            review_count = sum(unresolved_asr_review(record, book_references.get(record["stable_id"])) for record in chapter_items)
            connection.execute("INSERT INTO chapters VALUES (?, ?, ?, ?, ?)", (collection_code, number, f"Chapter {number}", len(chapter_items), review_count))
        accepted: list[dict] = []
        for record in selected:
            meaning = effective_meanings.get(record["stable_id"], {"part_of_speech": "", "meaning_en": "", "meaning_zh": "释义待生成", "meaning_status": "not_provided"})
            if not record["headword"] or not record["sentence"]: raise SystemExit(f"empty selected transcript: {record['stable_id']}")
            word_audio = record["word_audio"]["path"]
            sentence_audio = record["sentence_audio"]["path"]
            if not (root / "var" / "content" / "media" / word_audio).is_file(): raise SystemExit(f"missing media: {word_audio}")
            if not (root / "var" / "content" / "media" / sentence_audio).is_file(): raise SystemExit(f"missing media: {sentence_audio}")
            word_translation_audio = optional_audio_path(root, record.get("word_translation_audio") or meaning.get("word_translation_audio"), record["stable_id"], "word_translation_audio")
            sentence_translation_audio = optional_audio_path(root, record.get("sentence_translation_audio") or meaning.get("sentence_translation_audio"), record["stable_id"], "sentence_translation_audio")
            book_reference = book_references.get(record["stable_id"])
            accepted_fields = accepted_transcript(record, book_reference)
            display_meaning_zh = book_reference["meaning_zh"] if book_reference and book_reference["meaning_zh"] else meaning["meaning_zh"]
            display_example_zh = book_reference["example_zh"] if book_reference else ""
            generated_word_translation_audio = translation_audio_path(translation_audio, record["stable_id"], "word", display_meaning_zh)
            generated_sentence_translation_audio = translation_audio_path(translation_audio, record["stable_id"], "example", display_example_zh)
            word_translation_audio = word_translation_audio or generated_word_translation_audio or None
            sentence_translation_audio = sentence_translation_audio or generated_sentence_translation_audio or None
            if args.require_translation_audio and (not word_translation_audio or (display_example_zh and not sentence_translation_audio)):
                raise SystemExit(f"missing required translation audio for {record['stable_id']}")
            accepted_record = {"schema_version": 1, "stable_id": record["stable_id"], "item_uuid": record["item_uuid"], "collection_code": collection_code, "chapter": record["chapter"], "position": record["position"], "headword": accepted_fields["headword"], "part_of_speech": meaning["part_of_speech"], "meaning_en": meaning["meaning_en"], "meaning_zh": meaning["meaning_zh"], "sentence": accepted_fields["sentence"], "word_audio": word_audio, "word_translation_audio": word_translation_audio, "sentence_audio": sentence_audio, "sentence_translation_audio": sentence_translation_audio, "transcript_status": record["transcript_status"], "meaning_status": meaning.get("meaning_status", "not_provided"), "accepted_word_source": accepted_fields["accepted_word_source"], "accepted_sentence_source": accepted_fields["accepted_sentence_source"], "review_reasons": record["review_reasons"]}
            accepted.append(accepted_record)
            connection.execute(
                "INSERT INTO word_items (stable_id, item_uuid, collection_code, chapter_number, position, headword, part_of_speech, meaning_en, meaning_zh, word_audio, word_translation_audio, transcript_status, meaning_status, accepted_word_source, accepted_sentence_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record["stable_id"], record["item_uuid"], collection_code, record["chapter"], record["position"], accepted_fields["headword"], meaning["part_of_speech"], meaning["meaning_en"], meaning["meaning_zh"], word_audio, word_translation_audio, record["transcript_status"], meaning.get("meaning_status", "not_provided"), accepted_fields["accepted_word_source"], accepted_fields["accepted_sentence_source"]),
            )
            connection.execute("INSERT INTO examples VALUES (?, ?, 0, 'main_sentence', ?, ?, ?, ?, ?)", (f"{record['stable_id']}-main", record["stable_id"], accepted_fields["sentence"], sentence_audio, sentence_translation_audio, record["transcript_status"], accepted_fields["accepted_sentence_source"]))
            if book_reference:
                connection.execute(
                    "INSERT INTO book_references (stable_id, book_word_id, headword, ipa, part_of_speech, meaning_zh, example_en, example_zh, collocations, word_formation, notes, source_page, pdf_page, printed_page, position_on_page, alignment_status, alignment_evidence, sentence_match, needs_review, review_reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (record["stable_id"], book_reference["book_word_id"], book_reference["headword"], book_reference["ipa"], book_reference["part_of_speech"], book_reference["meaning_zh"], book_reference["example_en"], book_reference["example_zh"], book_reference["collocations"], book_reference["word_formation"], book_reference["notes"], book_reference["source_page"], book_reference["pdf_page"], book_reference["printed_page"], book_reference["position_on_page"], book_reference["alignment_status"], book_reference["alignment_evidence"], book_reference["sentence_match"], book_reference["needs_review"], book_reference["review_reasons"]),
                )
            for reason in record["review_reasons"]: connection.execute("INSERT INTO review_reasons VALUES (?, 'asr', ?)", (record["stable_id"], reason))
        for artifact, path in (("source_manifest", content / "source-manifest.json"), ("audio_repairs", content / "audio-repairs.json"), ("selected_transcripts", content / "selected-transcripts.jsonl"), ("meanings", meaning_path), ("book_words", book_reference_path), ("translation_audio", translation_audio_path_manifest)):
            if path.exists(): connection.execute("INSERT INTO source_revisions VALUES (?, ?, ?, ?)", (artifact, sha256(path), f"ielts-vocabulary-tools-{PROJECTION_VERSION}", now))
        connection.commit()
        counts = connection.execute("SELECT COUNT(*), COUNT(DISTINCT item_uuid) FROM word_items").fetchone()
        if counts != (len(selected), len(selected)): raise SystemExit("duplicate or missing word IDs")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None: raise SystemExit("foreign key check failed")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise SystemExit("integrity check failed")
        accepted_path = content / "accepted-items.jsonl"
        accepted_path.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in accepted), encoding="utf-8")
    finally:
        connection.close()
    os.replace(temp_path, database_path)
    print(f"built {database_path}: {len(selected)} items, version {content_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
