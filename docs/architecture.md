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
                                      v
                             SQLite runtime projection
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

The React study wall also provides a separate, reversible browser-local ASR
confirmation queue for items that still need listening review. A learner can
compare the word audio with the sentence ASR and confirm a match without
rewriting SQLite, raw ASR, or review reasons. These browser decisions are
included in the local progress backup and remain keyed by stable item ID.
