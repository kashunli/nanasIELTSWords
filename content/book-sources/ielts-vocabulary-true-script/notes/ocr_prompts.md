# GPT-native visual OCR record

Prompt/version: `gpt-book-ocr-v1`

OCR method: `gpt-native-vision`

No outside OCR API, OCR engine, Qwen, Aliyun, Tesseract, or automated text
recognition service is used for this corpus. The assistant renders each local
PDF page to PNG, calls `view_image`, reads the visible page, and writes the
page record from its own visual context.

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
transcription. The local validator checks page continuity, JSON shape, and
that no record claims an external OCR method. Source sequences and printed
indexes are used only for coverage checks; they never silently rewrite what a
page visibly says.
