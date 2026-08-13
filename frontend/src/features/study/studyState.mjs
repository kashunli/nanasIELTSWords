export const STUDY_STATE_KEY = "ielts-vocabulary:study-state:v1";
export const STUDY_STATE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nextDueAt(completedAt, level) {
  const timestamp = Date.parse(completedAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(level) || level < 0) throw new Error("Invalid review input");
  return new Date(timestamp + (2 ** level) * DAY_MS).toISOString();
}

export function emptySnapshot() {
  return {version: STUDY_STATE_VERSION, updated_at: new Date(0).toISOString(), content_version: "", cards: {}};
}

function iso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }

export function normalizeSnapshot(value) {
  const result = emptySnapshot();
  if (!value || value.version !== STUDY_STATE_VERSION || typeof value.cards !== "object") return result;
  result.updated_at = iso(value.updated_at) || result.updated_at;
  result.content_version = typeof value.content_version === "string" ? value.content_version : "";
  for (const [key, candidate] of Object.entries(value.cards)) {
    if (!candidate || typeof candidate !== "object" || candidate.item_uuid !== key) continue;
    result.cards[key] = {
      item_uuid: key,
      known: candidate.known === true,
      flagged: candidate.flagged === true,
      sentence_starred: candidate.sentence_starred === true,
      enrolled_at: iso(candidate.enrolled_at),
      due_at: iso(candidate.due_at),
      review_level: Number.isInteger(candidate.review_level) && candidate.review_level >= 0 ? candidate.review_level : 0,
      last_played_at: iso(candidate.last_played_at),
      last_reviewed_at: iso(candidate.last_reviewed_at),
      updated_at: iso(candidate.updated_at) || result.updated_at,
    };
  }
  return result;
}

export class LocalStudyState {
  constructor(storage = window.localStorage, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.snapshot = this.read();
    this.listeners = new Set();
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key === STUDY_STATE_KEY) { this.snapshot = this.read(); this.emit(); }
    });
  }
  read() {
    const raw = this.storage.getItem(STUDY_STATE_KEY);
    if (!raw) return emptySnapshot();
    try { return normalizeSnapshot(JSON.parse(raw)); } catch {
      this.storage.setItem(`${STUDY_STATE_KEY}:malformed:${this.now().toISOString()}`, raw);
      this.storage.removeItem(STUDY_STATE_KEY);
      return emptySnapshot();
    }
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot); }
  commit(cards) {
    this.snapshot = {...this.snapshot, updated_at: this.now().toISOString(), cards};
    this.storage.setItem(STUDY_STATE_KEY, JSON.stringify(this.snapshot)); this.emit(); return this.snapshot;
  }
  card(itemUuid) { return this.snapshot.cards[itemUuid]; }
  update(itemUuid, patch) {
    const now = this.now().toISOString();
    const current = this.card(itemUuid) || {item_uuid: itemUuid, known: false, flagged: false, sentence_starred: false, review_level: 0};
    return this.commit({...this.snapshot.cards, [itemUuid]: {...current, ...patch, updated_at: now}}).cards[itemUuid];
  }
  recordPlayed(item) {
    const now = this.now().toISOString();
    const current = this.card(item.item_uuid) || {item_uuid: item.item_uuid, known: false, flagged: false, sentence_starred: false, review_level: 0};
    return this.commit({...this.snapshot.cards, [item.item_uuid]: {...current, enrolled_at: current.enrolled_at || now, due_at: current.due_at || nextDueAt(now, 0), last_played_at: now, updated_at: now}}).cards[item.item_uuid];
  }
  completeReview(item, expectedDueAt) {
    const current = this.card(item.item_uuid);
    const now = this.now().toISOString();
    if (!current || current.due_at !== expectedDueAt || Date.parse(expectedDueAt) > Date.parse(now)) return {completed: false, card: current};
    const level = current.review_level + 1;
    const card = this.update(item.item_uuid, {review_level: level, due_at: nextDueAt(now, level), last_reviewed_at: now, last_played_at: now});
    return {completed: true, card};
  }
  exportSnapshot() { return JSON.parse(JSON.stringify(this.snapshot)); }
  restore(value) { const normalized = normalizeSnapshot(value); this.storage.setItem(`${STUDY_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot)); this.commit(normalized.cards); }
  reset() { this.storage.setItem(`${STUDY_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot)); this.storage.removeItem(STUDY_STATE_KEY); this.snapshot = emptySnapshot(); this.emit(); }
}
