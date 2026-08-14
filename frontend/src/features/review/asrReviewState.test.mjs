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

test("confirmation persists and can be undone", () => {
  const values = storage();
  const first = new LocalAsrReviewState(values, () => new Date("2026-08-14T00:00:00Z"));
  first.confirm("item-1");
  assert.equal(first.isConfirmed("item-1"), true);
  assert.equal(new LocalAsrReviewState(values).isConfirmed("item-1"), true);
  first.undo("item-1");
  assert.equal(first.isConfirmed("item-1"), false);
});

test("malformed review snapshots recover to an empty valid snapshot", () => {
  assert.deepEqual(normalizeReviewSnapshot({version: 99, confirmed: {}}), emptyReviewSnapshot());
  assert.deepEqual(normalizeReviewSnapshot({version: 1, confirmed: {"item-1": "not-a-date"}}), emptyReviewSnapshot());
});
