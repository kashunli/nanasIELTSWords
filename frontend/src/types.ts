export type TranscriptStatus = "candidate" | "needs_review" | "book_reviewed";
export type MeaningStatus = "ai_draft" | "reviewed";

export interface Summary {
  collection_code: string;
  title: string;
  content_version: string;
  chapters: number;
  items: number;
  transcript_review_items: number;
  book_reference_items: number;
}

export interface Chapter {
  number: number;
  title: string;
  item_count: number;
  transcript_review_count: number;
}

export type BookAlignmentStatus = "matched_headword" | "matched_sentence" | "matched_order";
export type BookSentenceMatch = "exact" | "normalized" | "different";

export interface BookReference {
  book_word_id: string;
  headword: string;
  ipa: string;
  part_of_speech: string;
  meaning_zh: string;
  example_en: string;
  example_zh: string;
  collocations: string;
  word_formation: string;
  notes: string;
  source_page: string;
  pdf_page: number;
  printed_page?: number;
  position_on_page: number;
  alignment_status: BookAlignmentStatus;
  alignment_evidence: "headword" | "sentence" | "order";
  sentence_match: BookSentenceMatch;
  needs_review: boolean;
  review_reasons: string[];
}

export interface Item {
  stable_id: string;
  item_uuid: string;
  chapter: number;
  position: number;
  headword: string;
  part_of_speech: string;
  meaning_en: string;
  meaning_zh: string;
  sentence: string;
  transcript_status: TranscriptStatus;
  meaning_status: MeaningStatus;
  word_audio_url: string;
  sentence_audio_url: string;
  book_reference?: BookReference;
  accepted_word_source?: string;
  accepted_sentence_source?: string;
  review_reasons?: Array<{source: string; reason: string}>;
}

export interface CardState {
  item_uuid: string;
  known: boolean;
  flagged: boolean;
  sentence_starred: boolean;
  enrolled_at?: string;
  due_at?: string;
  review_level: number;
  last_played_at?: string;
  last_reviewed_at?: string;
  updated_at: string;
}
