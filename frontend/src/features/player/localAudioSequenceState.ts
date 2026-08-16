import type { AudioSequenceConfig } from "../../types";
import { createDefaultAudioSequence, normalizeAudioSequence } from "./audioSequence.mjs";

export const AUDIO_SEQUENCE_STATE_KEY = "ielts-vocabulary:audio-sequence:v3";
export const LEGACY_AUDIO_SEQUENCE_V2_STATE_KEY = "ielts-vocabulary:audio-sequence:v2";
export const LEGACY_AUDIO_SEQUENCE_STATE_KEY = "ielts-vocabulary:audio-sequences:v1";
export const AUDIO_SEQUENCE_STATE_VERSION = 3;

export interface AudioSequenceSnapshot {
  version: 3;
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

function normalizePriorV2Sequence(value: unknown): AudioSequenceConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {version?: unknown; sequence?: unknown};
  if (candidate.version !== 2 || !candidate.sequence || typeof candidate.sequence !== "object") return undefined;
  return normalizeAudioSequence(candidate.sequence);
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
  const priorV2Sequence = normalizePriorV2Sequence(value);
  if (priorV2Sequence) {
    result.sequence = priorV2Sequence;
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
      if ([AUDIO_SEQUENCE_STATE_KEY, LEGACY_AUDIO_SEQUENCE_V2_STATE_KEY, LEGACY_AUDIO_SEQUENCE_STATE_KEY].includes(event.key || "")) {
        this.snapshot = this.read();
        this.emit();
      }
    });
  }

  private read(): AudioSequenceSnapshot {
    for (const key of [AUDIO_SEQUENCE_STATE_KEY, LEGACY_AUDIO_SEQUENCE_V2_STATE_KEY, LEGACY_AUDIO_SEQUENCE_STATE_KEY]) {
      const raw = this.storage.getItem(key);
      if (!raw) continue;
      try {
        return normalizeAudioSequenceSnapshot(JSON.parse(raw));
      } catch {
        this.storage.setItem(`${key}:malformed:${this.now().toISOString()}`, raw);
        this.storage.removeItem(key);
      }
    }
    return emptySnapshot();
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
