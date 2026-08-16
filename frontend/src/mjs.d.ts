declare module "*.mjs" {
  export const AUDIO_ELEMENT_IDS: import("./types").AudioElementId[];
  export const MAX_REPEAT_COUNT: number;
  export const MAX_PAUSE_SECONDS: number;

  export function createDefaultAudioSequence(): import("./types").AudioSequenceConfig;
  export function normalizeAudioSequence(value: unknown, options?: {fillMissing?: boolean; ensurePlayable?: boolean}): import("./types").AudioSequenceConfig;
  export function reorderAudioSequence(value: unknown, fromIndex: number, toIndex: number): import("./types").AudioSequenceConfig;
  export function updateAudioSequenceStep(value: unknown, stepId: string, patch: Partial<Pick<import("./types").AudioSequenceStep, "repeatCount" | "pauseAfterSeconds">>): import("./types").AudioSequenceConfig;
  export function appendAudioSequenceStep(value: unknown, element: import("./types").AudioElementId): import("./types").AudioSequenceConfig;
  export function removeAudioSequenceStep(value: unknown, stepId: string): import("./types").AudioSequenceConfig;
  export function expandPlayableAudioSequence(value: unknown, audioUrls: Partial<Record<import("./types").AudioElementId, string>>): Array<import("./types").AudioSequenceStep & {url: string; occurrence: number}>;
  export function nextAudioSequenceStep(options: {cueIndex: number; cueCount: number; runMode: "single" | "consecutive"; hasNextItem: boolean}): "next-cue" | "next-item" | "stop";

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
