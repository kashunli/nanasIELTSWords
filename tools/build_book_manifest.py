"""Build a provenance-first page manifest for the scanned IELTS vocabulary book."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import fitz


BOOK_ID = "ielts-vocabulary-true-script"
PDF_FILENAME = "IELTS雅思词汇真经 (刘洪波) (z-lib.org).pdf"
PRINTED_PAGE_OFFSET = 11
LAST_CONTENT_PAGE = 311
INDEX_FIRST_PDF_PAGE = 323
INDEX_LAST_PDF_PAGE = 335

CHAPTERS = [
    (1, "自然地理", 1),
    (2, "植物研究", 21),
    (3, "动物保护", 31),
    (4, "太空探索", 45),
    (5, "学校教育", 53),
    (6, "科技发明", 85),
    (7, "文化历史", 95),
    (8, "语言演化", 103),
    (9, "娱乐运动", 109),
    (10, "物品材料", 123),
    (11, "时尚潮流", 135),
    (12, "饮食健康", 145),
    (13, "建筑场所", 159),
    (14, "交通旅行", 171),
    (15, "国家政府", 183),
    (16, "社会经济", 197),
    (17, "法律法规", 213),
    (18, "沙场争锋", 223),
    (19, "社会角色", 241),
    (20, "行为动作", 253),
    (21, "身心健康", 275),
    (22, "时间日期", 307),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def scanned_nonwhite_ratio(page: fitz.Page) -> float:
    """Estimate whether a scanned page is blank without saving another image."""
    pixmap = page.get_pixmap(matrix=fitz.Matrix(0.25, 0.25), colorspace=fitz.csGRAY, alpha=False)
    samples = pixmap.samples
    if not samples:
        return 0.0
    return sum(value < 245 for value in samples) / len(samples)


def chapter_for_book_page(book_page: int) -> tuple[int, str] | None:
    current: tuple[int, str] | None = None
    for number, title, start_page in CHAPTERS:
        if book_page >= start_page:
            current = (number, title)
        else:
            break
    return current


def load_audio_counts(root: Path) -> dict[int, int]:
    path = root / "content" / "BV1AT4y1579F" / "selected-transcripts.jsonl"
    if not path.exists():
        return {}
    counts: Counter[int] = Counter()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        counts[int(record["chapter"])] += 1
    return dict(sorted(counts.items()))


def page_record(pdf_page: int, page_type: str, book_page: int | None = None, **extra: object) -> dict:
    record: dict[str, object] = {
        "pdf_page": pdf_page,
        "book_page": book_page,
        "page_type": page_type,
        "pictures_omitted": page_type in {"vocabulary", "chapter_opener", "back_cover"},
    }
    record.update(extra)
    return record


def build_manifest(root: Path, pdf_path: Path) -> dict:
    document = fitz.open(pdf_path)
    if document.page_count != 336:
        raise SystemExit(f"unexpected PDF page count: {document.page_count}; expected 336")

    pages: list[dict] = []
    for pdf_page in range(1, document.page_count + 1):
        if pdf_page == 1:
            pages.append(page_record(pdf_page, "front_cover"))
        elif pdf_page == 2:
            pages.append(page_record(pdf_page, "title_page"))
        elif pdf_page == 3:
            pages.append(page_record(pdf_page, "copyright"))
        elif 4 <= pdf_page <= 8:
            pages.append(page_record(pdf_page, "preface"))
        elif pdf_page in {9, 11}:
            pages.append(page_record(pdf_page, "blank"))
        elif pdf_page == 10:
            pages.append(page_record(pdf_page, "table_of_contents"))
        elif 12 <= pdf_page <= 322:
            book_page = pdf_page - PRINTED_PAGE_OFFSET
            chapter = chapter_for_book_page(book_page)
            if chapter is None:
                raise SystemExit(f"could not infer chapter for printed page {book_page}")
            number, title = chapter
            if book_page == CHAPTERS[number - 1][2]:
                page_type = "chapter_opener"
            elif scanned_nonwhite_ratio(document.load_page(pdf_page - 1)) < 0.01:
                page_type = "blank"
            else:
                page_type = "vocabulary"
            pages.append(
                page_record(
                    pdf_page,
                    page_type,
                    book_page,
                    chapter=number,
                    chapter_title=title,
                    printed_page_label=book_page,
                )
            )
        elif INDEX_FIRST_PDF_PAGE <= pdf_page <= INDEX_LAST_PDF_PAGE:
            pages.append(page_record(pdf_page, "index", pdf_page - PRINTED_PAGE_OFFSET, printed_page_label=pdf_page - PRINTED_PAGE_OFFSET))
        elif pdf_page == 336:
            pages.append(page_record(pdf_page, "back_cover"))
        else:
            raise SystemExit(f"unclassified PDF page: {pdf_page}")

    type_counts = Counter(page["page_type"] for page in pages)
    chapter_counts = load_audio_counts(root)
    output_dir = root / "content" / "book-sources" / BOOK_ID
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "title": "IELTS雅思词汇真经",
        "author": "刘洪波",
        "edition_note": "Foreign Language Teaching and Research Press, 2018.10 (2018.11 reprint)",
        "source_pdf": {
            "filename": pdf_path.name,
            "relative_path": str(pdf_path.relative_to(root)),
            "sha256": sha256(pdf_path),
            "pdf_page_count": document.page_count,
            "printed_page_offset": PRINTED_PAGE_OFFSET,
        },
        "ocr_policy": {
            "method": "gpt-native-vision",
            "prompt_version": "gpt-book-ocr-v1",
            "render_dpi": 200,
            "pictures_omitted": True,
            "preserve_printed_labels": True,
            "preserve_uncertainty": True,
        },
        "chapters": [
            {
                "chapter": number,
                "title": title,
                "printed_start_page": start_page,
                "pdf_start_page": start_page + PRINTED_PAGE_OFFSET,
                "audio_item_count": chapter_counts.get(number),
            }
            for number, title, start_page in CHAPTERS
        ],
        "page_type_counts": dict(sorted(type_counts.items())),
        "pages": pages,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    output_path = output_dir / "book_manifest.json"
    output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {output_path}")
    print(f"pages: {document.page_count}; types: {dict(sorted(type_counts.items()))}")
    print(f"blank scanned pages: {[page['pdf_page'] for page in pages if page['page_type'] == 'blank']}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--pdf", type=Path, default=None)
    args = parser.parse_args()
    root = args.project_root.resolve()
    pdf_path = (args.pdf or (root / PDF_FILENAME)).resolve()
    if not pdf_path.is_file():
        raise SystemExit(f"missing source PDF: {pdf_path}")
    build_manifest(root, pdf_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
