"""Import the validated Nana audio-cut manifest into this independent project.

The importer copies media and records hashes. It does not edit the Nana source
tree and it deliberately leaves transcript/meaning generation to later stages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5


DEFAULT_SOURCE = Path(r"D:\n2Prepare\nanaBeatsListening\var\derived\audio_cuts\bilibili\BV1AT4y1579F")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_id(chapter: int, position: int) -> str:
    return f"bv1at4y1579f-ch{chapter:02d}-{position:04d}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    project_root = args.project_root.resolve()
    manifest_path = source_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["summary"]["chapters"] != 22:
        raise SystemExit("expected 22 chapters in the prepared manifest")
    target_media = project_root / "var" / "content" / "media"
    source_records: list[dict[str, object]] = []
    for chapter in manifest["chapters"]:
        chapter_number = int(chapter["chapter"])
        for item in chapter["items"]:
            position = int(item["item_index"])
            sid = stable_id(chapter_number, position)
            item_uuid = str(uuid5(NAMESPACE_URL, f"BV1AT4y1579F/chapter-{chapter_number:02d}/item-{position:04d}"))
            copied: dict[str, object] = {}
            for kind in ("word_file", "sentence_file"):
                relative = str(item[kind]).replace("/", "\\")
                source_file = source_root / relative
                if not source_file.is_file():
                    raise SystemExit(f"missing source media: {source_file}")
                target_file = target_media / "BV1AT4y1579F" / relative
                target_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, target_file)
                source_hash = sha256(source_file)
                target_hash = sha256(target_file)
                if source_hash != target_hash:
                    raise SystemExit(f"copy hash mismatch: {source_file}")
                relative_posix = str(item[kind]).replace("\\", "/")
                copied[kind] = {"path": f"BV1AT4y1579F/{relative_posix}", "sha256": target_hash, "bytes": target_file.stat().st_size}
            source_records.append({
                "stable_id": sid,
                "item_uuid": item_uuid,
                "chapter": chapter_number,
                "position": position,
                "source_file": chapter["source_file"],
                "source_duration": chapter["source_duration"],
                "raw_cut": item,
                "word_audio": copied["word_file"],
                "sentence_audio": copied["sentence_file"],
            })
    output = {
        "schema_version": 1,
        "source_id": "BV1AT4y1579F",
        "source_manifest": str(manifest_path),
        "source_manifest_sha256": sha256(manifest_path),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chapters": manifest["summary"]["chapters"],
        "items": len(source_records),
        "media_files": len(source_records) * 2,
        "items_by_chapter": source_records,
    }
    destination = project_root / "content" / "BV1AT4y1579F" / "source-manifest.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(source_records)} items and {len(source_records) * 2} media files")
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
