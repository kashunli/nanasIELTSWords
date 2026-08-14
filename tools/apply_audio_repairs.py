"""Render the small, source-backed audio repair overlay into runtime media."""
from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

from content_repairs import load_repair_plan, sha256


def run_checked(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, capture_output=True, text=True)


def probe_duration(path: Path) -> float:
    result = run_checked(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ]
    )
    return float(result.stdout.strip())


def target_path(media_root: Path, relative: str) -> Path:
    target = (media_root / Path(relative.replace("/", os.sep))).resolve()
    try:
        target.relative_to(media_root.resolve())
    except ValueError as exc:
        raise SystemExit(f"audio repair target escapes runtime media: {relative}") from exc
    return target


def encode_clip(source: Path, start: float, end: float, target: Path, *, overwrite: bool) -> dict[str, object]:
    if end <= start:
        raise SystemExit(f"invalid audio repair range: {start}..{end}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.stem}.repair-part{target.suffix}")
    if temporary.exists():
        temporary.unlink()
    if target.exists() and not overwrite:
        actual = probe_duration(target)
    else:
        try:
            run_checked(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    f"{start:.3f}",
                    "-t",
                    f"{end - start:.3f}",
                    "-i",
                    str(source),
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "44100",
                    "-c:a",
                    "libmp3lame",
                    "-q:a",
                    "3",
                    "-map_metadata",
                    "-1",
                    "-threads",
                    "1",
                    str(temporary),
                ]
            )
            os.replace(temporary, target)
            actual = probe_duration(target)
        finally:
            if temporary.exists():
                temporary.unlink()
    requested = end - start
    if abs(actual - requested) > 0.05:
        raise SystemExit(
            f"audio repair duration mismatch for {target}: actual={actual:.3f}, requested={requested:.3f}"
        )
    return {"path": str(target), "duration": round(actual, 3), "sha256": sha256(target), "bytes": target.stat().st_size}


def apply_audio_repairs(project_root: Path, *, overwrite: bool = True) -> list[dict[str, object]]:
    content = project_root / "content" / "BV1AT4y1579F"
    plan = load_repair_plan(content)
    media_root = project_root / "var" / "content" / "media"
    results: list[dict[str, object]] = []
    for repair in plan.get("repairs", []):
        source = Path(str(repair["source_file"]))
        existing = repair.get("existing_item") or {}
        inserted = repair.get("inserted_item")
        has_audio_work = bool(
            existing.get("sentence_clip")
            or existing.get("word_clip")
            or inserted
        )
        if has_audio_work and not source.is_file():
            raise SystemExit(f"audio repair source is missing: {source}")
        expected_source_hash = str(repair.get("source_sha256", ""))
        if has_audio_work and expected_source_hash and sha256(source) != expected_source_hash:
            raise SystemExit(f"audio repair source hash mismatch: {source}")

        if existing.get("sentence_clip"):
            existing_target = target_path(media_root, str(existing["sentence_audio_path"]))
            results.append(
                {
                    "stable_id": existing["stable_id"],
                    "kind": "sentence",
                    "media": encode_clip(
                        source,
                        float(existing["sentence_clip"]["start"]),
                        float(existing["sentence_clip"]["end"]),
                        existing_target,
                        overwrite=overwrite,
                    ),
                }
            )
        if existing.get("word_clip"):
            existing_target = target_path(media_root, str(existing["word_audio_path"]))
            results.append(
                {
                    "stable_id": existing["stable_id"],
                    "kind": "word",
                    "media": encode_clip(
                        source,
                        float(existing["word_clip"]["start"]),
                        float(existing["word_clip"]["end"]),
                        existing_target,
                        overwrite=overwrite,
                    ),
                }
            )

        if not inserted:
            continue
        raw_cut = inserted["raw_cut"]
        word_clip = raw_cut["word"]
        sentence_clip = raw_cut["sentence"]
        for kind, relative, clip in (
            ("word", inserted["word_audio_path"], word_clip),
            ("sentence", inserted["sentence_audio_path"], sentence_clip),
        ):
            results.append(
                {
                    "stable_id": inserted["stable_id"],
                    "kind": kind,
                    "media": encode_clip(
                        source,
                        float(clip["start"]),
                        float(clip["end"]),
                        target_path(media_root, str(relative)),
                        overwrite=overwrite,
                    ),
                }
            )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--no-overwrite", action="store_true")
    args = parser.parse_args()
    results = apply_audio_repairs(args.project_root.resolve(), overwrite=not args.no_overwrite)
    for result in results:
        print(result)
    print(f"applied {len(results)} repaired media clips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
