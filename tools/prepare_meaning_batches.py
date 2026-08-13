"""Create deterministic 50-item meaning batches for Luna/Codex."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    selected_path = content / "selected-transcripts.jsonl"
    if not selected_path.exists(): raise SystemExit("run select_transcripts.py first")
    records = [json.loads(line) for line in selected_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    output = root / "work" / "meaning-batches" / "input"
    output.mkdir(parents=True, exist_ok=True)
    index = 0
    for start in range(0, len(records), args.batch_size):
        index += 1
        batch = [{"stable_id": record["stable_id"], "headword": record["headword"], "sentence": record["sentence"]} for record in records[start:start + args.batch_size]]
        payload = {"schema_version": 1, "batch": index, "items": batch}
        path = output / f"batch-{index:04d}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        (output / f"batch-{index:04d}.sha256").write_text(digest + "\n", encoding="ascii")
    print(f"prepared {index} batches for {len(records)} items under {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
