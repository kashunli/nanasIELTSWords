import test from "node:test";
import assert from "node:assert/strict";
import {emptyReviewSnapshot, LocalAsrReviewState, normalizeReviewSnapshot} from "./asrReviewState.mjs";

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("sentence confirmation persists and can be undone", () => {
  const values = storage();
  const first = new LocalAsrReviewState(values, () => new Date("2026-08-14T00:00:00Z"));
  first.confirm("item-1");
  assert.equal(first.isConfirmed("item-1"), true);
  assert.equal(new LocalAsrReviewState(values).isConfirmed("item-1"), true);
  first.undo("item-1");
  assert.equal(first.isConfirmed("item-1"), false);
});

test("word candidate confirmation is independent from sentence confirmation", () => {
  const values = storage();
  const first = new LocalAsrReviewState(values, () => new Date("2026-08-14T00:00:00Z"));
  first.confirmWord("item-1", "plateau");
  assert.deepEqual(first.wordConfirmation("item-1"), {candidate: "plateau", confirmed_at: "2026-08-14T00:00:00.000Z"});
  assert.equal(first.isConfirmed("item-1"), false);
  assert.deepEqual(new LocalAsrReviewState(values).wordConfirmation("item-1"), {candidate: "plateau", confirmed_at: "2026-08-14T00:00:00.000Z"});
  first.undoWord("item-1");
  assert.equal(first.isWordConfirmed("item-1"), false);
});

test("malformed review snapshots recover to an empty valid snapshot", () => {
  assert.deepEqual(normalizeReviewSnapshot({version: 99, confirmed: {}}), emptyReviewSnapshot());
  assert.deepEqual(normalizeReviewSnapshot({version: 1, confirmed: {"item-1": "not-a-date"}}), emptyReviewSnapshot());
  assert.deepEqual(normalizeReviewSnapshot({version: 1, confirmed: {}, word_confirmed: {"item-1": {candidate: "", confirmed_at: "not-a-date"}}}), emptyReviewSnapshot());
});
