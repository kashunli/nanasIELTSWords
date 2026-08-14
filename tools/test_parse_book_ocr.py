"""Focused tests for conservative book-to-audio OCR alignment."""
from __future__ import annotations

import unittest

from parse_book_ocr import align_chapter, normalize_sentence, normalize_word_forms


def audio_record(stable_id: str, headword: str, sentence: str, position: int) -> dict[str, object]:
    return {
        "stable_id": stable_id,
        "item_uuid": f"uuid-{stable_id}",
        "position": position,
        "headword": headword,
        "sentence": sentence,
    }


def book_record(book_word_id: str, headword: str, sentence: str) -> dict[str, object]:
    return {
        "book_word_id": book_word_id,
        "headword": headword,
        "example_en": sentence,
    }


class BookOcrAlignmentTests(unittest.TestCase):
    def test_sentence_anchor_repairs_asr_spelling(self) -> None:
        aligned, report = align_chapter(
            [book_record("book-plateau", "plateau", "The atmosphere is thin on the plateau.")],
            [audio_record("audio-62", "Plato.", "The atmosphere is thin on the plateau.", 62)],
        )

        self.assertEqual(aligned[0]["stable_id"], "audio-62")
        self.assertEqual(aligned[0]["alignment_status"], "matched_sentence")
        self.assertEqual(aligned[0]["alignment_evidence"], "sentence")
        self.assertEqual(aligned[0]["sentence_match"], "exact")
        self.assertEqual(report["matched_by_sentence"], 1)

    def test_equal_length_gap_can_use_order(self) -> None:
        aligned, report = align_chapter(
            [
                book_record("book-first", "first", "First sentence."),
                book_record("book-middle", "middle", "Middle sentence."),
                book_record("book-last", "last", "Last sentence."),
            ],
            [
                audio_record("audio-first", "first", "First sentence.", 1),
                audio_record("audio-middle", "muddle", "An unclear sentence.", 2),
                audio_record("audio-last", "last", "Last sentence.", 3),
            ],
        )

        self.assertEqual(aligned[1]["stable_id"], "audio-middle")
        self.assertEqual(aligned[1]["alignment_status"], "matched_order")
        self.assertEqual(report["matched_by_order"], 1)
        self.assertEqual(report["matched_words"], 3)

    def test_unequal_gap_stays_unmatched(self) -> None:
        aligned, report = align_chapter(
            [
                book_record("book-first", "first", "First sentence."),
                book_record("book-middle-a", "middle a", "Middle A sentence."),
                book_record("book-middle-b", "middle b", "Middle B sentence."),
                book_record("book-last", "last", "Last sentence."),
            ],
            [
                audio_record("audio-first", "first", "First sentence.", 1),
                audio_record("audio-middle", "muddle", "An unclear sentence.", 2),
                audio_record("audio-last", "last", "Last sentence.", 3),
            ],
        )

        self.assertEqual(report["matched_words"], 2)
        self.assertEqual(aligned[1]["alignment_status"], "unmatched_ocr_word")
        self.assertEqual(aligned[2]["alignment_status"], "unmatched_ocr_word")
        self.assertEqual(report["missing_audio_words"][0]["stable_id"], "audio-middle")

    def test_normalization_supports_aliases_and_punctuation(self) -> None:
        forms = normalize_word_forms("specialise (= specialize)")

        self.assertIn("specialise", forms)
        self.assertIn("specialize", forms)
        self.assertEqual(normalize_sentence("The café's atmosphere!"), "the cafe s atmosphere")


if __name__ == "__main__":
    unittest.main()
