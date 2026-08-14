"""Build the SQLite runtime projection from accepted transcript/meaning artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


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
  transcript_status TEXT NOT NULL,
  accepted_sentence_source TEXT NOT NULL,
  UNIQUE(word_stable_id, position)
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--allow-missing-meanings", action="store_true", help="build a preparation preview with explicit placeholders")
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    selected = [json.loads(line) for line in (content / "selected-transcripts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    meaning_path = content / "meanings.jsonl"
    meanings = {record["stable_id"]: record for record in (json.loads(line) for line in meaning_path.read_text(encoding="utf-8").splitlines() if line.strip())} if meaning_path.exists() else {}
    if len(selected) != source["items"]: raise SystemExit(f"selected transcript coverage mismatch: {len(selected)} vs {source['items']}")
    if not args.allow_missing_meanings and set(meanings) != {record["stable_id"] for record in selected}:
        raise SystemExit(f"meaning coverage mismatch: {len(meanings)} vs {len(selected)}")
    by_id = {record["stable_id"]: record for record in selected}
    collection_code = "IELTS_TRUE_VOCAB"
    now = datetime.now(timezone.utc).isoformat()
    content_version = hashlib.sha256(json.dumps({"source": source["source_manifest_sha256"], "selected": sha256(content / "selected-transcripts.jsonl"), "meanings": sha256(meaning_path) if meaning_path.exists() else ""}, sort_keys=True).encode()).hexdigest()[:16]
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
            review_count = sum(bool(record["review_reasons"]) for record in chapter_items)
            connection.execute("INSERT INTO chapters VALUES (?, ?, ?, ?, ?)", (collection_code, number, f"Chapter {number}", len(chapter_items), review_count))
        accepted: list[dict] = []
        for record in selected:
            meaning = meanings.get(record["stable_id"], {"part_of_speech": "", "meaning_en": "Meaning pending", "meaning_zh": "释义待生成", "meaning_status": "ai_draft"})
            if not record["headword"] or not record["sentence"]: raise SystemExit(f"empty selected transcript: {record['stable_id']}")
            word_audio = record["word_audio"]["path"]
            sentence_audio = record["sentence_audio"]["path"]
            if not (root / "var" / "content" / "media" / word_audio).is_file(): raise SystemExit(f"missing media: {word_audio}")
            if not (root / "var" / "content" / "media" / sentence_audio).is_file(): raise SystemExit(f"missing media: {sentence_audio}")
            accepted_record = {"schema_version": 1, "stable_id": record["stable_id"], "item_uuid": record["item_uuid"], "collection_code": collection_code, "chapter": record["chapter"], "position": record["position"], "headword": record["headword"], "part_of_speech": meaning["part_of_speech"], "meaning_en": meaning["meaning_en"], "meaning_zh": meaning["meaning_zh"], "sentence": record["sentence"], "word_audio": word_audio, "sentence_audio": sentence_audio, "transcript_status": record["transcript_status"], "meaning_status": meaning.get("meaning_status", "ai_draft"), "accepted_word_source": "asr", "accepted_sentence_source": "asr", "review_reasons": record["review_reasons"], "review_resolutions": record.get("review_resolutions", [])}
            accepted.append(accepted_record)
            connection.execute(
                "INSERT INTO word_items (stable_id, item_uuid, collection_code, chapter_number, position, headword, part_of_speech, meaning_en, meaning_zh, word_audio, transcript_status, meaning_status, accepted_word_source, accepted_sentence_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record["stable_id"], record["item_uuid"], collection_code, record["chapter"], record["position"], record["headword"], meaning["part_of_speech"], meaning["meaning_en"], meaning["meaning_zh"], word_audio, record["transcript_status"], meaning.get("meaning_status", "ai_draft"), "asr", "asr"),
            )
            connection.execute("INSERT INTO examples VALUES (?, ?, 0, 'main_sentence', ?, ?, ?, 'asr')", (f"{record['stable_id']}-main", record["stable_id"], record["sentence"], sentence_audio, record["transcript_status"]))
            for reason in record["review_reasons"]: connection.execute("INSERT INTO review_reasons VALUES (?, 'asr', ?)", (record["stable_id"], reason))
            if meaning.get("meaning_status") != "reviewed": connection.execute("INSERT INTO review_reasons VALUES (?, 'meaning', 'ai_draft_meaning')", (record["stable_id"],))
        for artifact, path in (("source_manifest", content / "source-manifest.json"), ("selected_transcripts", content / "selected-transcripts.jsonl"), ("meanings", meaning_path)):
            if path.exists(): connection.execute("INSERT INTO source_revisions VALUES (?, ?, 'ielts-vocabulary-tools-v1', ?)", (artifact, sha256(path), now))
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
