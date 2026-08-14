# Qwen3.7-Flash quality review: Chapter 4

Review scope: PDF pages 56–62, compared with the rendered page images and the
earlier GPT-native visual transcription approach. The pictures were omitted;
printed vocabulary labels and layout facts were retained.

## Counts and method history

The expected page-level counts are:

| PDF page | Printed page | Page kind | Entries |
| ---: | ---: | --- | ---: |
| 56 | 45 | chapter opener | 0 |
| 57 | 46 | vocabulary | 14 |
| 58 | 47 | vocabulary | 16 |
| 59 | 48 | vocabulary | 13 |
| 60 | 49 | vocabulary | 16 |
| 61 | 50 | vocabulary | 11 |
| 62 | 51 | vocabulary | 5 |

The first Qwen pass was committed as `47a27c7`. It showed three useful
failure patterns: page 62 contained duplicate top-level keys and a nested
`content` object, page 61 omitted a part-of-speech value and cut the final
example, and page 57 initially drifted toward a semantically normalized
Chinese example.

The schema revision was committed as `3b1cdb5`. It enforced the nine fields
and recovered the missing page 61 POS, but it still created a false
`fragmented` entry from the continuation at the top of page 62.

The current page records use prompt version
`qwen3.7-flash-book-page-v3-ipa-continuations`, with the next API batch using
`qwen3.7-flash-book-page-v4-ipa-meaning-layout`. The v3 pass fixed the page 62
duplicate-key problem, preserved the page 57 example, improved IPA symbols,
and kept the continuation as page context. The final Markdown records also
contain a small number of source-verified layout cleanups; the original model
outputs remain in `raw-responses/qwen3.7-flash/`.

## What matched well

- Entry order and page boundaries were recovered reliably across this batch.
- Most headwords, examples, Chinese translations, collocations, and etymology
  notes were captured at a level close to the native visual transcription.
- The chapter opener preserved the quote and printed labels without importing
  the illustration into learner data.
- The explicit continuation rule prevented page 62's `fragmented` text from
  becoming a new vocabulary item after review.

## What did not match without guidance

- Qwen sometimes put a second POS label inside `meaning_zh`, for example
  `vent`, `compound`, `liquid`, `fluid`, `solid`, `ultraviolet`, and `squash`.
  These were separated into labeled senses after checking the image.
- A footer vocabulary list was attached to `flyby.notes`; it was moved to
  `page_notes` because it is page metadata, not a learner note.
- The alias `= synthesize` was placed in the meaning instead of the printed
  headword line and was moved to `headword`.
- The `fragment` example crossed the page boundary. The source-verified record
  joins the two visible pieces while retaining the cross-page provenance.
- IPA was generally readable, but stress marks and some vowel symbols were
  less stable than in the native visual pass. The prompt now calls out IPA
  explicitly, and uncertain cases still require image review.

## Decision

Qwen3.7-Flash is a useful scalable first-pass transcriber for this book, but
the result is not safe to publish blindly. Native visual reading remains the
quality oracle for layout joins, IPA, exact Chinese wording, and distinguishing
footer material from dictionary entries. The workflow therefore keeps the raw
API response, the reviewed page record, the page image, and the prompt version
together so later website imports can preserve provenance and review state.
