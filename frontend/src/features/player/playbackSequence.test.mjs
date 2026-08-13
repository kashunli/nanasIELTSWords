import test from "node:test";
import assert from "node:assert/strict";
import {nextIndex} from "./playbackSequence.mjs";

const items = [{stable_id: "a"}, {stable_id: "b"}];
test("word-plus-sentence stays together", () => {
  assert.deepEqual(nextIndex(items, 0, "both", "word"), {index: 0, phase: "sentence"});
  assert.deepEqual(nextIndex(items, 0, "both", "sentence"), {index: 1, phase: "word"});
});
test("single phase advances to next item", () => {
  assert.deepEqual(nextIndex(items, 0, "words", "word"), {index: 1, phase: "word"});
});
