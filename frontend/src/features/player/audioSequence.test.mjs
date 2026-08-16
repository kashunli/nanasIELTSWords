import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAudioSequenceStep,
  createDefaultAudioSequence,
  expandPlayableAudioSequence,
  normalizeAudioSequence,
  nextAudioSequenceStep,
  removeAudioSequenceStep,
  reorderAudioSequence,
  updateAudioSequenceStep,
} from "./audioSequence.mjs";

test("the default recipe is the five-occurrence listening sequence", () => {
  const result = createDefaultAudioSequence();
  assert.deepEqual(result.steps.map(step => step.element), [
    "word",
    "word_translation",
    "sentence",
    "sentence_translation",
    "sentence",
  ]);
  assert.deepEqual(result.steps.map(step => step.id), ["word-1", "word_translation-1", "sentence-1", "sentence_translation-1", "sentence-2"]);
  assert.deepEqual(result.steps.map(step => step.repeatCount), [1, 0, 1, 0, 1]);
});

test("normalization keeps every legacy element once and clamps unsafe editor values", () => {
  const result = normalizeAudioSequence({
    version: 1,
    steps: [
      {element: "sentence", repeatCount: 2.6, pauseAfterSeconds: -4},
      {element: "sentence", repeatCount: 99, pauseAfterSeconds: 99},
      {element: "unknown", repeatCount: 2, pauseAfterSeconds: 1},
    ],
  });
  assert.deepEqual(result.steps.map(step => step.element), [
    "sentence",
    "word",
    "word_translation",
    "sentence_translation",
  ]);
  assert.equal(result.steps[0].repeatCount, 3);
  assert.equal(result.steps[0].pauseAfterSeconds, 0);
});

test("current normalization preserves duplicate occurrences", () => {
  const result = normalizeAudioSequence({
    version: 2,
    steps: [
      {id: "word-1", element: "word", repeatCount: 1, pauseAfterSeconds: 0},
      {id: "sentence-1", element: "sentence", repeatCount: 1, pauseAfterSeconds: 0},
      {id: "sentence-2", element: "sentence", repeatCount: 1, pauseAfterSeconds: 0},
    ],
  });
  assert.deepEqual(result.steps.map(step => step.id), ["word-1", "sentence-1", "sentence-2"]);
});

test("a zero repeat disables one element while another positive repeat keeps the recipe playable", () => {
  const result = updateAudioSequenceStep(
    updateAudioSequenceStep(createDefaultAudioSequence(), "word", {repeatCount: 0}),
    "sentence", {repeatCount: 2},
  );
  assert.equal(result.steps.find(step => step.element === "word").repeatCount, 0);
  assert.equal(result.steps.find(step => step.element === "sentence").repeatCount, 2);
  assert.ok(result.steps.some(step => step.repeatCount > 0));
});

test("normalization restores one active repeat when an invalid all-zero recipe is loaded", () => {
  const result = normalizeAudioSequence({
    steps: createDefaultAudioSequence().steps.map(step => ({...step, repeatCount: 0})),
  });
  assert.equal(result.steps.filter(step => step.repeatCount > 0).length, 1);
  assert.equal(result.steps[0].repeatCount, 1);
});

test("reordering moves one element without losing the other settings", () => {
  const source = updateAudioSequenceStep(createDefaultAudioSequence(), "sentence-1", {repeatCount: 3, pauseAfterSeconds: 1.5});
  const result = reorderAudioSequence(source, 1, 3);
  assert.deepEqual(result.steps.map(step => step.element), ["word", "sentence", "sentence_translation", "word_translation", "sentence"]);
  assert.deepEqual(result.steps[1], {id: "sentence-1", element: "sentence", repeatCount: 3, pauseAfterSeconds: 1.5});
});

test("appending and removing an occurrence enables a later repeat", () => {
  const base = normalizeAudioSequence({
    version: 2,
    steps: [
      {id: "word-1", element: "word", repeatCount: 1, pauseAfterSeconds: 0},
      {id: "word_translation-1", element: "word_translation", repeatCount: 1, pauseAfterSeconds: 0},
      {id: "sentence-1", element: "sentence", repeatCount: 1, pauseAfterSeconds: 0},
      {id: "sentence_translation-1", element: "sentence_translation", repeatCount: 1, pauseAfterSeconds: 0},
    ],
  });
  const appended = appendAudioSequenceStep(base, "sentence");
  assert.deepEqual(appended.steps.map(step => step.element), ["word", "word_translation", "sentence", "sentence_translation", "sentence"]);
  assert.equal(appended.steps.at(-1).id, "sentence-2");
  const removed = removeAudioSequenceStep(appended, "sentence-1");
  assert.deepEqual(removed.steps.map(step => step.element), ["word", "word_translation", "sentence_translation", "sentence"]);
  assert.equal(removed.steps.some(step => step.id === "sentence-1"), false);
});

test("expansion skips future clips until their URLs are available and repeats ready clips", () => {
  const source = normalizeAudioSequence({
    version: 2,
    steps: [
      {id: "word-1", element: "word", repeatCount: 2, pauseAfterSeconds: 0.75},
      {id: "sentence-1", element: "sentence", repeatCount: 0, pauseAfterSeconds: 3},
      {id: "word_translation-1", element: "word_translation", repeatCount: 4, pauseAfterSeconds: 1},
      {id: "sentence-2", element: "sentence", repeatCount: 1, pauseAfterSeconds: 0},
    ],
  });
  const result = expandPlayableAudioSequence(source, {word: "/word.mp3", sentence: "/sentence.mp3"});
  assert.deepEqual(result.map(cue => `${cue.id}:${cue.occurrence}`), ["word-1:1", "word-1:2", "sentence-2:1"]);
  assert.equal(result[0].pauseAfterSeconds, 0.75);
});

test("expansion omits an element whose global repeat count is zero", () => {
  const source = normalizeAudioSequence({
    version: 2,
    steps: [
      {id: "word-1", element: "word", repeatCount: 0, pauseAfterSeconds: 0},
      {id: "sentence-1", element: "sentence", repeatCount: 1, pauseAfterSeconds: 0},
    ],
  });
  const result = expandPlayableAudioSequence(source, {word: "/word.mp3", sentence: "/sentence.mp3"});
  assert.deepEqual(result.map(cue => cue.element), ["sentence"]);
});

test("a filtered playback mode does not re-enable its zero-repeat element", () => {
  const result = expandPlayableAudioSequence({
    version: 1,
    steps: [{element: "word", repeatCount: 0, pauseAfterSeconds: 0}],
  }, {word: "/word.mp3"});
  assert.deepEqual(result, []);
});

test("single mode completes the current recipe while consecutive mode can move to the next item", () => {
  assert.equal(nextAudioSequenceStep({cueIndex: 0, cueCount: 4, runMode: "single", hasNextItem: true}), "next-cue");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "single", hasNextItem: true}), "stop");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "consecutive", hasNextItem: true}), "next-item");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "consecutive", hasNextItem: false}), "stop");
});
