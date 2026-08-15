import type { AudioSequenceConfig } from "../../types";
import { createDefaultAudioSequence, normalizeAudioSequence } from "./audioSequence.mjs";

export const AUDIO_SEQUENCE_STATE_KEY = "ielts-vocabulary:audio-sequences:v1";
export const AUDIO_SEQUENCE_STATE_VERSION = 1;

export interface AudioSequenceSnapshot {
  version: number;
  updated_at: string;
  sequences: Record<string, AudioSequenceConfig>;
}

function emptySnapshot(): AudioSequenceSnapshot {
  return {version: AUDIO_SEQUENCE_STATE_VERSION, updated_at: new Date(0).toISOString(), sequences: {}};
}

function validIso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

export function normalizeAudioSequenceSnapshot(value: unknown): AudioSequenceSnapshot {
  const result = emptySnapshot();
  if (!value || typeof value !== "object") return result;
  const candidate = value as {version?: unknown; updated_at?: unknown; sequences?: unknown};
  if (candidate.version !== AUDIO_SEQUENCE_STATE_VERSION || !candidate.sequences || typeof candidate.sequences !== "object") return result;
  result.updated_at = validIso(candidate.updated_at) || result.updated_at;
  for (const [itemUuid, sequence] of Object.entries(candidate.sequences)) {
    if (!itemUuid || !sequence || typeof sequence !== "object") continue;
    result.sequences[itemUuid] = normalizeAudioSequence(sequence);
  }
  return result;
}

export class LocalAudioSequenceState {
  private snapshot: AudioSequenceSnapshot;
  private listeners = new Set<() => void>();

  constructor(private readonly storage: Storage = window.localStorage, private readonly now = () => new Date()) {
    this.snapshot = this.read();
    if (typeof window !== "undefined") window.addEventListener("storage", event => {
      if (event.key === AUDIO_SEQUENCE_STATE_KEY) { this.snapshot = this.read(); this.emit(); }
    });
  }

  private read(): AudioSequenceSnapshot {
    const raw = this.storage.getItem(AUDIO_SEQUENCE_STATE_KEY);
    if (!raw) return emptySnapshot();
    try {
      return normalizeAudioSequenceSnapshot(JSON.parse(raw));
    } catch {
      this.storage.setItem(`${AUDIO_SEQUENCE_STATE_KEY}:malformed:${this.now().toISOString()}`, raw);
      this.storage.removeItem(AUDIO_SEQUENCE_STATE_KEY);
      return emptySnapshot();
    }
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private emit() { for (const listener of this.listeners) listener(); }

  config(itemUuid: string): AudioSequenceConfig {
    const value = this.snapshot.sequences[itemUuid];
    return value ? normalizeAudioSequence(value) : createDefaultAudioSequence();
  }

  private commit(sequences: Record<string, AudioSequenceConfig>) {
    this.snapshot = {version: AUDIO_SEQUENCE_STATE_VERSION, updated_at: this.now().toISOString(), sequences};
    this.storage.setItem(AUDIO_SEQUENCE_STATE_KEY, JSON.stringify(this.snapshot));
    this.emit();
    return this.snapshot;
  }

  update(itemUuid: string, sequence: AudioSequenceConfig) {
    if (!itemUuid) return this.config(itemUuid);
    const normalized = normalizeAudioSequence(sequence);
    this.commit({...this.snapshot.sequences, [itemUuid]: normalized});
    return normalized;
  }

  reset(itemUuid: string) {
    if (!itemUuid || !this.snapshot.sequences[itemUuid]) return this.config(itemUuid);
    const sequences = {...this.snapshot.sequences};
    delete sequences[itemUuid];
    this.commit(sequences);
    return createDefaultAudioSequence();
  }

  exportSnapshot(): AudioSequenceSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as AudioSequenceSnapshot;
  }

  restore(value: unknown) {
    this.storage.setItem(`${AUDIO_SEQUENCE_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    const next = normalizeAudioSequenceSnapshot(value);
    this.commit(next.sequences);
  }
}
