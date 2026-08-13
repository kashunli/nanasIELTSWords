import test from "node:test";
import assert from "node:assert/strict";
import {emptySnapshot, LocalStudyState, nextDueAt, normalizeSnapshot} from "./studyState.mjs";

function storage() { const values = new Map(); return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)}; }

test("new playback enrolls once and does not postpone due time", () => {
  const store = new LocalStudyState(storage(), () => new Date("2026-08-13T00:00:00Z"));
  store.recordPlayed({item_uuid: "a"});
  const first = store.card("a");
  store.recordPlayed({item_uuid: "a"});
  assert.equal(store.card("a").due_at, first.due_at);
  assert.equal(first.due_at, "2026-08-14T00:00:00.000Z");
});

test("review requires the expected due time", () => {
  const store = new LocalStudyState(storage(), () => new Date("2026-08-13T00:00:00Z"));
  store.recordPlayed({item_uuid: "a"});
  assert.equal(store.completeReview({item_uuid: "a"}, "wrong").completed, false);
  assert.equal(store.completeReview({item_uuid: "a"}, store.card("a").due_at).completed, false);
});

test("malformed snapshots recover to an empty valid snapshot", () => {
  assert.deepEqual(normalizeSnapshot({version: 99, cards: {}}), emptySnapshot());
  assert.equal(nextDueAt("2026-08-13T00:00:00Z", 0), "2026-08-14T00:00:00.000Z");
});
