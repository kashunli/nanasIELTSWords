"""Transcribe each original chapter once and map timestamped ASR to cut items.

The audio cutter already records raw item intervals. A chapter-level Whisper
pass avoids launching thousands of model invocations while retaining separate
word and sentence text for every stable item. Individual suspicious clips can
then be rerun with ``transcribe_audio.py --pass large``.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\x00", " ")).strip()


def overlap(start: float, end: float, left: float, right: float) -> bool:
    return start < right and end > left


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pass", dest="pass_name", choices=("small", "large"), default="small")
    parser.add_argument("--model", default=None)
    parser.add_argument("--chapter", type=int, action="append")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    content = root / "content" / "BV1AT4y1579F"
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    from faster_whisper import WhisperModel
    model_name = args.model or ("small" if args.pass_name == "small" else "medium")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    output = content / "asr-runs" / f"pass-{args.pass_name}.jsonl"
    existing = {json.loads(line)["stable_id"]: json.loads(line) for line in output.read_text(encoding="utf-8").splitlines() if line.strip()} if output.exists() else {}
    wanted = set(args.chapter or [])
    by_chapter: dict[int, list[dict]] = {}
    for item in source["items_by_chapter"]: by_chapter.setdefault(int(item["chapter"]), []).append(item)
    for chapter_number, chapter_items in sorted(by_chapter.items()):
        if wanted and chapter_number not in wanted: continue
        source_file = Path(chapter_items[0]["source_file"])
        if not source_file.is_file(): raise SystemExit(f"missing original chapter source: {source_file}")
        print(f"transcribing chapter {chapter_number:02d}: {source_file.name}", flush=True)
        segments, _info = model.transcribe(str(source_file), language="en", beam_size=5, temperature=0.0, condition_on_previous_text=False, vad_filter=False, word_timestamps=True)
        segment_records = []
        for segment in segments:
            words = list(segment.words or [])
            segment_records.append({"start": float(segment.start), "end": float(segment.end), "text": segment.text, "avg_logprob": float(segment.avg_logprob) if segment.avg_logprob is not None else None, "no_speech_prob": float(getattr(segment, "no_speech_prob", 0.0) or 0.0), "words": [{"start": float(word.start), "end": float(word.end), "text": word.word} for word in words if word.start is not None and word.end is not None]})
        for item in chapter_items:
            raw = item["raw_cut"]
            extracted: dict[str, dict] = {}
            for kind, interval in (("word", raw["word"]), ("sentence", raw["sentence"])):
                left = float(interval["raw_start"]); right = float(interval["raw_end"])
                selected_words = [word for segment in segment_records for word in segment["words"] if overlap(word["start"], word["end"], left, right)]
                text = normalize("".join(word["text"] for word in selected_words))
                selected_segments = [segment for segment in segment_records if overlap(segment["start"], segment["end"], left, right)]
                if not text: text = normalize(" ".join(segment["text"] for segment in selected_segments))
                logprobs = [segment["avg_logprob"] for segment in selected_segments if segment["avg_logprob"] is not None]
                no_speech = [segment["no_speech_prob"] for segment in selected_segments]
                extracted[kind] = {"raw_text": text, "avg_logprob": sum(logprobs) / len(logprobs) if logprobs else None, "no_speech_prob": sum(no_speech) / len(no_speech) if no_speech else 0.0}
            reasons = list(raw.get("flags", []))
            if not extracted["word"]["raw_text"]: reasons.append("blank_word_transcript")
            if not extracted["sentence"]["raw_text"]: reasons.append("blank_sentence_transcript")
            if extracted["word"]["avg_logprob"] is not None and extracted["word"]["avg_logprob"] < -0.8: reasons.append("word_low_logprob")
            if extracted["sentence"]["avg_logprob"] is not None and extracted["sentence"]["avg_logprob"] < -0.8: reasons.append("sentence_low_logprob")
            existing[item["stable_id"]] = {"schema_version": 1, "stable_id": item["stable_id"], "item_uuid": item["item_uuid"], "chapter": item["chapter"], "position": item["position"], "model": f"faster-whisper-{args.pass_name}-chapter", "word": extracted["word"], "sentence": extracted["sentence"], "word_audio_sha256": item["word_audio"]["sha256"], "sentence_audio_sha256": item["sentence_audio"]["sha256"], "review_reasons": sorted(set(reasons)), "completed_at": datetime.now(timezone.utc).isoformat()}
        ordered = [existing[item["stable_id"]] for item in source["items_by_chapter"] if item["stable_id"] in existing]
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in ordered), encoding="utf-8")
        print(f"chapter {chapter_number:02d}: mapped {len(chapter_items)} items", flush=True)
    print(f"wrote {len(existing)} ASR records to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
