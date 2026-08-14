"""Render the scanned IELTS vocabulary PDF to deterministic page images."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import fitz


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--pdf", type=Path, default=None)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = args.project_root.resolve()
    manifest_path = (args.manifest or (root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_manifest.json")).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pdf_path = (args.pdf or (root / manifest["source_pdf"]["relative_path"])).resolve()
    out_dir = (args.out or (root / "work" / "ielts_ocr" / "pages_200dpi")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    document = fitz.open(pdf_path)
    if document.page_count != manifest["source_pdf"]["pdf_page_count"]:
        raise SystemExit("PDF page count does not match book manifest")
    start = max(1, args.start)
    end = min(document.page_count, args.end or document.page_count)
    if start > end:
        raise SystemExit(f"invalid page range: {start}-{end}")

    rendered = 0
    kept = 0
    matrix = fitz.Matrix(args.dpi / 72, args.dpi / 72)
    for pdf_page in range(start, end + 1):
        target = out_dir / f"page_{pdf_page:04d}.png"
        if target.exists() and not args.force:
            kept += 1
            continue
        pixmap = document.load_page(pdf_page - 1).get_pixmap(matrix=matrix, alpha=False)
        pixmap.save(target)
        rendered += 1
    print(f"rendered {rendered} pages; kept {kept}; output {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
