"""Select a deterministic transcript pair from the available Whisper passes."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from content_repairs import load_repair_plan, load_source_items, repair_entries_by_item


def load(path: Path) -> dict[str, dict]:
    if not path.exists(): return {}
    return {record["stable_id"]: record for record in (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())}


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def score(record: dict) -> tuple[int, int, float]:
    """Rank safer candidates first, then prefer the less uncertain decode.

    ``avg_logprob`` is higher for a more confident Whisper decode.  The
    selector uses ``min`` so the final component is negated; returning the
    raw value here would accidentally choose the *lowest* confidence pair
    whenever two candidates had the same review flags.
    """
    reasons = record.get("review_reasons", [])
    fatal = sum("blank_" in reason or "high_no_speech" in reason for reason in reasons)
    word_lp = record.get("word", {}).get("avg_logprob") or -10.0
    sentence_lp = record.get("sentence", {}).get("avg_logprob") or -10.0
    return fatal, len(reasons), -(word_lp + sentence_lp)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.project_root.resolve()
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    source_items = load_source_items(content)
    repair_plan = load_repair_plan(content)
    repair_index = repair_entries_by_item(repair_plan)
    small = load(content / "asr-runs" / "pass-small.jsonl")
    large = load(content / "asr-runs" / "pass-large.jsonl")
    source_ids = {item["stable_id"] for item in source_items}
    if not small: raise SystemExit("no small-model ASR records found")
    output = []
    for source_item in source_items:
        sid = source_item["stable_id"]
        repair_entry = repair_index.get(sid)
        inserted_repair = repair_entry.get("inserted_repair") if repair_entry else None
        existing_repairs = repair_entry.get("existing_repairs", []) if repair_entry else []
        asr_source_id = str(inserted_repair.get("asr_source_stable_id")) if inserted_repair and inserted_repair.get("asr_source_stable_id") else sid
        candidates = [record for record in (small.get(asr_source_id), large.get(asr_source_id)) if record]
        if not candidates: raise SystemExit(f"missing ASR record: {sid}")
        selected = min(candidates, key=score)
        raw_cut = source_item["raw_cut"]
        reasons = list(raw_cut.get("flags", []))
        reasons.extend(selected.get("review_reasons", []))
        headword = selected["word"]["raw_text"].strip()
        sentence = selected["sentence"]["raw_text"].strip()
        repair_evidence = None
        if existing_repairs:
            existing_repair = existing_repairs[-1]
            existing = existing_repair.get("existing_item") or {}
            if existing.get("headword"):
                headword = str(existing["headword"]).strip()
            if existing.get("sentence"):
                sentence = str(existing["sentence"]).strip()
            repair_evidence = {
                "repair_ids": [str(repair.get("repair_id") or repair_plan.get("repair_id") or "audio-repair") for repair in existing_repairs],
                "role": "existing",
                "asr_source_stable_id": existing_repair.get("asr_source_stable_id") or asr_source_id,
                "raw_asr_sentence": selected["sentence"]["raw_text"].strip(),
            }
        if inserted_repair:
            inserted = inserted_repair["inserted_item"]
            headword = str(inserted["headword"]).strip()
            sentence = str(inserted["sentence"]).strip()
            reasons.extend(inserted.get("review_reasons", []))
            repair_evidence = {
                "repair_ids": [str(repair.get("repair_id") or repair_plan.get("repair_id") or "audio-repair") for repair in ([inserted_repair] + existing_repairs)],
                "role": "inserted",
                "asr_source_stable_id": asr_source_id,
                "raw_asr_headword": selected["word"]["raw_text"].strip(),
                "raw_asr_sentence": selected["sentence"]["raw_text"].strip(),
            }
        if headword and sentence and normalize(headword) not in normalize(sentence): reasons.append("headword_not_found_in_sentence")
        record = {
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
        }
        if repair_evidence:
            record["audio_repair"] = repair_evidence
            if inserted_repair:
                record["selected_model"] = "source-audio-repair"
                record["raw_asr_source_stable_id"] = asr_source_id
        output.append(record)
    destination = content / "selected-transcripts.jsonl"
    destination.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in output), encoding="utf-8")
    print(f"selected {len(output)} transcripts; review={sum(record['transcript_status'] == 'needs_review' for record in output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
