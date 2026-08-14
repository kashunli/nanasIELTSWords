"""Rerun only selected low-confidence items with a larger Whisper model."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\x00", " ")).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def transcribe(model, path: Path) -> dict[str, object]:
    segments, info = model.transcribe(str(path), language="en", beam_size=5, temperature=0.0, condition_on_previous_text=False, vad_filter=False)
    parts = []
    logprobs = []
    for segment in segments:
        parts.append(segment.text)
        if segment.avg_logprob is not None: logprobs.append(float(segment.avg_logprob))
    return {
        "raw_text": normalize(" ".join(parts)),
        "avg_logprob": sum(logprobs) / len(logprobs) if logprobs else None,
        "no_speech_prob": float(getattr(info, "no_speech_prob", 0.0) or 0.0),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="medium")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--start-index", type=int, default=0, help="0-based candidate index to include")
    parser.add_argument("--end-index", type=int, default=None, help="exclusive candidate index to include")
    parser.add_argument("--output-name", default="pass-large.jsonl", help="JSONL filename under content/asr-runs")
    parser.add_argument("--cpu-threads", type=int, default=0, help="faster-whisper CPU threads; 0 lets CTranslate2 choose")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    content = root / "content" / "BV1AT4y1579F"
    selected_path = content / "selected-transcripts.jsonl"
    selected = [json.loads(line) for line in selected_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    candidates = [record for record in selected if record["review_reasons"]]
    if args.limit is not None: candidates = candidates[:args.limit]
    start_index = max(0, args.start_index)
    end_index = len(candidates) if args.end_index is None else min(len(candidates), args.end_index)
    if start_index > end_index:
        raise SystemExit(f"invalid candidate range {start_index}:{end_index}")
    candidates = candidates[start_index:end_index]
    from faster_whisper import WhisperModel
    model_name = args.model
    if not Path(model_name).exists():
        # The normal HF cache uses symlinks, which may be unavailable on a
        # Windows developer machine.  local_dir downloads ordinary files into
        # our disposable project work area instead.
        from huggingface_hub import snapshot_download
        repo_id = f"Systran/faster-whisper-{model_name}"
        model_name = snapshot_download(
            repo_id,
            local_dir=root / "work" / "models" / f"faster-whisper-{args.model}",
            max_workers=4,
        )
    model_kwargs = {"device": "cpu", "compute_type": "int8"}
    if args.cpu_threads > 0:
        model_kwargs["cpu_threads"] = args.cpu_threads
    model = WhisperModel(model_name, **model_kwargs)
    output_path = content / "asr-runs" / args.output_name
    existing = {json.loads(line)["stable_id"]: json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines() if line.strip()} if output_path.exists() else {}
    for index, record in enumerate(candidates, start=1):
        word_path = root / "var" / "content" / "media" / record["word_audio"]["path"]
        sentence_path = root / "var" / "content" / "media" / record["sentence_audio"]["path"]
        if record["stable_id"] in existing and existing[record["stable_id"]].get("word_audio_sha256") == sha256(word_path) and existing[record["stable_id"]].get("sentence_audio_sha256") == sha256(sentence_path):
            continue
        word = transcribe(model, word_path)
        sentence = transcribe(model, sentence_path)
        existing[record["stable_id"]] = {
            "schema_version": 1,
            "stable_id": record["stable_id"],
            "item_uuid": record["item_uuid"],
            "chapter": record["chapter"],
            "position": record["position"],
            "model": f"faster-whisper-{args.model}-review",
            "word": word,
            "sentence": sentence,
            "word_audio_sha256": sha256(word_path),
            "sentence_audio_sha256": sha256(sentence_path),
            "review_reasons": record["review_reasons"],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        ordered = [existing[key] for key in (item["stable_id"] for item in candidates) if key in existing]
        output_path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in ordered), encoding="utf-8")
        print(f"[{index}/{len(candidates)}] {record['stable_id']}", flush=True)
    print(f"wrote {len(existing)} review ASR records to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
