export function buildSequence(item, mode) {
  if (mode === "words") return [{item, phase: "word"}];
  if (mode === "sentences") return [{item, phase: "sentence"}];
  return [{item, phase: "word"}, {item, phase: "sentence"}];
}

export function nextIndex(items, currentIndex, mode, phase) {
  const sequence = buildSequence(items[currentIndex], mode);
  const phaseIndex = sequence.findIndex(target => target.phase === phase);
  if (phaseIndex >= 0 && phaseIndex + 1 < sequence.length) return {index: currentIndex, phase: sequence[phaseIndex + 1].phase};
  if (currentIndex + 1 >= items.length) return null;
  return {index: currentIndex + 1, phase: mode === "sentences" ? "sentence" : "word"};
}
