export type TranscriptStatus = "candidate" | "needs_review" | "book_reviewed";
export type MeaningStatus = "ai_draft" | "reviewed";

export interface Summary {
  collection_code: string;
  title: string;
  content_version: string;
  chapters: number;
  items: number;
  transcript_review_items: number;
}

export interface Chapter {
  number: number;
  title: string;
  item_count: number;
  transcript_review_count: number;
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
