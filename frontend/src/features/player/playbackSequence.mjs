/**
 * Keep the transport mode separate from the content mode.
 *
 * Content mode chooses which clip is focused. Transport mode decides whether
 * an ended clip stops or continues through the visible list. This is the same
 * contract used by the other study players, and it makes the UI state testable
 * without depending on an AudioContext or a browser event.
 */
export function nextPlaybackStep({
  playbackMode,
  playbackRunMode,
  phase,
  hasSentence,
  hasNextEntry,
}) {
  if (playbackRunMode === "single") return "stop";
  if (playbackMode === "both" && phase === "word" && hasSentence) return "sentence";
  return hasNextEntry ? "next-entry" : "stop";
}
