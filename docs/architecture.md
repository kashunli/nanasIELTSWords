# Architecture

```text
raw M4A/cut manifest
        |
        v
copied media + source manifest + explicit repair overlay
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
                  word_items              book_references + OCR
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

An item can expose four independent learner-audio elements: the English word,
English sentence, Chinese word translation, and Chinese sentence translation.
The two translation paths are optional runtime media until those recordings
are prepared. The browser stores one global local playback recipe; the recipe
controls element order, repeat count, and the pause after each playback for
every item. A zero repeat count skips an element, but normalization keeps at
least one element active. It is learner-local configuration, not a server-side
mark or a mutation of the immutable source manifest.

`content/BV1AT4y1579F/audio-repairs.json` is an auditable exception layer for
source-cut mistakes that can be recovered from the immutable chapter audio.
It does not rewrite the base cut manifest or raw ASR. The current overlay
splits every clearly identified merged book entry, including the chapter 16
`resign` recording that was merged into `discharge`, and the chapter 19
`single` recording that was merged into `separate`. It also records transcript
overrides supported by local word timestamps, such as chapter 17 #113
`request` and chapter 17 #117 `instruct`, and suppresses duplicate audio-only
records. Existing stable IDs/UUIDs are retained; recovered entries receive
explicit source-derived IDs and presentation positions are recomputed in book
order.

The selected transcript is a preparation artifact used to choose stable audio
cuts and draft learner-facing fields. It retains raw transcription candidates
and review reasons for audit, but the runtime projection does not expose
transcription status, source labels, or a transcription-review UI.

The page OCR under
`content/book-sources/ielts-vocabulary-true-script/page-ocr/` is a preparation
source, not a learner-request dependency. `tools/parse_book_ocr.py` aligns each
book entry to the audio sequence using bounded monotonic anchors. Exact example
sentence matches are strongest, followed by normalized sentence matches and
headword/alias matches. An unmatched gap is filled by order only when the OCR
and audio gaps have the same length; unequal gaps stay unmatched instead of
being guessed. The generated `book_words.json` retains alignment status,
evidence, page provenance, and review reasons.

`tools/audit_book_audio.py` is the coverage gate for the book-first projection.
It compares the full book sequence with the composed source-audio sequence and
writes `book_audio_audit.json`. Direct sentence/headword matches are confirmed;
equal-length order-only gaps remain explicitly unresolved. The audit also lists
book entries with no direct audio and audio items not assigned to a book entry,
so a count match cannot hide a missing recording.

`tools/build_content.py` projects matched OCR records into the separate
`book_references` table and selects learner-facing fields independently. A
reliable book headword alignment is authoritative for the whole item: it
replaces both the `word_items` and `examples` fields. This covers spelling
variants such as `mould`/`Mold`. If there is no reliable word alignment, an
exact or normalized sentence alignment can still replace the sentence field.
The previously flagged order-only pairs were verified against the book and are
explicitly treated as book-backed by the projection. The API retains the
separate book reference for maintenance, while the React learner page renders
only the accepted study fields; raw transcription/review rows remain internal
audit data.

The internal maintenance request `GET /api/items?book_alignment=order_only`
still reads `book_references.alignment_status='matched_order'`; the build
projection marks all such records as `needs_review`, even when an older OCR
record omitted that flag. The learner study wall does not expose this queue,
ASR comparisons, alignment badges, or reviewed-book provenance panels after
manual verification.
