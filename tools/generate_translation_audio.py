"""Generate Mandarin audio for the learner-facing Chinese translations.

The reviewed-book record is the source of truth for the text shown in the
learner card. This tool turns only that text into derived MP3 media through
Microsoft Edge's online TTS service via the ``edge-tts`` package. It is
resumable and records the source text hash and generated-file hash so that a
later runtime build can reject stale or mismatched audio.

The Edge service does not require an API key. The package and service are
external online dependencies, so the generated manifest records the exact
voice and input source but the audio should still be treated as a derived
artifact that can be regenerated if the service changes.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import edge_tts
except ImportError as exc:  # pragma: no cover - exercised by the CLI environment
    raise SystemExit("Install the Edge TTS dependency first: python -m pip install edge-tts") from exc


SCHEMA_VERSION = 1
PROVIDER = "microsoft-edge-tts"
PACKAGE = "edge-tts"
LANGUAGE_CODE = "zh-CN"
DEFAULT_VOICE = "zh-CN-YunjianNeural"
AUDIO_ENCODING = "MP3"
STABLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


@dataclass(frozen=True)
class TranslationSource:
    stable_id: str
    book_word_id: str
    word_text: str
    example_text: str
    source_page: str
    pdf_page: int


class SynthesisError(RuntimeError):
    """Raised when Edge TTS does not return usable audio."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_translation_sources(project_root: Path) -> tuple[list[TranslationSource], list[dict[str, str]]]:
    """Load reviewed-book Chinese meaning and example translations.

    The one current book entry without an example is retained in ``skipped``
    rather than receiving an invented translation or an empty audio file.
    """

    path = project_root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_words.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    sources: list[TranslationSource] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in payload.get("words", []):
        stable_id = str(record.get("stable_id", "")).strip()
        if not stable_id or not STABLE_ID_RE.fullmatch(stable_id):
            raise SystemExit(f"invalid or missing stable_id in {path}: {stable_id!r}")
        if stable_id in seen:
            raise SystemExit(f"duplicate stable_id in {path}: {stable_id}")
        seen.add(stable_id)
        word_text = str(record.get("meaning_zh", "")).strip()
        example_text = str(record.get("example_zh", "")).strip()
        if not word_text:
            raise SystemExit(f"missing meaning_zh for {stable_id}")
        source = record.get("source") or {}
        sources.append(
            TranslationSource(
                stable_id=stable_id,
                book_word_id=str(record.get("book_word_id", "")),
                word_text=word_text,
                example_text=example_text,
                source_page=str(source.get("page_markdown", "")),
                pdf_page=int(record.get("pdf_page", 0)),
            )
        )
        if not example_text:
            skipped.append(
                {
                    "stable_id": stable_id,
                    "field": "example_zh",
                    "reason": "reviewed source has no example sentence translation",
                }
            )
    if not sources:
        raise SystemExit(f"no book translation records found in {path}")
    return sources, skipped


def relative_media_path(stable_id: str, field: str) -> str:
    if field not in {"word", "example"}:
        raise ValueError(f"unsupported translation audio field: {field}")
    if not STABLE_ID_RE.fullmatch(stable_id):
        raise ValueError(f"invalid stable_id: {stable_id}")
    return f"BV1AT4y1579F/chinese-translations/{field}/{stable_id}.mp3"


def _manifest_item(source: TranslationSource, field: str, text: str, path: Path) -> dict[str, Any]:
    audio_bytes = path.read_bytes()
    return {
        "text": text,
        "text_sha256": sha256_text(text),
        "audio_path": relative_media_path(source.stable_id, field),
        "audio_sha256": sha256_bytes(audio_bytes),
        "audio_bytes": len(audio_bytes),
        "source": {
            "book_word_id": source.book_word_id,
            "page_markdown": source.source_page,
            "pdf_page": source.pdf_page,
        },
    }


def load_existing_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"items": {}, "skipped": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SystemExit(f"unsupported translation audio manifest schema: {path}")
    if payload.get("provider") != PROVIDER:
        raise SystemExit(f"translation audio manifest provider mismatch: {path}")
    if payload.get("audio_encoding") != AUDIO_ENCODING:
        raise SystemExit(f"translation audio manifest encoding mismatch: {path}")
    items = payload.get("items")
    if not isinstance(items, dict):
        raise SystemExit(f"translation audio manifest items must be an object: {path}")
    return payload


def write_manifest(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def source_manifest_payload(
    project_root: Path,
    sources: list[TranslationSource],
    skipped: list[dict[str, str]],
    voice: str,
) -> dict[str, Any]:
    book_words_path = project_root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_words.json"
    return {
        "schema_version": SCHEMA_VERSION,
        "provider": PROVIDER,
        "package": PACKAGE,
        "language_code": LANGUAGE_CODE,
        "voice": voice,
        "audio_encoding": AUDIO_ENCODING,
        "source": {
            "book_words": "content/book-sources/ielts-vocabulary-true-script/book_words.json",
            "book_words_sha256": sha256_file(book_words_path),
            "record_count": len(sources),
        },
        "items": {},
        "skipped": skipped,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def synthesize_edge(text: str, voice: str) -> bytes:
    """Collect the MP3 chunks returned by one Edge TTS synthesis request."""

    communicate = edge_tts.Communicate(text, voice)
    chunks: list[bytes] = []
    try:
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                data = chunk.get("data")
                if isinstance(data, bytes):
                    chunks.append(data)
    except Exception as exc:  # edge-tts exposes several transport exception types
        raise SynthesisError(f"Edge TTS request failed: {exc}") from exc
    audio = b"".join(chunks)
    if not audio:
        raise SynthesisError("Edge TTS returned no audio")
    if not audio.startswith(b"ID3") and audio[:2] not in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xfa"}:
        raise SynthesisError("Edge TTS returned bytes that do not look like MP3 audio")
    return audio


def _is_current_audio(
    project_root: Path,
    stable_id: str,
    field: str,
    text: str,
    existing: dict[str, Any] | None,
    *,
    voice: str,
) -> bool:
    if not isinstance(existing, dict) or existing.get("text_sha256") != sha256_text(text):
        return False
    if existing.get("text") != text or existing.get("audio_path") != relative_media_path(stable_id, field):
        return False
    if existing.get("voice") not in (None, voice):
        return False
    media_path = project_root / "var" / "content" / "media" / existing["audio_path"]
    return media_path.is_file() and existing.get("audio_sha256") == sha256_file(media_path)


def _save_audio(project_root: Path, source: TranslationSource, field: str, text: str, audio: bytes, voice: str) -> dict[str, Any]:
    relative = relative_media_path(source.stable_id, field)
    destination = project_root / "var" / "content" / "media" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_bytes(audio)
    temporary.replace(destination)
    result = _manifest_item(source, field, text, destination)
    result["voice"] = voice
    return result


def count_characters(sources: list[TranslationSource]) -> tuple[int, int]:
    word = sum(len(source.word_text) for source in sources)
    example = sum(len(source.example_text) for source in sources if source.example_text)
    return word, example


async def _generate_async(
    project_root: Path,
    *,
    voice: str,
    delay: float,
    limit: int | None,
    force: bool,
    concurrency: int,
    checkpoint_every: int,
) -> int:
    sources, skipped = load_translation_sources(project_root)
    total_jobs = len(sources) + sum(bool(source.example_text) for source in sources)

    manifest_path = project_root / "content" / "BV1AT4y1579F" / "chinese-translation-audio-manifest.json"
    manifest = load_existing_manifest(manifest_path)
    book_words_path = project_root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_words.json"
    book_words_hash = sha256_file(book_words_path)
    if manifest.get("voice") not in (None, voice):
        raise SystemExit(f"voice mismatch in existing manifest; use --force only after review: {manifest_path}")
    if manifest.get("language_code") not in (None, LANGUAGE_CODE):
        raise SystemExit(f"language mismatch in existing manifest: {manifest_path}")
    if manifest.get("source", {}).get("book_words_sha256") not in (None, book_words_hash):
        raise SystemExit(f"source book_words.json changed; review the stale manifest before regenerating: {manifest_path}")
    if not manifest.get("items"):
        manifest = source_manifest_payload(project_root, sources, skipped, voice)
    else:
        manifest["skipped"] = skipped
        manifest["generated_at"] = manifest.get("generated_at") or datetime.now(timezone.utc).isoformat()
    manifest["voice"] = voice
    manifest["language_code"] = LANGUAGE_CODE
    manifest["provider"] = PROVIDER
    manifest["package"] = PACKAGE
    manifest["audio_encoding"] = AUDIO_ENCODING
    manifest_items: dict[str, Any] = manifest.setdefault("items", {})
    jobs_reused = 0
    pending_jobs: list[tuple[TranslationSource, str, str]] = []
    for source in sources:
        fields = [("word", source.word_text)]
        if source.example_text:
            fields.append(("example", source.example_text))
        item = manifest_items.setdefault(source.stable_id, {})
        for field, text in fields:
            if not force and _is_current_audio(project_root, source.stable_id, field, text, item.get(field), voice=voice):
                jobs_reused += 1
                continue
            pending_jobs.append((source, field, text))
    if limit is not None:
        pending_jobs = pending_jobs[:limit]

    jobs_done = 0
    for start in range(0, len(pending_jobs), concurrency):
        batch = pending_jobs[start : start + concurrency]
        print(
            f"synthesizing jobs {start + 1}-{start + len(batch)} of {len(pending_jobs)} "
            f"({batch[0][0].stable_id} {batch[0][1]} … {batch[-1][0].stable_id} {batch[-1][1]})",
            flush=True,
        )
        results = await asyncio.gather(
            *(synthesize_edge(text, voice) for _, _, text in batch),
            return_exceptions=True,
        )
        for (source, field, text), result in zip(batch, results):
            if isinstance(result, BaseException):
                raise SynthesisError(f"{source.stable_id} {field}: {result}") from result
            manifest_items[source.stable_id][field] = _save_audio(
                project_root, source, field, text, result, voice
            )
        jobs_done += len(batch)
        if jobs_done % checkpoint_every == 0 or jobs_done == len(pending_jobs):
            write_manifest(manifest_path, manifest)
            if delay:
                await asyncio.sleep(delay)
    write_manifest(manifest_path, manifest)
    pending = total_jobs - jobs_reused - jobs_done
    print(f"generated={jobs_done} reused={jobs_reused} pending={pending} manifest={manifest_path}")
    return 0


def generate(
    project_root: Path,
    *,
    voice: str,
    delay: float,
    limit: int | None,
    force: bool,
    concurrency: int,
    checkpoint_every: int,
    dry_run: bool,
) -> int:
    sources, skipped = load_translation_sources(project_root)
    word_chars, example_chars = count_characters(sources)
    total_jobs = len(sources) + sum(bool(source.example_text) for source in sources)
    print(
        f"source records={len(sources)} word_jobs={len(sources)} example_jobs={total_jobs - len(sources)} "
        f"characters={word_chars + example_chars} (word={word_chars}, example={example_chars})"
    )
    print(f"skipped example translations={len(skipped)}")
    if dry_run:
        return 0
    return asyncio.run(
        _generate_async(
            project_root,
            voice=voice,
            delay=delay,
            limit=limit,
            force=force,
            concurrency=concurrency,
            checkpoint_every=checkpoint_every,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--delay", type=float, default=0.15, help="seconds between synthesis requests")
    parser.add_argument("--concurrency", type=int, default=4, help="maximum number of Edge TTS requests in flight")
    parser.add_argument("--checkpoint-every", type=int, default=32, help="persist the manifest after this many new files")
    parser.add_argument("--limit", type=int, help="generate at most this many new files")
    parser.add_argument("--force", action="store_true", help="regenerate files even when their hashes match")
    parser.add_argument("--dry-run", action="store_true", help="report source coverage and character count without calling Edge TTS")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be positive")
    if args.concurrency < 1:
        raise SystemExit("--concurrency must be positive")
    if args.checkpoint_every < 1:
        raise SystemExit("--checkpoint-every must be positive")
    return generate(
        args.project_root.resolve(),
        voice=args.voice,
        delay=max(0.0, args.delay),
        limit=args.limit,
        force=args.force,
        concurrency=args.concurrency,
        checkpoint_every=args.checkpoint_every,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    raise SystemExit(main())
