import test from "node:test";
import assert from "node:assert/strict";
import {nextPlaybackStep} from "./playbackSequence.mjs";

test("single mode stops after the focused word clip", () => {
  assert.equal(nextPlaybackStep({
    playbackMode: "both",
    playbackRunMode: "single",
    phase: "word",
    hasSentence: true,
    hasNextEntry: true,
  }), "stop");
});

test("single mode stops after the focused sentence clip", () => {
  assert.equal(nextPlaybackStep({
    playbackMode: "both",
    playbackRunMode: "single",
    phase: "sentence",
    hasSentence: true,
    hasNextEntry: true,
  }), "stop");
});

test("consecutive word-plus-sentence mode keeps the current entry together", () => {
  assert.equal(nextPlaybackStep({
    playbackMode: "both",
    playbackRunMode: "consecutive",
    phase: "word",
    hasSentence: true,
    hasNextEntry: true,
  }), "sentence");
});

test("consecutive mode advances to the next entry after the current sequence", () => {
  assert.equal(nextPlaybackStep({
    playbackMode: "both",
    playbackRunMode: "consecutive",
    phase: "sentence",
    hasSentence: true,
    hasNextEntry: true,
  }), "next-entry");
});

test("consecutive mode stops at the end of the visible list", () => {
  assert.equal(nextPlaybackStep({
    playbackMode: "words",
    playbackRunMode: "consecutive",
    phase: "word",
    hasSentence: false,
    hasNextEntry: false,
  }), "stop");
});
