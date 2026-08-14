# Mobile player design QA

## Source visual truth

- Reference control panel: `D:\n2Prepare\IELTSVocabulary\work\ui-qa\player-reference.png`
- The reference is the user-provided 667 × 281 px control-panel crop. It establishes the intended hierarchy of a single play control, transport controls, current-time context, and a pinpointable waveform; it does not define the rest of the vocabulary page.

## Rendered implementation evidence

- Mobile capture: `D:\n2Prepare\IELTSVocabulary\work\ui-qa\ielts-player-mobile.png`
  - Browser CSS viewport: 390 × 844 px
  - Screenshot pixels: 390 × 844 px
  - Device scale factor: 1
  - State: Chapter 1, `atmosphere` selected, bottom dock visible, audio paused after load
- Desktop capture: `D:\n2Prepare\IELTSVocabulary\work\ui-qa\ielts-player-desktop.png`
  - Browser CSS viewport: 1280 × 720 px
  - Screenshot pixels: 1280 × 720 px
  - Device scale factor: 1
  - State: Chapter 1, `atmosphere` selected, bottom dock visible, audio paused after load

## Comparison evidence

The source reference and the mobile implementation capture were opened together before this report. The focused comparison is the source control panel against the rendered `.player` region: the implementation keeps one primary play/pause control beside the decoded PCM waveform, with the remaining transport controls grouped above it. The full mobile capture was checked separately for page-level overflow and dock placement, and the desktop capture was checked for preservation of the two-column vocabulary layout.

- The mobile player reaches the viewport bottom at `y = 844` and the upper content region ends exactly at the dock top (`y ≈ 539.7`).
- The upper `.content-scroll` region has its own scroll height and moved to `scrollTop = 500` while the dock remained at the same bottom geometry.
- The mobile player has no horizontal page overflow; the play button and waveform remain in one row.
- The current line region ends at `y ≈ 1065.8` and the explanation region begins at `y ≈ 1077.8`, making the explanation an explicit section below the current line.
- At desktop width, the dock remains bottom-aligned and the study list/focus columns remain visible without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: existing product typography and hierarchy are preserved. The player adds a compact uppercase kicker, readable current-word label, tabular playback time, and touch-sized button labels. The mobile current line remains large enough to scan while the explanation cards use the existing dossier typography.
- Spacing and layout rhythm: the player is a compact stacked composition with metadata, transport actions, and a play-plus-waveform row. The content and dock are separate grid tracks, and the mobile explanation follows the current line with a deliberate 12 px gap.
- Colors and visual tokens: the existing dark-green player surface, warm gold primary action, pale waveform surface, and green dossier cards are reused rather than introducing a second theme.
- Image quality and asset fidelity: the existing book icon and decoded SVG waveform are preserved. No new decorative raster or placeholder asset was introduced.
- Copy and content: `CURRENT AUDIO`, `CURRENT LINE`, `EXPLANATION`, `中文翻译`, and `中文释义` distinguish the audio line translation from the word meaning. Raw ASR and source labels remain unchanged.

## Findings

No actionable P0, P1, or P2 findings remain.

- [P3] The reference uses icon-only transport symbols, while this implementation keeps short text labels and a labeled round `Play`/`Pause` button. This is intentional for touch discoverability and accessibility in the existing product; the button still exposes a dynamic `aria-label` and remains a single toggle.
- [P3] The supplied reference is a player-only crop from a different visual context, so the surrounding vocabulary page intentionally retains the repository's established green/cream design system.

## Interaction and diagnostics

- Play/pause: clicking `Play word audio` changed the control to `Pause word audio`; clicking it again returned it to `Play word audio`.
- Independent scrolling: verified with the mobile content region scrolled to `500` while the dock stayed bottom-aligned.
- Browser diagnostics: no warning or error console entries after the mobile and desktop checks.
- Focused automated checks: frontend tests passed (`12/12`); TypeScript and Vite build passed.

## Comparison history

### Pass 1 — initial implementation capture

- Earlier findings: the pre-change player put the waveform before a wrapping control row, allowed the dock to become internally scrollable, and kept the Chinese meaning card above the example line.
- Fixes made: moved the waveform into a play-plus-waveform transport row, made the dock non-scrolling and bottom-owned by the viewport grid, compacted the mobile control grid, and replaced the old meaning/translation placement with a current-line card followed by an explanation card.
- Post-fix evidence: mobile and desktop captures show no horizontal overflow; the dock stays bottom-aligned; the explanation starts after the current line; play/pause state changes are observable in the DOM; no console warnings/errors were reported.

## Implementation checklist

- [x] One visible play/pause toggle controls both states.
- [x] The control group and waveform remain in the bottom dock.
- [x] Only the upper content region scrolls on mobile and desktop.
- [x] The explanation is redesigned and placed below the current played line.
- [x] Existing decoded waveform playback and consecutive transport behavior are preserved.

final result: passed
