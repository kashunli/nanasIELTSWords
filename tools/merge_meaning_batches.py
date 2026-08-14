"""Validate and merge completed Luna/Codex meaning batch JSON files."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    input_dir = root / "work" / "meaning-batches" / "input"
    output_dir = root / "work" / "meaning-batches" / "accepted"
    output_dir.mkdir(parents=True, exist_ok=True)
    selected = {record["stable_id"] for record in (json.loads(line) for line in (content / "selected-transcripts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip())}
    merged: dict[str, dict] = {}
    for input_path in sorted(input_dir.glob("batch-*.json")):
        accepted_path = output_dir / input_path.name
        if not accepted_path.exists():
            raise SystemExit(f"missing accepted meaning batch: {accepted_path}")
        payload = json.loads(accepted_path.read_text(encoding="utf-8"))
        expected_digest = sha256(input_path)
        if payload.get("input_sha256") != expected_digest:
            raise SystemExit(f"meaning input digest mismatch: {accepted_path}")
        expected = {item["stable_id"] for item in json.loads(input_path.read_text(encoding="utf-8"))["items"]}
        actual = {item.get("stable_id") for item in payload.get("items", [])}
        if expected != actual: raise SystemExit(f"meaning ID mismatch: {accepted_path}")
        for item in payload["items"]:
            if item["stable_id"] not in selected: raise SystemExit(f"unknown meaning ID: {item['stable_id']}")
            if not all(str(item.get(key, "")).strip() for key in ("part_of_speech", "meaning_en", "meaning_zh")):
                raise SystemExit(f"empty meaning field: {item['stable_id']}")
            if item["stable_id"] in merged: raise SystemExit(f"duplicate meaning ID: {item['stable_id']}")
            merged[item["stable_id"]] = {**item, "meaning_status": item.get("meaning_status", "ai_draft")}
    if set(merged) != selected: raise SystemExit(f"meaning coverage mismatch: have {len(merged)}, need {len(selected)}")
    destination = content / "meanings.jsonl"
    destination.write_text("".join(json.dumps(merged[key], ensure_ascii=False) + "\n" for key in sorted(merged)), encoding="utf-8")
    print(f"merged {len(merged)} meanings into {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
