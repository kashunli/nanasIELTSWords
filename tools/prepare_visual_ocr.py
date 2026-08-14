"""Prepare a local, page-by-page GPT-vision OCR queue without calling any API."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BOOK_ID = "ielts-vocabulary-true-script"
OCR_METHOD = "gpt-native-vision"
PROMPT_VERSION = "gpt-book-ocr-v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def artifact_dir(root: Path) -> Path:
    return root / "content" / "book-sources" / BOOK_ID


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def write_blank_record(page: dict[str, Any], output_path: Path) -> None:
    metadata = {
        "pdf_page": page["pdf_page"],
        "book_page": page.get("book_page"),
        "page_type": "blank",
        "ocr_method": "not_applicable",
        "prompt_version": PROMPT_VERSION,
        "pictures_omitted": True,
        "raw_response": None,
        "needs_review": False,
        "review_reasons": [],
    }
    frontmatter = "---\n" + "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in metadata.items()) + "\n---\n"
    body = json.dumps({"page_kind": "blank", "text": ""}, ensure_ascii=False, indent=2) + "\n"
    write_atomic(output_path, frontmatter + body)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--image-dir", type=Path, default=None)
    parser.add_argument("--ocr-dir", type=Path, default=None)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.project_root.resolve()
    base = artifact_dir(root)
    manifest_path = (args.manifest or (base / "book_manifest.json")).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_dir = (args.image_dir or (root / "work" / "ielts_ocr" / "pages_200dpi")).resolve()
    ocr_dir = (args.ocr_dir or (base / "page-ocr")).resolve()
    ocr_dir.mkdir(parents=True, exist_ok=True)

    start = max(1, args.start)
    end = min(len(manifest["pages"]), args.end or len(manifest["pages"]))
    if start > end:
        raise SystemExit(f"invalid page range: {start}-{end}")

    queue_pages: list[dict[str, Any]] = []
    completed: list[int] = []
    blank: list[int] = []
    pending: list[int] = []
    for page in manifest["pages"]:
        number = int(page["pdf_page"])
        if not start <= number <= end:
            continue
        image_path = image_dir / f"page_{number:04d}.png"
        output_path = ocr_dir / f"page_{number:04d}.md"
        if not image_path.exists():
            raise SystemExit(f"missing rendered image for PDF page {number}: {image_path}")
        if page["page_type"] == "blank":
            blank.append(number)
            if args.force or not output_path.exists():
                write_blank_record(page, output_path)
            completed.append(number)
            status = "blank"
        elif output_path.exists() and not args.force:
            completed.append(number)
            status = "completed"
        else:
            pending.append(number)
            status = "pending_visual_transcription"
        queue_pages.append(
            {
                "pdf_page": number,
                "book_page": page.get("book_page"),
                "page_type": page["page_type"],
                "chapter": page.get("chapter"),
                "chapter_title": page.get("chapter_title"),
                "image_path": str(image_path),
                "output_path": str(output_path),
                "status": status,
            }
        )

    queue = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "ocr_method": OCR_METHOD,
        "prompt_version": PROMPT_VERSION,
        "outside_api_used": False,
        "instructions": "Use view_image on each local image and author one page record in visual reading order.",
        "pages": queue_pages,
        "generated_at": now(),
    }
    progress = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "ocr_method": OCR_METHOD,
        "prompt_version": PROMPT_VERSION,
        "outside_api_used": False,
        "updated_at": now(),
        "requested_range": [start, end],
        "completed_pages": sorted(completed),
        "skipped_blank_pages": sorted(blank),
        "pending_visual_pages": sorted(pending),
        "failed_pages": [],
    }
    write_atomic(base / "visual_ocr_queue.json", json.dumps(queue, ensure_ascii=False, indent=2) + "\n")
    write_atomic(base / "visual_ocr_progress.json", json.dumps(progress, ensure_ascii=False, indent=2) + "\n")
    print(f"prepared PDF pages {start}-{end}: {len(completed)} already complete/blank, {len(pending)} pending visual transcription")
    print(f"queue: {base / 'visual_ocr_queue.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
