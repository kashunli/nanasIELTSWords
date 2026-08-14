"""Parse page OCR into website-ready book records while retaining source alignment."""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BOOK_ID = "ielts-vocabulary-true-script"


def normalize_word(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold()
    value = value.replace("’", "'")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def read_page(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"missing frontmatter: {path}")
    _, frontmatter, body = text.split("---\n", 2)
    metadata: dict[str, Any] = {}
    for line in frontmatter.splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        try:
            metadata[key] = json.loads(raw_value.strip())
        except json.JSONDecodeError:
            metadata[key] = raw_value.strip()
    return metadata, json.loads(body)


def source_path_for(raw_path: str | None, artifact_dir: Path) -> str | None:
    if not raw_path:
        return None
    return str((artifact_dir / raw_path).resolve().relative_to(artifact_dir.parent.parent.parent.resolve()))


def load_audio_records(root: Path) -> dict[int, list[dict[str, Any]]]:
    path = root / "content" / "BV1AT4y1579F" / "selected-transcripts.jsonl"
    if not path.exists():
        return {}
    chapters: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            chapters[int(record["chapter"])].append(record)
    return dict(chapters)


def align_chapter(ocr_words: list[dict[str, Any]], audio_records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    expected_index = 0
    aligned: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    unexpected: list[dict[str, Any]] = []
    for word in ocr_words:
        target = normalize_word(word["headword"])
        matched_index: int | None = None
        for candidate_index in range(expected_index, min(len(audio_records), expected_index + 8)):
            if normalize_word(audio_records[candidate_index]["headword"].rstrip(".")) == target:
                matched_index = candidate_index
                break
        if matched_index is None:
            unexpected.append({"ocr_word_id": word["book_word_id"], "headword": word["headword"]})
            word["alignment_status"] = "unmatched_ocr_word"
            aligned.append(word)
            continue
        if matched_index > expected_index:
            for missing in audio_records[expected_index:matched_index]:
                gaps.append({"stable_id": missing["stable_id"], "headword": missing["headword"], "position": missing["position"]})
        audio = audio_records[matched_index]
        word["stable_id"] = audio["stable_id"]
        word["item_uuid"] = audio["item_uuid"]
        word["audio_position"] = audio["position"]
        word["audio_headword"] = audio["headword"]
        word["alignment_status"] = "matched_headword"
        aligned.append(word)
        expected_index = matched_index + 1
    for missing in audio_records[expected_index:]:
        gaps.append({"stable_id": missing["stable_id"], "headword": missing["headword"], "position": missing["position"]})
    return aligned, {
        "expected_audio_words": len(audio_records),
        "ocr_words": len(ocr_words),
        "matched_words": sum(item.get("alignment_status") == "matched_headword" for item in aligned),
        "missing_audio_words": gaps,
        "unexpected_ocr_words": unexpected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--page-ocr", type=Path, default=None)
    args = parser.parse_args()

    root = args.project_root.resolve()
    artifact = root / "content" / "book-sources" / BOOK_ID
    manifest_path = (args.manifest or (artifact / "book_manifest.json")).resolve()
    page_dir = (args.page_ocr or (artifact / "page-ocr")).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    audio_by_chapter = load_audio_records(root)

    words_by_chapter: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    chapter_openers: list[dict[str, Any]] = []
    page_reports: list[dict[str, Any]] = []
    pages_with_issues: list[int] = []
    for page in manifest["pages"]:
        page_number = int(page["pdf_page"])
        page_path = page_dir / f"page_{page_number:04d}.md"
        if not page_path.exists():
            page_reports.append({"pdf_page": page_number, "page_type": page["page_type"], "status": "missing"})
            pages_with_issues.append(page_number)
            continue
        try:
            metadata, payload = read_page(page_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            page_reports.append({"pdf_page": page_number, "page_type": page["page_type"], "status": "invalid", "error": str(exc)})
            pages_with_issues.append(page_number)
            continue
        reasons = metadata.get("review_reasons") or []
        if metadata.get("needs_review"):
            pages_with_issues.append(page_number)
        page_report: dict[str, Any] = {
            "pdf_page": page_number,
            "book_page": page.get("book_page"),
            "page_type": page["page_type"],
            "status": "needs_review" if metadata.get("needs_review") else "ok",
            "review_reasons": reasons,
        }
        if page["page_type"] == "vocabulary":
            entries = payload.get("entries") or []
            for index, entry in enumerate(entries, start=1):
                if not isinstance(entry, dict):
                    continue
                headword = str(entry.get("headword", "")).strip()
                if not headword:
                    pages_with_issues.append(page_number)
                    continue
                word = {
                    "schema_version": 1,
                    "book_word_id": f"{BOOK_ID}-pdf{page_number:04d}-{index:02d}",
                    "chapter": page.get("chapter"),
                    "chapter_title": page.get("chapter_title"),
                    "printed_page": page.get("book_page"),
                    "pdf_page": page_number,
                    "position_on_page": index,
                    "headword": headword,
                    "ipa": str(entry.get("ipa", "")),
                    "part_of_speech": str(entry.get("part_of_speech", "")),
                    "meaning_zh": str(entry.get("meaning_zh", "")),
                    "example_en": str(entry.get("example_en", "")),
                    "example_zh": str(entry.get("example_zh", "")),
                    "collocations": str(entry.get("collocations", "")),
                    "word_formation": str(entry.get("word_formation", "")),
                    "notes": str(entry.get("notes", "")),
                    "source": {
                        "page_markdown": str(page_path.relative_to(root)),
                        "raw_model_output": metadata.get("raw_response"),
                        "ocr_method": metadata.get("ocr_method"),
                        "prompt_version": metadata.get("prompt_version"),
                    },
                    "needs_review": bool(metadata.get("needs_review")),
                    "review_reasons": list(reasons),
                }
                words_by_chapter[int(page["chapter"])].append(word)
            page_report["ocr_entry_count"] = len(entries)
        elif page["page_type"] == "chapter_opener":
            chapter_openers.append(
                {
                    "chapter": page.get("chapter"),
                    "chapter_title": page.get("chapter_title"),
                    "pdf_page": page_number,
                    "printed_page": page.get("book_page"),
                    "ocr": payload,
                    "source": {
                        "page_markdown": str(page_path.relative_to(root)),
                        "raw_model_output": metadata.get("raw_response"),
                    },
                    "needs_review": bool(metadata.get("needs_review")),
                    "review_reasons": list(reasons),
                }
            )
        page_reports.append(page_report)

    aligned_words: list[dict[str, Any]] = []
    chapter_alignment: dict[str, Any] = {}
    for chapter, words in sorted(words_by_chapter.items()):
        if chapter in audio_by_chapter:
            aligned, report = align_chapter(words, audio_by_chapter[chapter])
        else:
            aligned = words
            report = {"expected_audio_words": None, "ocr_words": len(words), "matched_words": None, "missing_audio_words": [], "unexpected_ocr_words": []}
        aligned_words.extend(aligned)
        chapter_alignment[str(chapter)] = report

    index_entries: list[dict[str, Any]] = []
    for page in manifest["pages"]:
        if page["page_type"] != "index":
            continue
        path = page_dir / f"page_{int(page['pdf_page']):04d}.md"
        if not path.exists():
            continue
        try:
            metadata, payload = read_page(path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        for entry in payload.get("entries") or []:
            if isinstance(entry, dict) and entry.get("headword"):
                index_entries.append(
                    {
                        "headword": str(entry.get("headword")),
                        "book_page": entry.get("book_page"),
                        "pdf_page": page["pdf_page"],
                        "source_page_markdown": str(path.relative_to(root)),
                        "needs_review": bool(metadata.get("needs_review")),
                    }
                )

    output = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "source_manifest": str(manifest_path.relative_to(root)),
        "source_pdf": manifest["source_pdf"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chapters": manifest["chapters"],
        "chapter_openers": chapter_openers,
        "words": aligned_words,
        "index": index_entries,
    }
    report = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "page_count": len(manifest["pages"]),
        "page_reports": page_reports,
        "pages_with_issues": sorted(set(pages_with_issues)),
        "chapter_alignment": chapter_alignment,
        "word_count": len(aligned_words),
        "index_entry_count": len(index_entries),
    }
    (artifact / "book_words.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (artifact / "ocr_validation_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {artifact / 'book_words.json'}: {len(aligned_words)} OCR vocabulary records")
    print(f"index entries: {len(index_entries)}; pages with issues: {len(report['pages_with_issues'])}")
    for chapter, chapter_report in chapter_alignment.items():
        print(
            f"chapter {chapter}: OCR {chapter_report['ocr_words']}, matched {chapter_report['matched_words']}, "
            f"missing {len(chapter_report['missing_audio_words'])}, unexpected {len(chapter_report['unexpected_ocr_words'])}"
        )
    return 1 if report["pages_with_issues"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
