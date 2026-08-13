"""Run resumable two-pass Faster Whisper transcription for the imported clips."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\x00", " ")).strip()


def suspicious(record: dict) -> list[str]:
    reasons = list(record.get("review_reasons", []))
    word = record["word"]
    sentence = record["sentence"]
    if not word["raw_text"]: reasons.append("blank_word_transcript")
    if not sentence["raw_text"]: reasons.append("blank_sentence_transcript")
    if len(word["raw_text"].split()) > 6: reasons.append("word_has_too_many_tokens")
    if len(sentence["raw_text"].split()) < 3: reasons.append("sentence_has_too_few_tokens")
    for name, segment in (("word", word), ("sentence", sentence)):
        if segment.get("avg_logprob") is not None and segment["avg_logprob"] < -0.8: reasons.append(f"{name}_low_logprob")
        if segment.get("no_speech_prob") is not None and segment["no_speech_prob"] > 0.35: reasons.append(f"{name}_high_no_speech")
    return sorted(set(reasons))


def transcribe(model, path: Path) -> dict[str, object]:
    segments, info = model.transcribe(str(path), language="en", beam_size=5, temperature=0.0, condition_on_previous_text=False, vad_filter=False)
    parts = []
    logprobs = []
    for segment in segments:
        parts.append(segment.text)
        if segment.avg_logprob is not None: logprobs.append(float(segment.avg_logprob))
    return {"raw_text": normalize(" ".join(parts)), "avg_logprob": sum(logprobs) / len(logprobs) if logprobs else None, "no_speech_prob": float(getattr(info, "no_speech_prob", 0.0) or 0.0)}


def load_existing(path: Path) -> dict[str, dict]:
    if not path.exists(): return {}
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            result[record["stable_id"]] = record
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pass", dest="pass_name", choices=("small", "large"), default="small")
    parser.add_argument("--model", default=None, help="Override the Faster Whisper model name")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source_manifest_path = root / "content" / "BV1AT4y1579F" / "source-manifest.json"
    if not source_manifest_path.exists(): raise SystemExit("run import_cut_manifest.py first")
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    from faster_whisper import WhisperModel
    model_name = args.model or ("small" if args.pass_name == "small" else "medium")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    output_path = root / "content" / "BV1AT4y1579F" / "asr-runs" / f"pass-{args.pass_name}.jsonl"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    existing = load_existing(output_path)
    records = source_manifest["items_by_chapter"][:args.limit] if args.limit else source_manifest["items_by_chapter"]
    pending = {record["stable_id"]: record for record in records}
    for stable_id, source in pending.items():
        word_path = root / "var" / "content" / "media" / source["word_audio"]["path"]
        sentence_path = root / "var" / "content" / "media" / source["sentence_audio"]["path"]
        word_hash = sha256(word_path); sentence_hash = sha256(sentence_path)
        old = existing.get(stable_id)
        if old and old.get("word_audio_sha256") == word_hash and old.get("sentence_audio_sha256") == sentence_hash and old.get("model") == f"faster-whisper-{args.pass_name}":
            continue
        word = transcribe(model, word_path); sentence = transcribe(model, sentence_path)
        record = {"schema_version": 1, "stable_id": stable_id, "item_uuid": source["item_uuid"], "chapter": source["chapter"], "position": source["position"], "model": f"faster-whisper-{args.pass_name}", "word": word, "sentence": sentence, "word_audio_sha256": word_hash, "sentence_audio_sha256": sentence_hash, "review_reasons": [], "completed_at": datetime.now(timezone.utc).isoformat()}
        record["review_reasons"] = suspicious(record)
        existing[stable_id] = record
        ordered = [existing[key] for key in pending if key in existing]
        output_path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in ordered), encoding="utf-8")
        print(f"{stable_id} {record['review_reasons']}", flush=True)
    print(f"{args.pass_name}: {len(existing)} records available at {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
