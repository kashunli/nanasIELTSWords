"""Compare book order with the source-audio projection without hiding uncertainty."""
from __future__ import annotations

import argparse
import copy
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from content_repairs import load_repair_plan, load_source_items
from parse_book_ocr import align_chapter, load_audio_records


BOOK_ID = "ielts-vocabulary-true-script"


def load_book_words(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("book_id") != BOOK_ID or not isinstance(payload.get("words"), list):
        raise SystemExit(f"invalid book word artifact: {path}")
    return copy.deepcopy(payload["words"])


def compact_book_word(word: dict, *, status: str, evidence: str, audio: dict | None = None) -> dict:
    result = {
        "book_word_id": word["book_word_id"],
        "chapter": word.get("chapter"),
        "printed_page": word.get("printed_page"),
        "pdf_page": word.get("pdf_page"),
        "position_on_page": word.get("position_on_page"),
        "headword": word.get("headword", ""),
        "example_en": word.get("example_en", ""),
        "alignment_status": status,
        "alignment_evidence": evidence,
    }
    if audio is not None:
        result["audio"] = {
            "stable_id": audio.get("stable_id"),
            "position": audio.get("position"),
            "headword": audio.get("headword", ""),
            "sentence": audio.get("sentence", ""),
            "sentence_match": word.get("sentence_match", "different"),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    artifact = root / "content" / "book-sources" / BOOK_ID
    content = root / "content" / "BV1AT4y1579F"
    book_words = load_book_words(artifact / "book_words.json")
    source_items = load_source_items(content)
    audio_by_chapter = load_audio_records(root)

    words_by_chapter: defaultdict[int, list[dict]] = defaultdict(list)
    for word in book_words:
        words_by_chapter[int(word["chapter"])].append(word)

    chapter_reports: dict[str, dict] = {}
    unresolved_book_entries: list[dict] = []
    no_audio_book_entries: list[dict] = []
    unassigned_audio_items: list[dict] = []
    ordered_book_ids: list[str] = []
    ordered_audio_ids: list[str] = []
    confirmed_count = 0
    order_only_count = 0

    for chapter, words in sorted(words_by_chapter.items()):
        audio = audio_by_chapter.get(chapter, [])
        aligned, alignment = align_chapter(words, audio)
        chapter_reports[str(chapter)] = {
            "book_count": len(words),
            "audio_count": len(audio),
            "confirmed_audio_count": alignment["matched_by_sentence"] + alignment["matched_by_headword"],
            "order_only_count": alignment["matched_by_order"],
            "unmatched_book_count": len(alignment["unexpected_ocr_words"]),
            "unassigned_audio_count": len(alignment["missing_audio_words"]),
            "book_audio_order_matches": True,
        }
        for word in aligned:
            status = word.get("alignment_status", "unmatched_ocr_word")
            audio_record = None
            if word.get("stable_id"):
                audio_record = next((candidate for candidate in audio if candidate["stable_id"] == word["stable_id"]), None)
                ordered_book_ids.append(word["stable_id"])
            if audio_record is not None:
                ordered_audio_ids.append(audio_record["stable_id"])
            if status in {"matched_sentence", "matched_headword"}:
                confirmed_count += 1
            elif status == "matched_order":
                order_only_count += 1
                unresolved_book_entries.append(
                    compact_book_word(word, status=status, evidence="order_only", audio=audio_record)
                )
            else:
                no_audio_book_entries.append(compact_book_word(word, status=status, evidence="no_direct_audio"))
        for gap in alignment["missing_audio_words"]:
            unassigned_audio_items.append({"chapter": chapter, **gap})

    if ordered_book_ids != ordered_audio_ids:
        for report in chapter_reports.values():
            report["book_audio_order_matches"] = False

    plan = load_repair_plan(content)
    repair_summary = []
    for repair in plan.get("repairs", []):
        repair_summary.append(
            {
                "repair_id": repair.get("repair_id") or plan.get("repair_id"),
                "kind": repair.get("kind", ""),
                "existing_stable_id": (repair.get("existing_item") or {}).get("stable_id"),
                "inserted_stable_id": (repair.get("inserted_item") or {}).get("stable_id"),
                "book_word_id": repair.get("book_word_id"),
                "basis": repair.get("basis") or (repair.get("boundary") or {}).get("basis", ""),
            }
        )

    output = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "source_id": "BV1AT4y1579F",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "book_count": len(book_words),
        "runtime_audio_count": len(source_items),
        "confirmed_audio_count": confirmed_count,
        "order_only_count": order_only_count,
        "no_direct_audio_count": len(no_audio_book_entries),
        "unassigned_audio_count": len(unassigned_audio_items),
        "book_audio_order_matches": ordered_book_ids == ordered_audio_ids,
        "chapter_reports": chapter_reports,
        "no_direct_audio_book_entries": no_audio_book_entries,
        "order_only_book_entries": unresolved_book_entries,
        "unassigned_audio_items": unassigned_audio_items,
        "source_audio_repairs": repair_summary,
        "suppressed_audio_items": plan.get("suppressed_items", []),
        "interpretation": {
            "confirmed_audio": "The book sentence or headword directly matched a source-audio transcript record.",
            "order_only": "The entry occupies the same monotonic gap in book and audio order, but has no direct sentence/headword match; it must remain reviewable.",
            "no_direct_audio": "No source-audio record could be assigned without using order-only fallback.",
            "unassigned_audio": "A source-audio record was not assigned to any book entry.",
        },
    }
    destination = artifact / "book_audio_audit.json"
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {destination}: book={len(book_words)}, audio={len(source_items)}, "
        f"confirmed={confirmed_count}, order_only={order_only_count}, "
        f"no_direct_audio={len(no_audio_book_entries)}, unassigned_audio={len(unassigned_audio_items)}"
    )
    return 0 if not no_audio_book_entries and not unassigned_audio_items else 1


if __name__ == "__main__":
    raise SystemExit(main())
