declare module "*.mjs" {
  export const ASR_REVIEW_STATE_KEY: string;
  export const ASR_REVIEW_STATE_VERSION: number;

  export interface AsrReviewSnapshot {
    version: number;
    updated_at: string;
    confirmed: Record<string, string>;
    word_confirmed: Record<string, WordConfirmation>;
  }

  export interface WordConfirmation {
    candidate: string;
    confirmed_at: string;
  }

  export function emptyReviewSnapshot(): AsrReviewSnapshot;
  export function normalizeReviewSnapshot(value: unknown): AsrReviewSnapshot;

  export class LocalAsrReviewState {
    constructor(storage?: Storage, now?: () => Date);
    subscribe(listener: () => void): () => void;
    load(): AsrReviewSnapshot;
    isConfirmed(stableId: string): boolean;
    wordConfirmation(stableId: string): WordConfirmation | undefined;
    isWordConfirmed(stableId: string): boolean;
    confirm(stableId: string): AsrReviewSnapshot;
    undo(stableId: string): AsrReviewSnapshot;
    confirmWord(stableId: string, candidate: string): AsrReviewSnapshot;
    undoWord(stableId: string): AsrReviewSnapshot;
    exportSnapshot(): AsrReviewSnapshot;
    restore(value: unknown): void;
    reset(): void;
  }

  export function nextPlaybackStep(options: {
    playbackMode: "words" | "sentences" | "both";
    playbackRunMode: "single" | "consecutive";
    phase: "word" | "sentence";
    hasSentence: boolean;
    hasNextEntry: boolean;
  }): "stop" | "sentence" | "next-entry";

  export function detectSilenceGapsMs(
    channels: Float32Array[],
    sampleRate: number,
    startMs: number,
    endMs: number,
  ): Array<{startMs: number; endMs: number}>;

  export function buildWaveformBars(
    channels: Float32Array[],
    sampleRate: number,
    startMs: number,
    endMs: number,
    requestedBarCount?: number,
  ): number[];
}
