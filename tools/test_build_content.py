"""Focused tests for learner-facing book/ASR field selection."""
from __future__ import annotations

import unittest

from build_content import accepted_transcript, book_sentence_matches, book_word_matches, unresolved_asr_review


def book_reference(alignment_status: str, sentence_match: str, headword: str = "plateau") -> dict[str, str]:
    return {
        "alignment_status": alignment_status,
        "sentence_match": sentence_match,
        "headword": headword,
        "example_en": "The atmosphere is thin on the plateau.",
    }


def audio_record(headword: str = "Plato.", sentence: str = "The atmosphere is thin on the plateau.") -> dict[str, str]:
    return {"headword": headword, "sentence": sentence, "transcript_status": "needs_review"}


class ContentProjectionTests(unittest.TestCase):
    def test_sentence_match_replaces_sentence_only(self) -> None:
        reference = book_reference("matched_sentence", "normalized")
        selected = accepted_transcript(audio_record(), reference)

        self.assertTrue(book_sentence_matches(reference))
        self.assertEqual(selected["sentence"], reference["example_en"])
        self.assertEqual(selected["accepted_sentence_source"], "book")

    def test_sentence_anchor_replaces_book_word_even_when_asr_word_differs(self) -> None:
        reference = book_reference("matched_sentence", "exact")
        selected = accepted_transcript(audio_record(), reference)

        self.assertTrue(book_word_matches(reference, "Plato."))
        self.assertEqual(selected["headword"], "plateau")
        self.assertEqual(selected["accepted_word_source"], "book")

    def test_headword_alignment_replaces_word_but_keeps_different_sentence(self) -> None:
        reference = book_reference("matched_headword", "different", "plateau")
        record = audio_record(sentence="A different audio sentence.")
        selected = accepted_transcript(record, reference)

        self.assertEqual(selected["headword"], "plateau")
        self.assertEqual(selected["sentence"], record["sentence"])
        self.assertEqual(selected["accepted_word_source"], "book")
        self.assertEqual(selected["accepted_sentence_source"], "asr")

    def test_order_alignment_does_not_hide_different_asr_fields(self) -> None:
        reference = book_reference("matched_order", "different")
        record = audio_record()
        selected = accepted_transcript(record, reference)

        self.assertFalse(book_word_matches(reference, record["headword"]))
        self.assertEqual(selected["accepted_word_source"], "asr")
        self.assertEqual(selected["accepted_sentence_source"], "asr")
        self.assertTrue(unresolved_asr_review(record, reference))

    def test_fully_book_backed_review_is_not_unresolved(self) -> None:
        reference = book_reference("matched_sentence", "exact")
        self.assertFalse(unresolved_asr_review(audio_record(), reference))


if __name__ == "__main__":
    unittest.main()
