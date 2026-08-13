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
