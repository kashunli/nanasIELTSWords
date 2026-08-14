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
`book_references` table and selects learner-facing fields independently. A
reliable book headword alignment is authoritative for the whole item: it
replaces both the `word_items` and `examples` fields, records both
`accepted_*_source='book'`, and removes the item from unresolved ASR review
counts even when the audio sentence differs. This covers spelling variants
such as `mould`/`Mold`. If there is no reliable word alignment, an exact or
normalized sentence alignment can still replace the sentence field; otherwise
the unmatched field retains `accepted_*_source='asr'`. The API still returns
the separate book reference and keeps raw review reasons available for audit,
while the React study wall only surfaces ASR for items with no authoritative
book resolution. For example, an audio ASR result of `Plato.` uses the
OCR-backed book word `plateau` when the book example and audio sentence align
exactly, without deleting the raw transcript artifact.

Sentence confirmation remains a separate, reversible browser-local decision.
It is included in the local progress backup and remains keyed by stable item
ID; it does not rewrite SQLite, raw ASR, or OCR review reasons.
