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
ALIGNMENT_LOOKAHEAD = 12


def normalize_word_forms(value: str) -> set[str]:
    """Return the base word and printed spelling aliases for matching."""
    value = unicodedata.normalize("NFKD", value or "").casefold()
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = value.replace("’", "'")
    aliases = re.findall(r"\((?:=|or)?\s*([^)]*)\)", value)
    base = re.sub(r"\([^)]*\)", "", value)
    forms = [base, *aliases]
    return {
        " ".join(re.sub(r"[^a-z0-9]+", " ", form).split())
        for form in forms
        if re.sub(r"[^a-z0-9]+", " ", form).strip()
    }


def normalize_sentence(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "").casefold()
    value = "".join(character for character in value if not unicodedata.combining(character))
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


def _find_anchor(word: dict[str, Any], audio_records: list[dict[str, Any]], start: int) -> tuple[int, str] | None:
    sentence = normalize_sentence(str(word.get("example_en", "")))
    if sentence:
        for candidate_index in range(start, min(len(audio_records), start + ALIGNMENT_LOOKAHEAD)):
            if sentence == normalize_sentence(str(audio_records[candidate_index].get("sentence", ""))):
                return candidate_index, "sentence"

    forms = normalize_word_forms(str(word.get("headword", "")))
    for candidate_index in range(start, min(len(audio_records), start + ALIGNMENT_LOOKAHEAD)):
        if forms & normalize_word_forms(str(audio_records[candidate_index].get("headword", ""))):
            return candidate_index, "headword"
    return None


def _clear_alignment(word: dict[str, Any]) -> None:
    for key in ("stable_id", "item_uuid", "audio_position", "audio_headword", "alignment_status", "alignment_evidence", "sentence_match"):
        word.pop(key, None)


def _assign(word: dict[str, Any], audio: dict[str, Any], status: str, evidence: str) -> None:
    word["stable_id"] = audio["stable_id"]
    word["item_uuid"] = audio["item_uuid"]
    word["audio_position"] = audio["position"]
    word["audio_headword"] = audio["headword"]
    word["alignment_status"] = status
    word["alignment_evidence"] = evidence
    book_sentence = str(word.get("example_en", ""))
    audio_sentence = str(audio.get("sentence", ""))
    if book_sentence.strip() == audio_sentence.strip():
        word["sentence_match"] = "exact"
    elif normalize_sentence(book_sentence) == normalize_sentence(audio_sentence):
        word["sentence_match"] = "normalized"
    else:
        word["sentence_match"] = "different"


def align_chapter(ocr_words: list[dict[str, Any]], audio_records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Align OCR and audio in order, using only bounded, evidence-backed gaps.

    Exact sentence and headword/alias matches create monotonic anchors. A gap is
    filled by order only when the OCR and audio sides contain the same number of
    records between two anchors. This is what lets a reliable book word repair
    an ASR spelling such as ``Plato.`` -> ``plateau`` without shifting every
    later item when a page contains an extra or missing entry.
    """
    for word in ocr_words:
        _clear_alignment(word)

    anchors: list[tuple[int, int, str]] = []
    cursor = 0
    for ocr_index, word in enumerate(ocr_words):
        anchor = _find_anchor(word, audio_records, cursor)
        if anchor is None:
            continue
        audio_index, evidence = anchor
        anchors.append((ocr_index, audio_index, evidence))
        cursor = audio_index + 1

    assigned_audio: set[int] = set()
    assigned_ocr: set[int] = set()
    matched_by_evidence = {"headword": 0, "sentence": 0, "order": 0}
    for ocr_index, audio_index, evidence in anchors:
        word = ocr_words[ocr_index]
        audio = audio_records[audio_index]
        status = "matched_headword" if evidence == "headword" else "matched_sentence"
        _assign(word, audio, status, evidence)
        assigned_ocr.add(ocr_index)
        assigned_audio.add(audio_index)
        matched_by_evidence[evidence] += 1

    boundaries = [(-1, -1, "start"), *anchors, (len(ocr_words), len(audio_records), "end")]
    previous_ocr = -1
    previous_audio = -1
    for next_ocr, next_audio, _ in boundaries[1:]:
        ocr_indices = list(range(previous_ocr + 1, next_ocr))
        audio_indices = list(range(previous_audio + 1, next_audio))
        if len(ocr_indices) == len(audio_indices):
            for ocr_index, audio_index in zip(ocr_indices, audio_indices):
                if ocr_index in assigned_ocr or audio_index in assigned_audio:
                    continue
                _assign(ocr_words[ocr_index], audio_records[audio_index], "matched_order", "order")
                assigned_ocr.add(ocr_index)
                assigned_audio.add(audio_index)
                matched_by_evidence["order"] += 1
        previous_ocr = next_ocr
        previous_audio = next_audio

    aligned: list[dict[str, Any]] = []
    unexpected: list[dict[str, Any]] = []
    for index, word in enumerate(ocr_words):
        if index not in assigned_ocr:
            word["alignment_status"] = "unmatched_ocr_word"
            unexpected.append({"ocr_word_id": word["book_word_id"], "headword": word["headword"]})
        aligned.append(word)

    gaps = [
        {"stable_id": audio["stable_id"], "headword": audio["headword"], "position": audio["position"]}
        for index, audio in enumerate(audio_records)
        if index not in assigned_audio
    ]
    return aligned, {
        "expected_audio_words": len(audio_records),
        "ocr_words": len(ocr_words),
        "matched_words": len(assigned_ocr),
        "matched_by_headword": matched_by_evidence["headword"],
        "matched_by_sentence": matched_by_evidence["sentence"],
        "matched_by_order": matched_by_evidence["order"],
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
