"""Focused tests for Chinese translation audio source and manifest rules."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from generate_translation_audio import (
    DEFAULT_VOICE,
    LANGUAGE_CODE,
    PROVIDER,
    TranslationSource,
    _is_current_audio,
    count_characters,
    load_translation_sources,
    relative_media_path,
)


class TranslationAudioTests(unittest.TestCase):
    def test_loads_book_translations_and_retains_missing_example_as_skip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            book_path = root / "content" / "book-sources" / "ielts-vocabulary-true-script" / "book_words.json"
            book_path.parent.mkdir(parents=True)
            book_path.write_text(
                json.dumps(
                    {
                        "words": [
                            {
                                "stable_id": "word-1",
                                "book_word_id": "book-1",
                                "meaning_zh": "气氛",
                                "example_zh": "校园里气氛紧张。",
                                "source": {"page_markdown": "page_1.md"},
                                "pdf_page": 12,
                            },
                            {
                                "stable_id": "word-2",
                                "book_word_id": "book-2",
                                "meaning_zh": "时代",
                                "example_zh": "",
                                "source": {"page_markdown": "page_2.md"},
                                "pdf_page": 13,
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            sources, skipped = load_translation_sources(root)

        self.assertEqual([source.stable_id for source in sources], ["word-1", "word-2"])
        self.assertEqual(sources[0].word_text, "气氛")
        self.assertEqual(sources[0].example_text, "校园里气氛紧张。")
        self.assertEqual(skipped, [{"stable_id": "word-2", "field": "example_zh", "reason": "reviewed source has no example sentence translation"}])

    def test_character_count_excludes_missing_examples(self) -> None:
        sources = [
            TranslationSource("word-1", "book-1", "气氛", "校园里气氛紧张。", "page.md", 1),
            TranslationSource("word-2", "book-2", "时代", "", "page.md", 1),
        ]

        self.assertEqual(count_characters(sources), (4, 8))

    def test_media_paths_are_stable_and_scoped(self) -> None:
        self.assertEqual(
            relative_media_path("word-1", "word"),
            "BV1AT4y1579F/chinese-translations/word/word-1.mp3",
        )
        with self.assertRaises(ValueError):
            relative_media_path("../outside", "word")

    def test_matching_audio_requires_text_and_file_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative = relative_media_path("word-1", "word")
            destination = root / "var" / "content" / "media" / relative
            destination.parent.mkdir(parents=True)
            destination.write_bytes(b"ID3 test audio")
            from generate_translation_audio import sha256_file, sha256_text

            entry = {
                "text": "气氛",
                "text_sha256": sha256_text("气氛"),
                "audio_path": relative,
                "audio_sha256": sha256_file(destination),
            }

            self.assertTrue(_is_current_audio(root, "word-1", "word", "气氛", entry, voice=DEFAULT_VOICE))
            self.assertFalse(_is_current_audio(root, "word-1", "word", "时代", entry, voice=DEFAULT_VOICE))

    def test_provider_constants_match_edge_tts_contract(self) -> None:
        self.assertEqual(PROVIDER, "microsoft-edge-tts")
        self.assertEqual(LANGUAGE_CODE, "zh-CN")
        self.assertEqual(DEFAULT_VOICE, "zh-CN-YunjianNeural")


if __name__ == "__main__":
    unittest.main()
