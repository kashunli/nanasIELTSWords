"""Load explicit source-audio repairs without mutating the base cut manifest."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


REPAIR_FILE_NAME = "audio-repairs.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_repair_plan(content: Path) -> dict[str, Any]:
    path = content / REPAIR_FILE_NAME
    if not path.exists():
        return {"schema_version": 1, "repairs": []}
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schema_version") != 1 or not isinstance(plan.get("repairs"), list):
        raise SystemExit(f"invalid audio repair plan: {path}")
    source_manifest = content / "source-manifest.json"
    expected_hash = plan.get("base_source_manifest_sha256")
    source = json.loads(source_manifest.read_text(encoding="utf-8"))
    if expected_hash and source.get("source_manifest_sha256") != expected_hash:
        raise SystemExit(
            "audio repair plan was prepared for a different base source manifest: "
            f"{source_manifest}"
        )
    return plan


def repair_path(content: Path) -> Path:
    return content / REPAIR_FILE_NAME


def repair_artifact_hash(content: Path) -> str:
    path = repair_path(content)
    return sha256(path) if path.exists() else ""


def repair_entries_by_item(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Index item overrides and recovered items, including chained splits.

    A merged source cut can contain more than one missing book item.  In that
    case the first repair inserts the next item and a later repair uses that
    inserted item as its anchor so its sentence clip can be trimmed before the
    following item is inserted.  The index therefore keeps both roles for one
    stable ID instead of treating the chain as a duplicate.
    """
    result: dict[str, dict[str, Any]] = {}
    for repair in plan.get("repairs", []):
        existing = repair.get("existing_item") or {}
        inserted = repair.get("inserted_item") or {}
        existing_id = existing.get("stable_id")
        inserted_id = inserted.get("stable_id")
        if not existing_id and not inserted_id:
            raise SystemExit(f"audio repair is missing an item ID: {repair}")
        if existing_id:
            entry = result.setdefault(existing_id, {"existing_repairs": [], "inserted_repair": None})
            entry["existing_repairs"].append(repair)
        if inserted_id:
            entry = result.setdefault(inserted_id, {"existing_repairs": [], "inserted_repair": None})
            if entry["inserted_repair"] is not None:
                raise SystemExit(f"duplicate recovered audio item ID: {inserted_id}")
            entry["inserted_repair"] = repair
    return result


def repair_id(plan: dict[str, Any], repair: dict[str, Any]) -> str:
    return str(repair.get("repair_id") or plan.get("repair_id") or "audio-repair")


def load_source_items(content: Path) -> list[dict[str, Any]]:
    """Return base source records plus explicit, position-aware repairs.

    Existing stable IDs are deliberately retained when a recovered item is
    inserted. Their display positions move by one, but browser progress keyed
    by their IDs remains valid.
    """
    source = json.loads((content / "source-manifest.json").read_text(encoding="utf-8"))
    items = copy.deepcopy(source.get("items_by_chapter") or [])
    plan = load_repair_plan(content)

    for repair in plan.get("repairs", []):
        existing = repair.get("existing_item") or {}
        inserted = repair.get("inserted_item")
        if not existing and not inserted:
            raise SystemExit(f"audio repair has no existing or inserted item: {repair}")
        if not existing:
            raise SystemExit(f"audio repair must identify its anchor item: {repair}")
        anchor_id = existing["stable_id"]
        anchor_index = next((index for index, item in enumerate(items) if item["stable_id"] == anchor_id), None)
        if anchor_index is None:
            raise SystemExit(f"audio repair anchor is not in the base source: {anchor_id}")
        anchor = items[anchor_index]
        chapter = int(anchor["chapter"])
        anchor_position = int(anchor["position"])

        if existing.get("word_audio_path"):
            anchor["word_audio"] = {"path": str(existing["word_audio_path"])}
        if existing.get("sentence_audio_path"):
            anchor["sentence_audio"] = {"path": str(existing["sentence_audio_path"])}
        if existing.get("raw_cut"):
            anchor["raw_cut"] = copy.deepcopy(existing["raw_cut"])
        anchor["audio_repair"] = {
            "repair_id": repair_id(plan, repair),
            "role": "existing",
            "kind": repair.get("kind", "source_audio_repair"),
        }

        if not inserted:
            continue

        for item in items:
            if item is not anchor and int(item["chapter"]) == chapter and int(item["position"]) > anchor_position:
                item["position"] = int(item["position"]) + 1

        inserted_record = {
            "stable_id": inserted["stable_id"],
            "item_uuid": inserted["item_uuid"],
            "chapter": chapter,
            "position": anchor_position + 1,
            "source_file": anchor["source_file"],
            "source_duration": anchor["source_duration"],
            "raw_cut": copy.deepcopy(inserted["raw_cut"]),
            "word_audio": {"path": str(inserted["word_audio_path"])},
            "sentence_audio": {"path": str(inserted["sentence_audio_path"])},
            "audio_repair": {
                "repair_id": repair_id(plan, repair),
                "role": "inserted",
                "kind": repair.get("kind", "source_audio_repair"),
                "asr_source_stable_id": repair.get("asr_source_stable_id"),
            },
        }
        items.append(inserted_record)

    suppressed = plan.get("suppressed_items", [])
    suppressed_ids: set[str] = set()
    for entry in suppressed:
        stable_id = str(entry.get("stable_id") if isinstance(entry, dict) else entry)
        if not stable_id:
            raise SystemExit(f"invalid suppressed audio item: {entry}")
        suppressed_ids.add(stable_id)
    if suppressed_ids:
        present_ids = {str(item["stable_id"]) for item in items}
        unknown = suppressed_ids - present_ids
        if unknown:
            raise SystemExit(f"suppressed audio item is not in the source projection: {sorted(unknown)}")
        items = [item for item in items if str(item["stable_id"]) not in suppressed_ids]

    items.sort(key=lambda item: (int(item["chapter"]), int(item["position"])))
    # Positions are presentation order, not stable identity.  Re-number after
    # insertions and explicit duplicate suppression so every chapter remains a
    # contiguous book/audio sequence while stable IDs and UUIDs stay intact.
    chapter_positions: dict[int, int] = {}
    chapter_starts: dict[int, int] = {}
    for item in items:
        chapter = int(item["chapter"])
        chapter_positions[chapter] = chapter_positions.get(chapter, 0) + 1
        chapter_starts.setdefault(chapter, int(item["position"]))
        item["position"] = chapter_starts[chapter] + chapter_positions[chapter] - 1
    stable_ids = [str(item["stable_id"]) for item in items]
    if len(stable_ids) != len(set(stable_ids)):
        raise SystemExit("duplicate stable ID after applying audio repairs")
    uuids = [str(item["item_uuid"]) for item in items]
    if len(uuids) != len(set(uuids)):
        raise SystemExit("duplicate item UUID after applying audio repairs")
    positions = [(int(item["chapter"]), int(item["position"])) for item in items]
    if len(positions) != len(set(positions)):
        raise SystemExit("duplicate chapter position after applying audio repairs")
    return items
