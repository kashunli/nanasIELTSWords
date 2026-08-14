"""Focused tests for source-audio repair composition."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from content_repairs import load_source_items


class ContentRepairTests(unittest.TestCase):
    def test_recovered_item_is_inserted_without_renumbering_existing_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            content = Path(directory)
            (content / "source-manifest.json").write_text(
                json.dumps(
                    {
                        "source_manifest_sha256": "base-hash",
                        "items_by_chapter": [
                            {"stable_id": "audio-68", "item_uuid": "uuid-68", "chapter": 19, "position": 68, "source_file": "source.m4a", "source_duration": 10, "raw_cut": {}, "word_audio": {"path": "word68.mp3"}, "sentence_audio": {"path": "sentence68.mp3"}},
                            {"stable_id": "audio-69", "item_uuid": "uuid-69", "chapter": 19, "position": 69, "source_file": "source.m4a", "source_duration": 10, "raw_cut": {}, "word_audio": {"path": "word69.mp3"}, "sentence_audio": {"path": "sentence69.mp3"}},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (content / "audio-repairs.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "base_source_manifest_sha256": "base-hash",
                        "repairs": [
                            {
                                "existing_item": {"stable_id": "audio-68", "sentence_audio_path": "sentence68-repaired.mp3"},
                                "inserted_item": {
                                    "stable_id": "audio-68-single",
                                    "item_uuid": "uuid-single",
                                    "raw_cut": {"flags": []},
                                    "word_audio_path": "word-single.mp3",
                                    "sentence_audio_path": "sentence-single.mp3",
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            items = load_source_items(content)

        self.assertEqual([item["stable_id"] for item in items], ["audio-68", "audio-68-single", "audio-69"])
        self.assertEqual([item["position"] for item in items], [68, 69, 70])
        self.assertEqual(items[0]["sentence_audio"]["path"], "sentence68-repaired.mp3")
        self.assertEqual(items[2]["stable_id"], "audio-69")


if __name__ == "__main__":
    unittest.main()
