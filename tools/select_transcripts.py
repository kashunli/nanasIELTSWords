"""Select a deterministic transcript pair from the available Whisper passes."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def load(path: Path) -> dict[str, dict]:
    if not path.exists(): return {}
    return {record["stable_id"]: record for record in (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())}


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def score(record: dict) -> tuple[int, int, float]:
    reasons = record.get("review_reasons", [])
    fatal = sum("blank_" in reason or "high_no_speech" in reason for reason in reasons)
    word_lp = record.get("word", {}).get("avg_logprob") or -10.0
    sentence_lp = record.get("sentence", {}).get("avg_logprob") or -10.0
    return fatal, len(reasons), word_lp + sentence_lp


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    small = load(content / "asr-runs" / "pass-small.jsonl")
    large = load(content / "asr-runs" / "pass-large.jsonl")
    if not small: raise SystemExit("no small-model ASR records found")
    output = []
    for source_item in source["items_by_chapter"]:
        sid = source_item["stable_id"]
        candidates = [record for record in (small.get(sid), large.get(sid)) if record]
        if not candidates: raise SystemExit(f"missing ASR record: {sid}")
        selected = min(candidates, key=score)
        raw_cut = source_item["raw_cut"]
        reasons = list(raw_cut.get("flags", []))
        reasons.extend(selected.get("review_reasons", []))
        headword = selected["word"]["raw_text"].strip()
        sentence = selected["sentence"]["raw_text"].strip()
        if headword and sentence and normalize(headword) not in normalize(sentence): reasons.append("headword_not_found_in_sentence")
        output.append({
            "schema_version": 1,
            "stable_id": sid,
            "item_uuid": source_item["item_uuid"],
            "chapter": source_item["chapter"],
            "position": source_item["position"],
            "headword": headword,
            "sentence": sentence,
            "selected_model": selected["model"],
            "transcript_status": "needs_review" if reasons else "candidate",
            "review_reasons": sorted(set(reasons)),
            "word_audio": source_item["word_audio"],
            "sentence_audio": source_item["sentence_audio"],
            "raw_asr_candidates": [{"model": candidate["model"], "word": candidate["word"], "sentence": candidate["sentence"]} for candidate in candidates],
        })
    destination = content / "selected-transcripts.jsonl"
    destination.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in output), encoding="utf-8")
    print(f"selected {len(output)} transcripts; review={sum(record['transcript_status'] == 'needs_review' for record in output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
