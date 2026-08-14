"""Qwen3.7-Flash page-by-page OCR for the IELTS vocabulary book."""

from __future__ import annotations

import argparse
import base64
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import dashscope


MODEL = "qwen3.7-flash"
PROMPT_VERSION = "qwen3.7-flash-book-page-v2-exact-schema"
API_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def jsonable(value: Any) -> Any:
    if isinstance(value, (dict, list, str, int, float, bool)) or value is None:
        return value
    for name in ("to_dict", "model_dump"):
        method = getattr(value, name, None)
        if callable(method):
            try:
                return method()
            except Exception:
                pass
    return {"repr": repr(value)}


def extract_text(response: Any) -> tuple[str, str | None]:
    output = getattr(response, "output", None)
    if not isinstance(output, dict):
        raise RuntimeError(f"Qwen response has no output: {response!r}")
    choices = output.get("choices") or []
    if not choices:
        raise RuntimeError(f"Qwen response has no choices: {output!r}")
    choice = choices[0]
    content = (choice.get("message") or {}).get("content") or []
    texts = [item["text"] for item in content if isinstance(item, dict) and item.get("text")]
    if not texts:
        raise RuntimeError(f"Qwen response has no text: {output!r}")
    return "\n".join(texts).strip(), choice.get("finish_reason")


def parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    fence = chr(96) * 3
    if text.startswith(fence):
        text = text[len(fence):].lstrip()
        if text.startswith("json"):
            text = text[4:].lstrip()
        if text.endswith(fence):
            text = text[:-len(fence)].rstrip()
    return json.loads(text)


def prompt(page: dict[str, Any]) -> str:
    if page["page_type"] == "chapter_opener":
        layout = (
            "This is a chapter opener. Preserve the English and Chinese quote "
            "and the printed vocabulary labels in image_labels. Omit the illustration."
        )
        shape = "Use quote_en, quote_zh, image_labels, entries, and page_notes."
    else:
        layout = (
            "Read a vocabulary page in printed order: left column top-to-bottom, "
            "then right column top-to-bottom. Preserve every entry."
        )
        shape = (
            "Use entries with headword, ipa, part_of_speech, meaning_zh, example_en, "
            "example_zh, collocations, word_formation, and notes."
        )
    return f"""Transcribe this scanned IELTS vocabulary book page exactly.
Return one valid JSON object only, with no commentary and no Markdown fences.
Use exactly one top-level key named entries for vocabulary items. Do not add content, footer, or duplicate entries keys.
Every visible vocabulary item must be an object in entries, including an item after a continuation fragment.
Every entry must contain all nine requested keys; use an empty string when a field is not printed, but never omit part_of_speech.
PDF page {page['pdf_page']}; printed page {page['book_page']}; chapter {page['chapter']} {page['chapter_title']}.
{layout}
{shape}
Pictures may be omitted, but printed labels must be retained separately.
Copy the visible wording literally. Do not infer, paraphrase, normalize, or improve a sentence even when it seems grammatically incomplete or semantically unusual.
Do not add Markdown bold markers around headwords in examples. Use [unclear] only for genuinely unreadable text.
If an example or note continues onto another page, preserve the visible fragment and explain the continuation in page_notes; do not drop the entry or invent the missing part.
Keep page_notes for layout or cross-page continuation facts."""


def front_matter(page: dict[str, Any], model: str, raw_path: str, record: dict[str, Any]) -> str:
    serialized = json.dumps(record, ensure_ascii=False)
    review = "[unclear]" in serialized
    metadata = {
        "pdf_page": page["pdf_page"],
        "book_page": page["book_page"],
        "page_type": page["page_type"],
        "chapter": page["chapter"],
        "chapter_title": page["chapter_title"],
        "ocr_method": model,
        "prompt_version": PROMPT_VERSION,
        "pictures_omitted": True,
        "raw_response": raw_path,
        "needs_review": review,
        "review_reasons": ["model output contains [unclear]"] if review else [],
    }
    lines = ["---"]
    lines.extend(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in metadata.items())
    lines += ["---", json.dumps(record, ensure_ascii=False, indent=2), ""]
    return "\n".join(lines)


def main() -> int:
    options = args()
    if options.start < 1 or options.end < options.start:
        raise SystemExit("invalid page range")
    root = options.project_root.resolve()
    base = root / "content/book-sources/ielts-vocabulary-true-script"
    manifest = json.loads((base / "book_manifest.json").read_text(encoding="utf-8"))
    pages = {int(page["pdf_page"]): page for page in manifest["pages"]}
    image_dir = root / "work/ielts_ocr/pages_200dpi"
    record_dir = base / "page-ocr"
    raw_dir = base / "raw-responses/qwen3.7-flash"
    api_key = os.environ.get("QWEN_TASK_API_KEY") or os.environ.get("ALIBABA_CN_API_KEY")
    if not api_key:
        raise SystemExit("Set QWEN_TASK_API_KEY or ALIBABA_CN_API_KEY first")
    dashscope.base_http_api_url = API_BASE_URL

    for pdf_page in range(options.start, options.end + 1):
        page = pages.get(pdf_page)
        if page is None:
            raise SystemExit(f"page {pdf_page} is absent from the manifest")
        image_path = image_dir / f"page_{pdf_page:04d}.png"
        record_path = record_dir / f"page_{pdf_page:04d}.md"
        raw_path = raw_dir / f"page_{pdf_page:04d}.json"
        if record_path.exists() and not options.force:
            print(f"skip existing PDF page {pdf_page}")
            continue
        image = base64.b64encode(image_path.read_bytes()).decode("ascii")
        response = dashscope.MultiModalConversation.call(
            api_key=api_key,
            model=options.model,
            messages=[{
                "role": "user",
                "content": [
                    {"image": f"data:image/png;base64,{image}"},
                    {"text": prompt(page)},
                ],
            }],
            parameters={"enable_thinking": False},
        )
        if getattr(response, "status_code", None) not in (None, 200):
            raise RuntimeError(f"Qwen failed on page {pdf_page}: {response!r}")
        text, finish_reason = extract_text(response)
        record = parse_json(text)
        record.setdefault("page_kind", page["page_type"])
        record.setdefault("entries", [])
        record.setdefault("page_notes", "")
        record_dir.mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps({
            "pdf_page": pdf_page,
            "model": options.model,
            "prompt_version": PROMPT_VERSION,
            "requested_at": datetime.now(timezone.utc).isoformat(),
            "prompt": prompt(page),
            "finish_reason": finish_reason,
            "response": jsonable(response),
            "extracted_text": text,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        record_path.write_text(front_matter(
            page, options.model, raw_path.relative_to(base).as_posix(), record
        ), encoding="utf-8")
        print(f"completed PDF page {pdf_page}: {record_path}")
        if options.pause_seconds and pdf_page < options.end:
            time.sleep(options.pause_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
