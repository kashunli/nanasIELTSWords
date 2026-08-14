# Book OCR methods and prompts

This corpus deliberately records the OCR method per page. The source image is
the authority; a model response is preparation evidence, not an automatic
permission to publish a learner-facing record.

## GPT-native visual pages

Prompt/version: `gpt-book-ocr-v1`

OCR method: `gpt-native-vision`

The assistant renders each local PDF page to PNG, calls `view_image`, reads the
visible page from its own visual context, and writes the page record. These
pages are useful as a visual quality reference for reviewing later Qwen
records.

## Regular vocabulary page

Read the page image itself. Transcribe one record per main printed vocabulary
headword, left column top-to-bottom and then right column top-to-bottom unless
the page visibly uses another order. Preserve English, IPA, part of speech,
Chinese meaning, example sentence, Chinese translation, collocations,
word-formation notes, and printed usage notes. Keep compound headwords as one
entry. Ignore footer word lists, page numbers, decorative artwork, and words
that appear only inside an illustration. Use `[unclear]` instead of guessing.

## Chapter-opening illustration

Do not describe or reproduce the picture. Preserve the chapter title,
quotation, and printed labels attached to the picture as `image_labels`.
Labels are annotations, not regular entries, unless the main vocabulary pages
also contain them.

## Page records and validation

Every page record carries its PDF page, printed page, page type, method,
picture policy, and review flags. Blank pages are recorded without a visual
transcription. Source sequences and printed indexes are used only for coverage
checks; they never silently rewrite what a page visibly says.

## Qwen3.7-Flash pages (historical Chapter 4 batch)

Runner: `tools/ocr_book_pages_qwen.py`

The Qwen method sends one rendered page at a time to the `qwen3.7-flash`
multimodal model through the local DashScope client. The runner stores both
the raw response and a normalized Markdown/JSON page record. The active prompt
version is `qwen3.7-flash-book-page-v4-ipa-meaning-layout`.

The prompt was tightened after comparing the first Chapter 4 batch with native
visual transcription. It now requires exactly one `entries` array, all nine
entry fields, printed IPA symbols, explicit part-of-speech labels in Chinese
meanings, aliases on the headword line, footer text in `page_notes`, and
explicit treatment of cross-page continuations. See
`notes/qwen_quality_review_ch4.md` for the observed errors and corrections.
The project currently resumes native visual transcription after the reviewed
PDF 56–62 batch; retaining this runner makes that Qwen milestone reproducible
without changing the native default.
