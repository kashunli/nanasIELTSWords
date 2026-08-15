export const AUDIO_SEQUENCE_VERSION = 1;
export const AUDIO_ELEMENT_IDS = ["word", "sentence", "word_translation", "sentence_translation"];
export const MAX_REPEAT_COUNT = 20;
export const MAX_PAUSE_SECONDS = 60;

const DEFAULT_STEP_VALUES = {
  word: {repeatCount: 1, pauseAfterSeconds: 0},
  sentence: {repeatCount: 1, pauseAfterSeconds: 0},
  word_translation: {repeatCount: 1, pauseAfterSeconds: 0},
  sentence_translation: {repeatCount: 1, pauseAfterSeconds: 0},
};

export function createDefaultAudioSequence() {
  return {
    version: AUDIO_SEQUENCE_VERSION,
    steps: AUDIO_ELEMENT_IDS.map(element => ({element, ...DEFAULT_STEP_VALUES[element]})),
  };
}

function isElementId(value) {
  return typeof value === "string" && AUDIO_ELEMENT_IDS.includes(value);
}

function normalizeRepeatCount(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_REPEAT_COUNT, Math.max(0, Math.round(number)));
}

function normalizePause(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_PAUSE_SECONDS, Math.max(0, number));
}

export function normalizeAudioSequence(value, options = {}) {
  const fillMissing = options.fillMissing !== false;
  const ensurePlayable = options.ensurePlayable !== false;
  const defaults = createDefaultAudioSequence();
  const candidateSteps = value && typeof value === "object" && Array.isArray(value.steps) ? value.steps : [];
  const byElement = new Map();
  for (const candidate of candidateSteps) {
    if (!candidate || typeof candidate !== "object" || !isElementId(candidate.element) || byElement.has(candidate.element)) continue;
    const fallback = DEFAULT_STEP_VALUES[candidate.element];
    byElement.set(candidate.element, {
      element: candidate.element,
      repeatCount: normalizeRepeatCount(candidate.repeatCount, fallback.repeatCount),
      pauseAfterSeconds: normalizePause(candidate.pauseAfterSeconds, fallback.pauseAfterSeconds),
    });
  }
  const steps = [];
  for (const element of candidateSteps) {
    if (!element || typeof element !== "object" || !isElementId(element.element)) continue;
    const step = byElement.get(element.element);
    if (step && !steps.some(existing => existing.element === step.element)) steps.push(step);
  }
  if (fillMissing) {
    for (const step of defaults.steps) {
      if (!steps.some(existing => existing.element === step.element)) steps.push({...step});
    }
  }
  if (ensurePlayable && steps.length > 0 && !steps.some(step => step.repeatCount > 0)) {
    steps[0] = {...steps[0], repeatCount: DEFAULT_STEP_VALUES[steps[0].element].repeatCount};
  }
  return {version: AUDIO_SEQUENCE_VERSION, steps};
}

export function reorderAudioSequence(value, fromIndex, toIndex) {
  const sequence = normalizeAudioSequence(value);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= sequence.steps.length || toIndex >= sequence.steps.length) return sequence;
  const steps = [...sequence.steps];
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved);
  return {version: AUDIO_SEQUENCE_VERSION, steps};
}

export function updateAudioSequenceStep(value, element, patch) {
  const sequence = normalizeAudioSequence(value);
  if (!isElementId(element) || !patch || typeof patch !== "object") return sequence;
  return normalizeAudioSequence({
    version: AUDIO_SEQUENCE_VERSION,
    steps: sequence.steps.map(step => step.element === element ? {
      ...step,
      repeatCount: normalizeRepeatCount(patch.repeatCount, step.repeatCount),
      pauseAfterSeconds: normalizePause(patch.pauseAfterSeconds, step.pauseAfterSeconds),
    } : {...step}),
  });
}

export function expandPlayableAudioSequence(value, audioUrls) {
  const sequence = normalizeAudioSequence(value, {fillMissing: false, ensurePlayable: false});
  return sequence.steps.flatMap(step => {
    const url = audioUrls && typeof audioUrls[step.element] === "string" ? audioUrls[step.element] : "";
    if (!url) return [];
    return Array.from({length: step.repeatCount}, (_, index) => ({
      element: step.element,
      url,
      occurrence: index + 1,
      repeatCount: step.repeatCount,
      pauseAfterSeconds: step.pauseAfterSeconds,
    }));
  });
}

export function nextAudioSequenceStep({cueIndex, cueCount, runMode, hasNextItem}) {
  if (!Number.isInteger(cueIndex) || !Number.isInteger(cueCount) || cueCount <= 0) return "stop";
  if (cueIndex < cueCount - 1) return "next-cue";
  return runMode === "consecutive" && hasNextItem ? "next-item" : "stop";
}
