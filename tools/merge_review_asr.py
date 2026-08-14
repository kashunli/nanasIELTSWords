"""Merge range-partitioned large-model ASR review JSONL files safely."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--input", dest="inputs", action="append", required=True, help="ASR part filename or path; repeat for every slice")
    parser.add_argument("--output-name", default="pass-large.jsonl")
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    selected_path = content / "selected-transcripts.jsonl"
    selected = [json.loads(line) for line in selected_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    candidates = [record for record in selected if record.get("review_reasons")]
    expected_order = [record["stable_id"] for record in candidates]
    expected = set(expected_order)
    merged: dict[str, dict] = {}
    for value in args.inputs:
        input_path = Path(value)
        if not input_path.is_absolute():
            input_path = content / "asr-runs" / input_path
        if not input_path.exists():
            raise SystemExit(f"missing review input: {input_path}")
        for line in input_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            stable_id = record.get("stable_id")
            if stable_id not in expected:
                raise SystemExit(f"review record is not a flagged selected item: {stable_id}")
            if stable_id in merged:
                raise SystemExit(f"duplicate review record: {stable_id}")
            for field, key in (("word_audio_sha256", "word_audio"), ("sentence_audio_sha256", "sentence_audio")):
                media_path = root / "var" / "content" / "media" / next(item[key]["path"] for item in selected if item["stable_id"] == stable_id)
                if record.get(field) != sha256(media_path):
                    raise SystemExit(f"audio hash mismatch for {stable_id}: {field}")
            merged[stable_id] = record
    if set(merged) != expected:
        missing = len(expected - set(merged))
        extra = len(set(merged) - expected)
        raise SystemExit(f"review coverage mismatch: missing={missing}, extra={extra}")
    output_path = content / "asr-runs" / args.output_name
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text("".join(json.dumps(merged[stable_id], ensure_ascii=False) + "\n" for stable_id in expected_order), encoding="utf-8")
    temporary.replace(output_path)
    print(f"merged {len(merged)} review ASR records into {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
