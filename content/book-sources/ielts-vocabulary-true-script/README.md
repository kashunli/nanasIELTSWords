# IELTS雅思词汇真经 source extraction

This directory contains the page-level extraction artifacts for the scanned
`IELTS雅思词汇真经 (刘洪波) (z-lib.org).pdf` supplied at the repository root.

The PDF is image-only. `book_manifest.json` records the source hash, printed
page mapping, chapter boundaries, and page types. The OCR runner renders pages
at 200 DPI and prepares a local visual queue. The actual transcription is
authored by GPT from each page image shown with `view_image`; no OCR engine,
multimodal API, or outside service is used. Each page has a Markdown/JSON
record under `page-ocr/`. Illustrations are omitted from learner data, but
printed vocabulary labels on chapter-opening illustrations are retained as
separate opener annotations.

`book_words.json` is a preparation artifact for a later website importer. It
does not replace the audio-backed runtime content and does not mutate learner
state. When a page is uncertain, the record keeps `needs_review` and the
validation report lists the reason rather than silently correcting the text.

Run from the repository root:

```powershell
python tools/build_book_manifest.py
python tools/render_book_pages.py
python tools/prepare_visual_ocr.py
python tools/parse_book_ocr.py
```

The visual queue is resumable. To prepare a page or range again, use
`--force` together with `--start` and `--end`, then use `view_image` to author
the corresponding page records. The PDF itself is deliberately not copied
into this directory or staged by the extraction workflow.
