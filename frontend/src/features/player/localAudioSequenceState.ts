import type { AudioSequenceConfig } from "../../types";
import { createDefaultAudioSequence, normalizeAudioSequence } from "./audioSequence.mjs";

export const AUDIO_SEQUENCE_STATE_KEY = "ielts-vocabulary:audio-sequence:v2";
export const LEGACY_AUDIO_SEQUENCE_STATE_KEY = "ielts-vocabulary:audio-sequences:v1";
export const AUDIO_SEQUENCE_STATE_VERSION = 2;

export interface AudioSequenceSnapshot {
  version: 2;
  updated_at: string;
  sequence: AudioSequenceConfig;
}

function emptySnapshot(): AudioSequenceSnapshot {
  return {version: AUDIO_SEQUENCE_STATE_VERSION, updated_at: new Date(0).toISOString(), sequence: createDefaultAudioSequence()};
}

function validIso(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function normalizeLegacySequence(value: unknown): AudioSequenceConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {version?: unknown; sequences?: unknown};
  if (candidate.version !== 1 || !candidate.sequences || typeof candidate.sequences !== "object") return undefined;
  const candidates = Object.values(candidate.sequences)
    .filter(sequence => sequence && typeof sequence === "object")
    .map(sequence => normalizeAudioSequence(sequence));
  if (!candidates.length) return undefined;
  const first = JSON.stringify(candidates[0]);
  return candidates.every(sequence => JSON.stringify(sequence) === first) ? candidates[0] : undefined;
}

export function normalizeAudioSequenceSnapshot(value: unknown): AudioSequenceSnapshot {
  const result = emptySnapshot();
  if (!value || typeof value !== "object") return result;
  const candidate = value as {version?: unknown; updated_at?: unknown; sequence?: unknown};
  result.updated_at = validIso(candidate.updated_at) || result.updated_at;
  if (candidate.version === AUDIO_SEQUENCE_STATE_VERSION && candidate.sequence && typeof candidate.sequence === "object") {
    result.sequence = normalizeAudioSequence(candidate.sequence);
    return result;
  }
  const legacySequence = normalizeLegacySequence(value);
  if (legacySequence) result.sequence = legacySequence;
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
    if (raw) {
      try {
        return normalizeAudioSequenceSnapshot(JSON.parse(raw));
      } catch {
        this.storage.setItem(`${AUDIO_SEQUENCE_STATE_KEY}:malformed:${this.now().toISOString()}`, raw);
        this.storage.removeItem(AUDIO_SEQUENCE_STATE_KEY);
        return emptySnapshot();
      }
    }
    const legacyRaw = this.storage.getItem(LEGACY_AUDIO_SEQUENCE_STATE_KEY);
    if (!legacyRaw) return emptySnapshot();
    try {
      return normalizeAudioSequenceSnapshot(JSON.parse(legacyRaw));
    } catch {
      this.storage.setItem(`${LEGACY_AUDIO_SEQUENCE_STATE_KEY}:malformed:${this.now().toISOString()}`, legacyRaw);
      this.storage.removeItem(LEGACY_AUDIO_SEQUENCE_STATE_KEY);
      return emptySnapshot();
    }
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private emit() { for (const listener of this.listeners) listener(); }

  config(): AudioSequenceConfig {
    return normalizeAudioSequence(this.snapshot.sequence);
  }

  private commit(sequence: AudioSequenceConfig) {
    this.snapshot = {version: AUDIO_SEQUENCE_STATE_VERSION, updated_at: this.now().toISOString(), sequence: normalizeAudioSequence(sequence)};
    this.storage.setItem(AUDIO_SEQUENCE_STATE_KEY, JSON.stringify(this.snapshot));
    this.emit();
    return this.snapshot;
  }

  update(sequence: AudioSequenceConfig) {
    const normalized = normalizeAudioSequence(sequence);
    this.commit(normalized);
    return normalized;
  }

  reset() {
    const defaults = createDefaultAudioSequence();
    this.commit(defaults);
    return defaults;
  }

  exportSnapshot(): AudioSequenceSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as AudioSequenceSnapshot;
  }

  restore(value: unknown) {
    this.storage.setItem(`${AUDIO_SEQUENCE_STATE_KEY}:archive:${this.now().toISOString()}`, JSON.stringify(this.snapshot));
    const next = normalizeAudioSequenceSnapshot(value);
    this.commit(next.sequence);
  }
}
