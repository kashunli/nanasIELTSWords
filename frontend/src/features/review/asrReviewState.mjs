export const ASR_REVIEW_STATE_KEY = "ielts-vocabulary:asr-review:v1";
export const ASR_REVIEW_STATE_VERSION = 1;

export function emptyReviewSnapshot() {
  return {version: ASR_REVIEW_STATE_VERSION, updated_at: new Date(0).toISOString(), confirmed: {}, word_confirmed: {}};
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function normalizedWordConfirmation(value) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = typeof value.candidate === "string" ? value.candidate.trim() : "";
  const confirmedAt = validIso(value.confirmed_at);
  return candidate && confirmedAt ? {candidate, confirmed_at: confirmedAt} : undefined;
}

export function normalizeReviewSnapshot(value) {
  const result = emptyReviewSnapshot();
  if (!value || typeof value !== "object" || value.version !== ASR_REVIEW_STATE_VERSION || !value.confirmed || typeof value.confirmed !== "object") return result;
  result.updated_at = validIso(value.updated_at) || result.updated_at;
  for (const [stableId, confirmedAt] of Object.entries(value.confirmed)) {
    const normalized = validIso(confirmedAt);
    if (normalized) result.confirmed[stableId] = normalized;
  }
  if (value.word_confirmed && typeof value.word_confirmed === "object") {
    for (const [stableId, confirmation] of Object.entries(value.word_confirmed)) {
      const normalized = normalizedWordConfirmation(confirmation);
      if (normalized) result.word_confirmed[stableId] = normalized;
    }
  }
  return result;
}

export class LocalAsrReviewState {
  constructor(storage = window.localStorage, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.snapshot = this.read();
    this.listeners = new Set();
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key === ASR_REVIEW_STATE_KEY) { this.snapshot = this.read(); this.emit(); }
    });
  }

  read() {
    const raw = this.storage.getItem(ASR_REVIEW_STATE_KEY);
    if (!raw) return emptyReviewSnapshot();
    try { return normalizeReviewSnapshot(JSON.parse(raw)); } catch {
      this.storage.setItem(`${ASR_REVIEW_STATE_KEY}:malformed:${this.now().toISOString()}`, raw);
      this.storage.removeItem(ASR_REVIEW_STATE_KEY);
      return emptyReviewSnapshot();
    }
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot); }
  load() { return this.snapshot; }
  isConfirmed(stableId) { return Boolean(this.snapshot.confirmed[stableId]); }
  wordConfirmation(stableId) { return this.snapshot.word_confirmed[stableId]; }
  isWordConfirmed(stableId) { return Boolean(this.wordConfirmation(stableId)); }

  commit(changes) {
    this.snapshot = {...this.snapshot, updated_at: this.now().toISOString(), ...changes};
    this.storage.setItem(ASR_REVIEW_STATE_KEY, JSON.stringify(this.snapshot));
    this.emit();
    return this.snapshot;
  }

  confirm(stableId) {
    return this.commit({confirmed: {...this.snapshot.confirmed, [stableId]: this.now().toISOString()}});
  }

  undo(stableId) {
    const confirmed = {...this.snapshot.confirmed};
    delete confirmed[stableId];
    return this.commit({confirmed});
  }

  confirmWord(stableId, candidate) {
    const normalizedCandidate = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalizedCandidate) return this.snapshot;
    return this.commit({word_confirmed: {...this.snapshot.word_confirmed, [stableId]: {candidate: normalizedCandidate, confirmed_at: this.now().toISOString()}}});
  }

  undoWord(stableId) {
    const wordConfirmed = {...this.snapshot.word_confirmed};
    delete wordConfirmed[stableId];
    return this.commit({word_confirmed: wordConfirmed});
  }

  exportSnapshot() { return JSON.parse(JSON.stringify(this.snapshot)); }

  restore(value) {
    this.storage.setItem(`${ASR_REVIEW_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    this.snapshot = normalizeReviewSnapshot(value);
    this.storage.setItem(ASR_REVIEW_STATE_KEY, JSON.stringify(this.snapshot));
    this.emit();
  }

  reset() {
    this.storage.setItem(`${ASR_REVIEW_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    this.storage.removeItem(ASR_REVIEW_STATE_KEY);
    this.snapshot = emptyReviewSnapshot();
    this.emit();
  }
}
