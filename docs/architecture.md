# Architecture

```text
raw M4A/cut manifest
        |
        v
copied media + source manifest
        |
        +--> resumable Whisper runs --> selected transcripts
        |
        +--> Luna/Codex meaning batches --> accepted items
        |
        +--> page OCR --> order/sentence alignment --> book_words.json
                                      |
                                      v
                             SQLite runtime projection
                              /                  \
                  word_items + ASR       book_references + OCR
                                      |
                                      v
                         Rust API + copied media
                                      |
                                      v
                             React study wall
                                      |
                                      v
                       browser-local learner state
```

The runtime projection is replaceable. Preparation artifacts retain provenance
and uncertainty; runtime requests need only SQLite and media.

Stable identity is acoustic position (`source/chapter/item`), not ASR text.
This lets a future book importer replace displayed text without invalidating a
learner's LocalStorage cards.

The selected transcript is a derived review layer. `docs/asr-tag-review.json`
contains only explicit, conservative confirmations where a single-word
headword is supported by a clear inflected or orthographic form in the example
sentence ASR. It removes that derived warning from the learner-facing status
while retaining the original ASR record and the resolution evidence.

The page OCR under
`content/book-sources/ielts-vocabulary-true-script/page-ocr/` is a preparation
source, not a learner-request dependency. `tools/parse_book_ocr.py` aligns each
book entry to the audio sequence using bounded monotonic anchors. Exact example
sentence matches are strongest, followed by normalized sentence matches and
headword/alias matches. An unmatched gap is filled by order only when the OCR
and audio gaps have the same length; unequal gaps stay unmatched instead of
being guessed. The generated `book_words.json` retains alignment status,
evidence, page provenance, and review reasons.

`tools/build_content.py` projects matched OCR records into the separate
`book_references` table. It does not overwrite canonical ASR fields in
`word_items` or `examples`. The API returns both layers, and the React study
wall uses the reviewed-book headword, meaning, translation, IPA, example,
collocations, word-formation notes, and page provenance as the learner-facing
dossier while keeping the raw ASR word and sentence visible as evidence. For
example, an audio ASR result of `Plato.` can display the OCR-backed book word
`plateau` because the book example contains `plateau` and the sentence aligns
exactly.

Sentence confirmation remains a separate, reversible browser-local decision.
It is included in the local progress backup and remains keyed by stable item
ID; it does not rewrite SQLite, raw ASR, or OCR review reasons.
