import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultAudioSequence,
  expandPlayableAudioSequence,
  normalizeAudioSequence,
  nextAudioSequenceStep,
  reorderAudioSequence,
  updateAudioSequenceStep,
} from "./audioSequence.mjs";

test("the default recipe contains the four audio elements in the stable order", () => {
  assert.deepEqual(createDefaultAudioSequence().steps.map(step => step.element), [
    "word",
    "sentence",
    "word_translation",
    "sentence_translation",
  ]);
});

test("normalization keeps every element once and clamps unsafe editor values", () => {
  const result = normalizeAudioSequence({
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

test("reordering moves one element without losing the other settings", () => {
  const source = updateAudioSequenceStep(createDefaultAudioSequence(), "sentence", {repeatCount: 3, pauseAfterSeconds: 1.5});
  const result = reorderAudioSequence(source, 1, 3);
  assert.deepEqual(result.steps.map(step => step.element), ["word", "word_translation", "sentence_translation", "sentence"]);
  assert.deepEqual(result.steps[3], {element: "sentence", repeatCount: 3, pauseAfterSeconds: 1.5});
});

test("expansion skips future clips until their URLs are available and repeats ready clips", () => {
  const source = updateAudioSequenceStep(
    updateAudioSequenceStep(createDefaultAudioSequence(), "word", {repeatCount: 2, pauseAfterSeconds: 0.75}),
    "word_translation",
    {repeatCount: 4, pauseAfterSeconds: 1},
  );
  const result = expandPlayableAudioSequence(source, {word: "/word.mp3", sentence: "/sentence.mp3"});
  assert.deepEqual(result.map(cue => `${cue.element}:${cue.occurrence}`), ["word:1", "word:2", "sentence:1"]);
  assert.equal(result[0].pauseAfterSeconds, 0.75);
});

test("single mode completes the current recipe while consecutive mode can move to the next item", () => {
  assert.equal(nextAudioSequenceStep({cueIndex: 0, cueCount: 4, runMode: "single", hasNextItem: true}), "next-cue");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "single", hasNextItem: true}), "stop");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "consecutive", hasNextItem: true}), "next-item");
  assert.equal(nextAudioSequenceStep({cueIndex: 3, cueCount: 4, runMode: "consecutive", hasNextItem: false}), "stop");
});
