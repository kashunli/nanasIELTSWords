# SQLite content model

The runtime database is a read-only projection for learner requests. It is
rebuilt from preparation artifacts; it is not the source of truth for audio,
ASR, OCR, or browser learner state.

## Design goals

- Keep stable audio identity independent of mutable spelling, book numbering,
  or later editorial corrections.
- Store the learner-facing word and sentence separately so a reviewed book can
  replace one field without silently replacing the other.
- Keep book provenance and alignment evidence queryable without making OCR or
  model caches runtime dependencies.
- Keep raw transcription/review reasons available for audit without exposing
  transcription tags or review state in the learner-facing API.
- Leave Known, Flagged, playback, and review scheduling state
  in browser LocalStorage for this local-first version.

## Relationships

```mermaid
erDiagram
    collections ||--o{ chapters : contains
    collections ||--o{ word_items : publishes
    word_items ||--|| examples : has_main_sentence
    word_items ||--o| book_references : may_have
    word_items ||--o{ review_reasons : retains
    collections ||--o{ source_revisions : records

    collections {
        text code PK
        text title
        text source_id
        text content_version
        text updated_at
    }
    chapters {
        text collection_code FK
        integer number PK
        text title
        integer item_count
        integer transcript_review_count
    }
    word_items {
        text stable_id PK
        text item_uuid UK
        text collection_code FK
        integer chapter_number
        integer position
        text headword
        text part_of_speech
        text meaning_en
        text meaning_zh
        text word_audio
        text word_translation_audio nullable
        text transcript_status
        text meaning_status
        text accepted_word_source
        text accepted_sentence_source
    }
    examples {
        text stable_id PK
        text word_stable_id FK
        integer position
        text kind
        text text
        text sentence_audio
        text sentence_translation_audio nullable
        text transcript_status
        text accepted_sentence_source
    }
    book_references {
        text stable_id PK
        text book_word_id UK
        text headword
        text example_en
        text example_zh
        text alignment_status
        text alignment_evidence
        text sentence_match
        integer needs_review
        text review_reasons
    }
    review_reasons {
        text word_stable_id FK
        text source
        text reason
    }
    source_revisions {
        text artifact_type PK
        text artifact_hash
        text tool_version
        text generated_at
    }
```

## Field-source contract

`word_items.headword` and `examples.text` are accepted learner-facing values,
not necessarily raw ASR values. Their source is explicit:

| Runtime field | Use reviewed-book value when | Otherwise keep | Source column |
| --- | --- | --- | --- |
| `word_items.headword` | direct alignment, or a manually verified flagged `matched_order` pair | selected transcription headword | `accepted_word_source` |
| `examples.text` | reliable book-word/sentence alignment, or a manually verified flagged `matched_order` pair | selected transcription sentence | `accepted_sentence_source` |

The separate `book_references` row always retains the reviewed-book value,
alignment method, page provenance, and review reasons. The selected ASR
artifacts remain outside the runtime projection and are not deleted when a
book field becomes accepted. This projection rule does not change
`stable_id`, `item_uuid`, media paths, or browser progress keys.

The accepted-source and transcription-status columns are retained in the
rebuilt SQLite projection as internal provenance for validation and audit. They
are not returned by the Rust API. A reliable book-word alignment makes both
accepted sources `book`; the 37 previously flagged order-only pairs are handled
by the same book-backed rule after manual verification. Raw selected
transcripts and review reasons remain preparation/audit artifacts and are not
deleted by this projection rule.

Each item may also have two optional translation-audio paths:
`word_items.word_translation_audio` for the Chinese word translation and
`examples.sentence_translation_audio` for the Chinese sentence translation.
They are nullable because the current collection contains only English word
and sentence clips. When present, the Rust API exposes them as copied-media
URLs; when absent, the browser recipe keeps the corresponding editable row but
skips it during playback.

## Runtime boundary

The Rust API reads only `var/content/content.sqlite` and copied media. It does
not read `content/book-sources/`, selected transcript files, raw ASR runs, or
model caches during a learner request. `content_version` includes the
projection-rule version so changing field-selection semantics produces a new
runtime revision even when the input artifacts are unchanged.
