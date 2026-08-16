# Listening sequence design QA

## Source visual truth

- Original user-selected reference: `C:\Users\lochl\AppData\Local\Temp\codex-clipboard-5c2fd496-633d-4a7e-9afc-43818d1e0dc9.png`
  - Source pixels: 1616 × 973.
  - The reference shows a centered `PLAYBACK RECIPE` modal with a numbered listening timeline, five ordered occurrences, a later repeated English sentence, an `Add step` action, and reset/save actions.
- Normalized comparison source: `D:\n2Prepare\IELTSVocabulary\work\qa-source-normalized-1280x720.png`
  - Created by resizing the source to the rendered browser viewport; this is a QA normalization copy and does not modify the original reference.

## Rendered implementation evidence

- Final browser capture: `D:\n2Prepare\IELTSVocabulary\work\qa-listening-sequence-final.png`
  - Browser CSS viewport: 1280 × 720 px.
  - Screenshot pixels: 1280 × 720 px.
  - Device scale factor: 1.
  - State: Chapter 1, `atmosphere` selected, recipe reset to the selected five-occurrence default, modal open at scroll position 0.
- Combined comparison input: `D:\n2Prepare\IELTSVocabulary\work\qa-listening-sequence-comparison.png`
  - Source and implementation are shown side by side at the same normalized 1280 × 720 pixel size before visual judgment.

## Comparison evidence

The full modal comparison confirms that the implementation preserves the source hierarchy: uppercase recipe kicker, listening-sequence title, availability summary, explanatory sentence, numbered timeline, five row cards, dashed `Add step` button, and reset/save footer. The implementation uses a compact-height rule at this viewport so all five rows and the footer remain visible without modal overflow.

The focused comparison checked the row timeline and control region: numbered circles sit outside the row cards with a vertical connector, drag handles precede the row labels, duplicate English sentence row 5 has a `REPEAT` badge, and repeat/pause controls align at the right. The reference’s default values are also represented: translation rows start at repeat `0`, while English word and sentence occurrences are playable.

## Required fidelity surfaces

- Fonts and typography: the existing product font stack and green/cream hierarchy are reused. The compact desktop breakpoint brings the title, intro, row labels, field captions, and numeric controls close to the normalized reference’s optical scale while retaining readable controls at 1280 × 720.
- Spacing and layout rhythm: the modal is fixed and centered over the learner page, with the reference’s inset, rounded frame, row separation, numbered timeline, add-step gap, and footer breathing room. The compact-height rule keeps the complete recipe visible in shorter desktop windows. On narrow screens the timeline returns inside the card so controls remain usable.
- Colors and visual tokens: the implementation uses the existing pale green modal, cream row cards, muted green timeline, green secondary controls, and warm orange save action. The surrounding learner page is dimmed behind the modal.
- Image quality and asset fidelity: the reference contains no photographic or branded raster asset that needs recreation. No new decorative raster, inline SVG, or placeholder image was introduced; the existing product assets remain unchanged.
- Copy and content: the visible copy follows the selected design (`PLAYBACK RECIPE`, `Listening sequence`, `Each row is one playback occurrence`, `Add step`, `Reset sequence`, `Save sequence`) and labels the four audio element types explicitly.

## Findings

No actionable P0, P1, or P2 findings remain.

- [P3] The implementation exposes a small per-row remove control in addition to the reference’s drag and arrow ordering controls. This is an intentional functional extension so a user can undo an accidentally added occurrence without resetting the whole recipe.
- [P3] The selected reference is a large desktop mockup, while the in-app browser QA viewport is 1280 × 720. The compact-height breakpoint is intentional responsive adaptation; the source was normalized to the same comparison pixels before judgment.

## Interaction and diagnostics

- Reset/save: reset produced the selected five rows and closed/reopened cleanly after save.
- Add step: choosing `English sentence` appended a sixth occurrence with a `REPEAT` badge; save persisted it, and reopening restored it.
- Ordered playback: with the fifth row present, cue labels advanced in order `English word → Chinese word translation → English sentence → Chinese sentence translation → English sentence` when the corresponding rows were enabled.
- Scenario playback: enabling row 4 produced `English word → English sentence → Chinese sentence translation → English sentence`, proving the sentence is replayed after the Chinese sentence translation.
- Direct text playback: clicking a Chinese sentence text target changed the player to `Chinese sentence translation` and exposed the `Pause Chinese sentence translation` state.
- Browser diagnostics: no console warning or error entries were reported by the final browser session.
- Automated checks: `pnpm build` passed (`tsc --noEmit` plus Vite production build); `pnpm test` passed with 20/20 tests.

## Comparison history

### Pass 1 — selected editor implementation

- Earlier finding: the existing recipe editor was a compact four-element panel and could not represent a later duplicate occurrence.
- Fixes made: introduced occurrence IDs, duplicate-preserving normalization, append/remove operations, the five-row editor, add-step choices, drag/order controls, and v3 LocalStorage migration.
- Post-fix evidence: five rows render independently, duplicate rows persist, and the focused occurrence tests pass.

### Pass 2 — modal positioning

- Earlier finding: the editor was anchored above the fixed player dock; at 1280 × 720 its header and first row were clipped.
- Fix made: changed the editor to a centered fixed modal with a dimming shadow and a shorter-viewport layout.
- Post-fix evidence: the full sequence and footer fit in the 1280 × 720 capture without modal scroll overflow.

### Pass 3 — timeline and rhythm fidelity

- Earlier finding: row numbers were inside cards and the compact layout’s timeline and typography were visibly tighter/different from the source.
- Fixes made: moved numbered circles outside the cards, added the connector line, aligned row insets with the reference, and tuned compact desktop typography and spacing.
- Post-fix evidence: combined source/implementation comparison shows matching row geometry, five-step rhythm, duplicate badge placement, and footer alignment; no P0/P1/P2 findings remain.

## Implementation checklist

- [x] Recipe rows are ordered playback occurrences with stable IDs.
- [x] The same audio element can appear again later in the sequence.
- [x] The selected five-occurrence default is available after reset.
- [x] Older v1/v2 saved recipes migrate without losing their order or settings.
- [x] Add step, drag/order controls, per-row repeat/pause controls, reset, save, and remove are functional.
- [x] Duplicate occurrence IDs are included in cue target and transport identities.
- [x] Direct word, sentence, and translation text playback remains functional.
- [x] Frontend build and 20-test suite pass.

final result: passed
