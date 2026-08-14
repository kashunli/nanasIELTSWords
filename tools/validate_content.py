"""Run the small validation gate needed before starting the local service."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    database = root / "var" / "content" / "content.sqlite"
    if source["items"] != 3662: raise SystemExit("source item count is not 3662")
    connection = sqlite3.connect(database)
    try:
        counts = connection.execute("SELECT (SELECT COUNT(*) FROM chapters), (SELECT COUNT(*) FROM word_items), (SELECT COUNT(*) FROM examples), (SELECT COUNT(*) FROM review_reasons), (SELECT COUNT(*) FROM book_references)").fetchone()
        print({"chapters": counts[0], "items": counts[1], "examples": counts[2], "review_reasons": counts[3], "book_references": counts[4]})
        if counts[0] != 22 or counts[1] != 3662 or counts[2] != 3662: raise SystemExit("runtime count validation failed")
        if counts[4] < 1000: raise SystemExit("book reference coverage is unexpectedly low")
        accepted_sources = connection.execute("SELECT w.accepted_word_source, e.accepted_sentence_source, COUNT(*) FROM word_items w JOIN examples e ON e.word_stable_id=w.stable_id AND e.position=0 GROUP BY 1, 2 ORDER BY 1, 2").fetchall()
        print({"accepted_sources": accepted_sources})
        if any(word not in {"asr", "book"} or sentence not in {"asr", "book"} for word, sentence, _ in accepted_sources):
            raise SystemExit("unknown accepted content source")
        unresolved = connection.execute("SELECT COUNT(*) FROM word_items WHERE transcript_status='needs_review' AND (accepted_word_source <> 'book' OR accepted_sentence_source <> 'book')").fetchone()[0]
        chapter_unresolved = connection.execute("SELECT COALESCE(SUM(transcript_review_count), 0) FROM chapters").fetchone()[0]
        if unresolved != chapter_unresolved:
            raise SystemExit(f"chapter review count mismatch: {chapter_unresolved} vs {unresolved}")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise SystemExit("integrity check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None: raise SystemExit("foreign key check failed")
    finally:
        connection.close()
    print("content validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
