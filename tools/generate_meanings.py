"""Generate validated bilingual meaning drafts through the local Luna/Codex CLI.

The audio and ASR transcript remain the source of truth.  This tool asks the
local model for only the metadata needed by the learner wall: part of speech
and concise English/Simplified Chinese meanings.  Each batch is written only
after its IDs and required fields have been validated, so an interrupted run
can resume without touching completed batches.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def extract_json(stdout: str) -> dict:
    """Accept plain JSON or a single JSON object inside a Markdown fence."""
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", stdout, flags=re.DOTALL | re.IGNORECASE)
    candidates = fenced or [stdout[stdout.find("{") : stdout.rfind("}") + 1]] if "{" in stdout and "}" in stdout else []
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("model output did not contain one JSON object")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_payload(payload: dict, expected: dict[str, dict], batch_number: int) -> dict:
    if payload.get("batch") not in (None, batch_number):
        raise ValueError(f"batch number mismatch: expected {batch_number}, got {payload.get('batch')!r}")
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("model JSON has no items list")
    actual_ids = [item.get("stable_id") for item in items if isinstance(item, dict)]
    if len(actual_ids) != len(set(actual_ids)) or set(actual_ids) != set(expected):
        raise ValueError(f"meaning ID mismatch: expected {len(expected)}, got {len(actual_ids)}")
    normalized: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("meaning item is not an object")
        stable_id = item.get("stable_id")
        fields = {key: str(item.get(key, "")).strip() for key in ("part_of_speech", "meaning_en", "meaning_zh")}
        if stable_id not in expected:
            raise ValueError(f"unknown meaning ID: {stable_id}")
        if not all(fields.values()):
            raise ValueError(f"empty meaning field for {stable_id}")
        normalized[stable_id] = {
            "schema_version": 1,
            "stable_id": stable_id,
            "part_of_speech": fields["part_of_speech"],
            "meaning_en": fields["meaning_en"],
            "meaning_zh": fields["meaning_zh"],
            "meaning_status": str(item.get("meaning_status", "ai_draft")).strip() or "ai_draft",
        }
    return {stable_id: normalized[stable_id] for stable_id in expected}


def build_prompt(payload: dict) -> str:
    return (
        "You are preparing draft metadata for a local IELTS vocabulary learner.\n"
        "The recordings and ASR transcripts are authoritative. Do not rewrite, repair, or omit any transcript; "
        "infer only the word sense needed for the supplied sentence.\n"
        "Return exactly one JSON object and no commentary, using this shape:\n"
        '{"batch": 1, "items": [{"stable_id": "...", "part_of_speech": "noun", '
        '"meaning_en": "...", "meaning_zh": "...", "meaning_status": "ai_draft"}]}\n'
        "Rules:\n"
        "- Preserve every stable_id exactly and return exactly one item for each input item.\n"
        "- Give the primary part of speech used in the sentence (for example noun, verb, adjective, adverb, or phrase).\n"
        "- Give one concise English definition for the sense in context, normally no more than 12 words.\n"
        "- Give a natural concise Simplified Chinese equivalent for that same sense.\n"
        "- Do not add IPA, examples, explanations, confidence commentary, or fields outside the requested item fields.\n"
        "- If an ASR sentence looks imperfect, use the headword and the most plausible local context without changing the text.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )


def run_qwen(prompt_path: Path, timeout: int) -> str:
    # qwen is a PowerShell function in the user's profile. Calling it through
    # PowerShell preserves its configured provider/model without storing any
    # credential in this repository or in the batch artifacts.
    literal_path = str(prompt_path).replace("'", "''")
    command = f"$prompt = [IO.File]::ReadAllText('{literal_path}'); qwen -p $prompt"
    completed = subprocess.run(
        ["pwsh.exe", "-NoLogo", "-NonInteractive", "-Command", command],
        cwd=prompt_path.parents[3],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[-2000:]
        raise RuntimeError(f"qwen exited {completed.returncode}: {detail}")
    return completed.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--batch", type=int, help="generate only this 1-based batch")
    parser.add_argument("--start-batch", type=int, default=1, help="first 1-based batch for a range")
    parser.add_argument("--end-batch", type=int, help="exclusive end of a batch range")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--force", action="store_true", help="regenerate existing accepted batches")
    args = parser.parse_args()
    root = args.project_root.resolve()
    input_dir = root / "work" / "meaning-batches" / "input"
    prompt_dir = root / "work" / "meaning-batches" / "prompts"
    output_dir = root / "work" / "meaning-batches" / "accepted"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    input_paths = sorted(input_dir.glob("batch-*.json"))
    if not input_paths:
        raise SystemExit("run prepare_meaning_batches.py first")
    if args.batch is not None:
        input_paths = [input_dir / f"batch-{args.batch:04d}.json"]
        if not input_paths[0].exists():
            raise SystemExit(f"missing batch: {input_paths[0]}")
    else:
        start_batch = max(1, args.start_batch)
        end_batch = args.end_batch if args.end_batch is not None else len(input_paths) + 1
        if end_batch <= start_batch:
            raise SystemExit(f"invalid batch range {start_batch}:{end_batch}")
        input_paths = [input_dir / f"batch-{number:04d}.json" for number in range(start_batch, end_batch)]
        missing = [path for path in input_paths if not path.exists()]
        if missing:
            raise SystemExit(f"missing batch: {missing[0]}")

    for index, input_path in enumerate(input_paths, start=1):
        batch_number = int(input_path.stem.split("-")[-1])
        output_path = output_dir / input_path.name
        payload = json.loads(input_path.read_text(encoding="utf-8"))
        input_digest = sha256(input_path)
        expected = {item["stable_id"]: item for item in payload.get("items", [])}
        if not expected:
            raise SystemExit(f"empty input batch: {input_path}")
        if output_path.exists() and not args.force:
            try:
                accepted = json.loads(output_path.read_text(encoding="utf-8"))
                validate_payload(accepted, expected, batch_number)
                if accepted.get("input_sha256") != input_digest:
                    raise ValueError("accepted batch was generated from an older input digest")
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                print(f"[{index}/{len(input_paths)}] regenerating {output_path.name}: {exc}", file=sys.stderr, flush=True)
            else:
                print(f"[{index}/{len(input_paths)}] kept {output_path.name}", flush=True)
                continue

        prompt_path = prompt_dir / f"batch-{batch_number:04d}.txt"
        prompt_path.write_text(build_prompt(payload), encoding="utf-8")
        last_error: Exception | None = None
        for attempt in range(1, args.retries + 2):
            try:
                raw = run_qwen(prompt_path, args.timeout)
                normalized = validate_payload(extract_json(raw), expected, batch_number)
                accepted_payload = {"schema_version": 1, "batch": batch_number, "input_sha256": input_digest, "items": list(normalized.values())}
                temporary = output_path.with_suffix(output_path.suffix + ".tmp")
                temporary.write_text(json.dumps(accepted_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                temporary.replace(output_path)
                print(f"[{index}/{len(input_paths)}] wrote {output_path.name}", flush=True)
                break
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                last_error = exc
                print(f"[{index}/{len(input_paths)}] attempt {attempt} failed: {exc}", file=sys.stderr, flush=True)
        else:
            raise SystemExit(f"could not complete {input_path}: {last_error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
