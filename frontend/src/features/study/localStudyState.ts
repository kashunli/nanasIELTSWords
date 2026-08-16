import type { CardState, Item } from "../../types";

export const STUDY_STATE_KEY = "ielts-vocabulary:study-state:v1";
export const STUDY_STATE_VERSION = 1;

export interface StudySnapshot {
  version: number;
  updated_at: string;
  content_version: string;
  cards: Record<string, CardState>;
}

export function nextDueAt(completedAt: string, level: number): string {
  const timestamp = Date.parse(completedAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(level) || level < 0) throw new Error("Invalid review input");
  return new Date(timestamp + (2 ** level) * 24 * 60 * 60 * 1000).toISOString();
}

function validIso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

export function emptySnapshot(): StudySnapshot {
  return {version: STUDY_STATE_VERSION, updated_at: new Date(0).toISOString(), content_version: "", cards: {}};
}

export function normalizeSnapshot(value: unknown): StudySnapshot {
  const result = emptySnapshot();
  if (!value || typeof value !== "object") return result;
  const candidate = value as {version?: unknown; updated_at?: unknown; content_version?: unknown; cards?: unknown};
  if (candidate.version !== STUDY_STATE_VERSION || !candidate.cards || typeof candidate.cards !== "object") return result;
  result.updated_at = validIso(candidate.updated_at) || result.updated_at;
  result.content_version = typeof candidate.content_version === "string" ? candidate.content_version : "";
  for (const [key, value] of Object.entries(candidate.cards)) {
    if (!value || typeof value !== "object") continue;
    const card = value as Partial<CardState>;
    if (card.item_uuid !== key) continue;
    result.cards[key] = {
      item_uuid: key,
      known: card.known === true,
      flagged: card.flagged === true,
      enrolled_at: validIso(card.enrolled_at),
      due_at: validIso(card.due_at),
      review_level: Number.isInteger(card.review_level) && (card.review_level as number) >= 0 ? card.review_level as number : 0,
      last_played_at: validIso(card.last_played_at),
      last_reviewed_at: validIso(card.last_reviewed_at),
      updated_at: validIso(card.updated_at) || result.updated_at,
    };
  }
  return result;
}

export class LocalStudyState {
  private snapshot: StudySnapshot;
  private listeners = new Set<() => void>();
  constructor(private readonly storage: Storage = window.localStorage, private readonly now = () => new Date()) {
    this.snapshot = this.read();
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key === STUDY_STATE_KEY) { this.snapshot = this.read(); this.emit(); }
    });
  }
  private read(): StudySnapshot {
    const raw = this.storage.getItem(STUDY_STATE_KEY);
    if (!raw) return emptySnapshot();
    try { return normalizeSnapshot(JSON.parse(raw)); } catch {
      this.storage.setItem(`${STUDY_STATE_KEY}:malformed:${this.now().toISOString()}`, raw);
      this.storage.removeItem(STUDY_STATE_KEY);
      return emptySnapshot();
    }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  load() { return this.snapshot; }
  card(itemUuid: string) { return this.snapshot.cards[itemUuid]; }
  private commit(cards: Record<string, CardState>) {
    this.snapshot = {...this.snapshot, updated_at: this.now().toISOString(), cards};
    this.storage.setItem(STUDY_STATE_KEY, JSON.stringify(this.snapshot)); this.emit(); return this.snapshot;
  }
  update(itemUuid: string, patch: Partial<CardState>) {
    const current = this.card(itemUuid) || {item_uuid: itemUuid, known: false, flagged: false, review_level: 0};
    return this.commit({...this.snapshot.cards, [itemUuid]: {...current, ...patch, updated_at: this.now().toISOString()}}).cards[itemUuid];
  }
  recordPlayed(item: Item) {
    const now = this.now().toISOString();
    const current = this.card(item.item_uuid) || {item_uuid: item.item_uuid, known: false, flagged: false, review_level: 0};
    return this.commit({...this.snapshot.cards, [item.item_uuid]: {...current, enrolled_at: current.enrolled_at || now, due_at: current.due_at || nextDueAt(now, 0), last_played_at: now, updated_at: now}}).cards[item.item_uuid];
  }
  completeReview(item: Item, expectedDueAt: string) {
    const current = this.card(item.item_uuid); const now = this.now().toISOString();
    if (!current || current.due_at !== expectedDueAt || Date.parse(expectedDueAt) > Date.parse(now)) return {completed: false, card: current};
    const level = current.review_level + 1;
    return {completed: true, card: this.update(item.item_uuid, {review_level: level, due_at: nextDueAt(now, level), last_reviewed_at: now, last_played_at: now})};
  }
  exportSnapshot() { return JSON.parse(JSON.stringify(this.snapshot)) as StudySnapshot; }
  restore(value: unknown) {
    this.storage.setItem(`${STUDY_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    this.commit(normalizeSnapshot(value).cards);
  }
  reset() {
    this.storage.setItem(`${STUDY_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    this.storage.removeItem(STUDY_STATE_KEY); this.snapshot = emptySnapshot(); this.emit();
  }
}
