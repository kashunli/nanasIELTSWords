# IELTS雅思词汇真经 source extraction

This directory contains the page-level extraction artifacts for the scanned
`IELTS雅思词汇真经 (刘洪波) (z-lib.org).pdf` supplied at the repository root.

The PDF is image-only. `book_manifest.json` records the source hash, printed
page mapping, chapter boundaries, and page types. The OCR runner renders pages
at 200 DPI and prepares a local page queue. Page front matter records the
method used for each transcription: the earlier pages were authored by GPT's
native visual ability (`gpt-native-vision`), while the current continuation
uses Qwen3.7-Flash through the local `tools/ocr_book_pages_qwen.py` runner.
Qwen's raw responses are retained under `raw-responses/qwen3.7-flash/` and
are never replaced by the reviewed Markdown record. Each page has a
Markdown/JSON record under `page-ocr/`. Illustrations are omitted from learner
data, but printed vocabulary labels on chapter-opening illustrations are
retained as separate opener annotations.

The reviewed Qwen batch currently covers PDF pages 56–62. Subsequent unfinished
pages resume the native visual workflow unless a page is explicitly assigned a
different method.

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

The native visual queue is resumable. To prepare a page or range again, use
`--force` together with `--start` and `--end`, then use `view_image` to author
the corresponding page records. For Qwen pages, load the user-scoped
`ALIBABA_CN_API_KEY` into `QWEN_TASK_API_KEY` for the process and run, for
example, `python tools/ocr_book_pages_qwen.py --start 64 --end 70`.
Qwen output is a first pass: compare it with the rendered page before
publishing learner-facing data, especially for IPA, multiple parts of speech,
footer text, and examples split across pages. The PDF itself is deliberately
not copied into this directory or staged by the extraction workflow.
