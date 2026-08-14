import { useId, useMemo } from "react";

import { buildWaveformBars } from "./waveform.mjs";

interface SilenceInterval {
  start_ms: number;
  end_ms: number;
}

interface LineWaveformProps {
  audioBuffer: AudioBuffer | null;
  loadFailed: boolean;
  start: number;
  end: number;
  currentTime: number;
  silenceGaps: SilenceInterval[];
  vadNonSpeechIntervals: SilenceInterval[];
  ariaLabel?: string;
  onSeek: (time: number) => void;
}

const BAR_COUNT = 148;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export function LineWaveform({
  audioBuffer,
  loadFailed,
  start,
  end,
  currentTime,
  silenceGaps,
  vadNonSpeechIntervals,
  ariaLabel = "Audio playback position",
  onSeek,
}: LineWaveformProps) {
  const clipId = "waveform-progress-" + useId().replace(/:/g, "");
  const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.01, end) : safeStart + 0.01;
  const safeCurrent = Math.min(safeEnd, Math.max(safeStart, currentTime));
  const lineDuration = safeEnd - safeStart;
  const progress = (safeCurrent - safeStart) / lineDuration;

  const bars = useMemo(() => {
    if (!audioBuffer) return [];
    const channels = Array.from(
      { length: audioBuffer.numberOfChannels },
      (_, index) => audioBuffer.getChannelData(index),
    );
    return buildWaveformBars(
      channels,
      audioBuffer.sampleRate,
      safeStart * 1000,
      safeEnd * 1000,
      BAR_COUNT,
    );
  }, [audioBuffer, safeEnd, safeStart]);

  const displayedBars = bars.length ? bars : Array.from({ length: BAR_COUNT }, () => 0.07);
  const gap = 2.1;
  const barWidth = (1000 - gap * (displayedBars.length - 1)) / displayedBars.length;
  const barElements = displayedBars.map((height, index) => {
    const renderedHeight = Math.max(5, height * 84);
    return (
      <rect
        key={index}
        x={index * (barWidth + gap)}
        y={(100 - renderedHeight) / 2}
        width={barWidth}
        height={renderedHeight}
        rx={Math.min(2, barWidth / 2)}
      />
    );
  });
  const silenceElements = silenceGaps.map((gap, index) => {
    const startMs = Math.max(safeStart * 1000, gap.start_ms);
    const endMs = Math.min(safeEnd * 1000, gap.end_ms);
    if (endMs <= startMs) return null;
    return (
      <rect
        key={index}
        className="waveform-silence-gap"
        x={((startMs / 1000 - safeStart) / lineDuration) * 1000}
        y="2"
        width={((endMs - startMs) / 1000 / lineDuration) * 1000}
        height="96"
        rx="3"
      />
    );
  });
  const vadSilenceElements = vadNonSpeechIntervals.map((interval, index) => {
    const startMs = Math.max(safeStart * 1000, interval.start_ms);
    const endMs = Math.min(safeEnd * 1000, interval.end_ms);
    if (endMs <= startMs) return null;
    return (
      <rect
        key={index}
        className="waveform-vad-silence"
        x={((startMs / 1000 - safeStart) / lineDuration) * 1000}
        y="2"
        width={((endMs - startMs) / 1000 / lineDuration) * 1000}
        height="96"
        rx="3"
      />
    );
  });

  return (
    <div className={"line-waveform" + (bars.length ? " is-ready" : " is-loading")}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={progress * 1000} height="100" />
          </clipPath>
        </defs>
        <g className="waveform-silence-gaps">{silenceElements}</g>
        <g className="waveform-vad-silence-gaps">{vadSilenceElements}</g>
        <g className="waveform-unplayed">{barElements}</g>
        <g className="waveform-played" clipPath={`url(#${clipId})`}>{barElements}</g>
        <line className="waveform-cursor" x1={progress * 1000} x2={progress * 1000} y1="4" y2="96" />
      </svg>
      <input
        type="range"
        min={safeStart}
        max={safeEnd}
        step="0.01"
        value={safeCurrent}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={`${formatTime(safeCurrent - safeStart)} / ${formatTime(lineDuration)}`}
      />
      {loadFailed ? <span className="sr-only">The waveform could not be decoded. Seeking is still available.</span> : null}
    </div>
  );
}
