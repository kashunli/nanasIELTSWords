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


def sentence_tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", value.lower()))


def load_review_resolutions(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("decisions"), list):
        raise SystemExit(f"invalid ASR review manifest: {path}")
    result: dict[str, dict] = {}
    required = {"stable_id", "asr_headword", "sentence_evidence", "reason", "basis"}
    for decision in payload["decisions"]:
        if not required.issubset(decision):
            raise SystemExit(f"incomplete ASR review decision: {decision}")
        stable_id = decision["stable_id"]
        if stable_id in result:
            raise SystemExit(f"duplicate ASR review decision: {stable_id}")
        result[stable_id] = decision
    return result


def resolve_review_reason(record: dict, reasons: list[str], decision: dict | None) -> list[dict]:
    if decision is None:
        return []
    headword = record["headword"].strip()
    if len(headword.split()) != 1:
        raise SystemExit(f"ASR review decision is not for a single-word headword: {record['stable_id']}")
    if headword != decision["asr_headword"]:
        raise SystemExit(
            f"ASR review headword changed for {record['stable_id']}: "
            f"expected {decision['asr_headword']!r}, got {record['headword']!r}"
        )
    reason = decision["reason"]
    if reason not in reasons:
        raise SystemExit(f"ASR review reason is no longer present for {record['stable_id']}: {reason}")
    evidence = decision["sentence_evidence"].strip().lower()
    if len(evidence.split()) != 1 or evidence not in sentence_tokens(record["sentence"]):
        raise SystemExit(f"ASR sentence evidence is not present for {record['stable_id']}: {evidence!r}")
    reasons[:] = [value for value in reasons if value != reason]
    return [{"reason": reason, "sentence_evidence": evidence, "basis": decision["basis"]}]


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
    small = load(content / "asr-runs" / "pass-small.jsonl")
    large = load(content / "asr-runs" / "pass-large.jsonl")
    review_resolutions = load_review_resolutions(root / "docs" / "asr-tag-review.json")
    source_ids = {item["stable_id"] for item in source["items_by_chapter"]}
    unknown_review_ids = set(review_resolutions) - source_ids
    if unknown_review_ids:
        raise SystemExit(f"ASR review manifest contains unknown stable IDs: {sorted(unknown_review_ids)}")
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
        resolutions = resolve_review_reason({"stable_id": sid, "headword": headword, "sentence": sentence}, reasons, review_resolutions.get(sid))
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
            "review_resolutions": resolutions,
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
