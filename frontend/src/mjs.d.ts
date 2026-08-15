declare module "*.mjs" {
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
