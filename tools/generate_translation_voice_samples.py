"""Generate comparable Chinese translation samples for voice selection."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from generate_translation_audio import load_translation_sources, sha256_file, synthesize_edge


DEFAULT_VOICES = (
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunyangNeural",
)


async def generate_samples(project_root: Path, voices: list[str]) -> Path:
    sources, _ = load_translation_sources(project_root)
    source = next((item for item in sources if item.example_text), None)
    if source is None:
        raise SystemExit("the reviewed book has no word/example pair available for a voice sample")
    output_root = project_root / "var" / "content" / "translation-voice-samples"
    output_root.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "schema_version": 1,
        "source_stable_id": source.stable_id,
        "word_text": source.word_text,
        "example_text": source.example_text,
        "voices": {},
    }
    for voice in voices:
        voice_root = output_root / voice
        voice_root.mkdir(parents=True, exist_ok=True)
        word_path = voice_root / "word.mp3"
        example_path = voice_root / "example.mp3"
        print(f"generating samples for {voice}", flush=True)
        word_path.write_bytes(await synthesize_edge(source.word_text, voice))
        example_path.write_bytes(await synthesize_edge(source.example_text, voice))
        manifest["voices"][voice] = {  # type: ignore[index]
            "word_audio": str(word_path.relative_to(project_root)).replace("\\", "/"),
            "example_audio": str(example_path.relative_to(project_root)).replace("\\", "/"),
            "word_sha256": sha256_file(word_path),
            "example_sha256": sha256_file(example_path),
        }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--voice", action="append", dest="voices", help="voice short name; repeat to compare specific voices")
    args = parser.parse_args()
    voices = args.voices or list(DEFAULT_VOICES)
    manifest_path = asyncio.run(generate_samples(args.project_root.resolve(), voices))
    print(f"wrote voice samples: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
