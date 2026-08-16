export const AUDIO_SEQUENCE_VERSION = 2;
export const AUDIO_ELEMENT_IDS = ["word", "word_translation", "sentence", "sentence_translation"];
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
    steps: AUDIO_ELEMENT_IDS.map(element => ({
      id: `${element}-1`,
      element,
      ...DEFAULT_STEP_VALUES[element],
    })),
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
  const source = value && typeof value === "object" ? value : {};
  const hasCurrentVersion = source.version === AUDIO_SEQUENCE_VERSION;
  const fillMissing = options.fillMissing !== false && !hasCurrentVersion;
  const ensurePlayable = options.ensurePlayable !== false;
  const candidateSteps = Array.isArray(source.steps) ? source.steps : [];
  const usedIds = new Set();
  const occurrenceCounts = new Map();
  const steps = [];

  for (const candidate of candidateSteps) {
    if (!candidate || typeof candidate !== "object" || !isElementId(candidate.element)) continue;
    // Version 1 could only represent one row per element. Preserve duplicate
    // rows only after the occurrence-id format has been introduced.
    if (!hasCurrentVersion && occurrenceCounts.has(candidate.element)) continue;

    const occurrence = (occurrenceCounts.get(candidate.element) || 0) + 1;
    const fallback = DEFAULT_STEP_VALUES[candidate.element];
    occurrenceCounts.set(candidate.element, occurrence);
    const baseId = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `${candidate.element}-${occurrence}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    steps.push({
      id,
      element: candidate.element,
      repeatCount: normalizeRepeatCount(candidate.repeatCount, fallback.repeatCount),
      pauseAfterSeconds: normalizePause(candidate.pauseAfterSeconds, fallback.pauseAfterSeconds),
    });
  }

  if (fillMissing) {
    for (const element of AUDIO_ELEMENT_IDS) {
      if (occurrenceCounts.has(element)) continue;
      steps.push({
        id: `${element}-1`,
        element,
        ...DEFAULT_STEP_VALUES[element],
      });
    }
  }
  if (steps.length === 0 && options.fillMissing !== false) return createDefaultAudioSequence();
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
  return normalizeAudioSequence({version: AUDIO_SEQUENCE_VERSION, steps});
}

export function updateAudioSequenceStep(value, stepId, patch) {
  const sequence = normalizeAudioSequence(value);
  if (!patch || typeof patch !== "object") return sequence;
  const directIdIndex = sequence.steps.findIndex(step => step.id === stepId);
  const index = directIdIndex >= 0 ? directIdIndex : sequence.steps.findIndex(step => step.element === stepId);
  if (index < 0) return sequence;
  const steps = sequence.steps.map((step, stepIndex) => {
    if (stepIndex !== index) return step;
    return {
      ...step,
      repeatCount: patch.repeatCount === undefined
        ? step.repeatCount
        : normalizeRepeatCount(patch.repeatCount, step.repeatCount),
      pauseAfterSeconds: patch.pauseAfterSeconds === undefined
        ? step.pauseAfterSeconds
        : normalizePause(patch.pauseAfterSeconds, step.pauseAfterSeconds),
    };
  });
  return normalizeAudioSequence({version: AUDIO_SEQUENCE_VERSION, steps});
}

export function appendAudioSequenceStep(value, element) {
  const sequence = normalizeAudioSequence(value);
  if (!isElementId(element)) return sequence;
  const occurrence = sequence.steps.filter(step => step.element === element).length + 1;
  const usedIds = new Set(sequence.steps.map(step => step.id));
  let id = `${element}-${occurrence}`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${element}-${occurrence}-${suffix}`;
    suffix += 1;
  }
  return normalizeAudioSequence({
    version: AUDIO_SEQUENCE_VERSION,
    steps: [...sequence.steps, {id, element, ...DEFAULT_STEP_VALUES[element]}],
  });
}

export function removeAudioSequenceStep(value, stepId) {
  const sequence = normalizeAudioSequence(value);
  if (sequence.steps.length <= 1) return sequence;
  const index = sequence.steps.findIndex(step => step.id === stepId);
  if (index < 0) return sequence;
  return normalizeAudioSequence({
    version: AUDIO_SEQUENCE_VERSION,
    steps: sequence.steps.filter((_, stepIndex) => stepIndex !== index),
  });
}

export function expandPlayableAudioSequence(value, audioUrls) {
  const sequence = normalizeAudioSequence(value, {fillMissing: false, ensurePlayable: false});
  return sequence.steps.flatMap(step => {
    const url = audioUrls && typeof audioUrls[step.element] === "string" ? audioUrls[step.element] : "";
    if (!url) return [];
    return Array.from({length: step.repeatCount}, (_, index) => ({
      id: step.id,
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
