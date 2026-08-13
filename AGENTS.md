# IELTSVocabulary maintenance rules

This repository is a private, local-first IELTS vocabulary study service.

- The immutable input is the Bilibili-derived cut manifest and its source audio.
- Preparation artifacts (ASR, meanings, mappings) are separate from the runtime
  projection in `var/content/`.
- The runtime API reads only SQLite and copied media; it must not read source
  audio, raw ASR caches, or model caches during a learner request.
- Stable item IDs are based on chapter and acoustic position, never on mutable
  spelling or future book numbering.
- Keep learner state in browser LocalStorage. Do not add accounts or server-side
  learner marks for this local version.
- Preserve raw ASR and review reasons. Do not silently correct uncertain text.
- Future reviewed book/PDF material may replace learner-facing fields while
  preserving raw evidence, audio identity, and learner progress.
- Before every commit, run focused checks for the files changed and stage only
  those files. Never use `git add .`.
- Commit every coherent milestone with a specific message ending in:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
