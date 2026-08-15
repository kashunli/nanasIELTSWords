import { useEffect, useMemo, useRef, useState } from "react";
import { exportFlaggedAudio, getChapters, getItems, getSummary } from "./api";
import type { AudioElementId, AudioSequenceConfig, AudioSequenceStep, BookReference, CardState, Chapter, Item, Summary } from "./types";
import { LocalStudyState } from "./features/study/localStudyState";
import { LocalAudioSequenceState } from "./features/player/localAudioSequenceState";
import { LineWaveform } from "./features/player/LineWaveform";
import { createDefaultAudioSequence, expandPlayableAudioSequence, nextAudioSequenceStep, reorderAudioSequence, updateAudioSequenceStep } from "./features/player/audioSequence.mjs";
import { detectSilenceGapsMs } from "./features/player/waveform.mjs";
import { useAudioBufferPlayer } from "./features/player/useAudioBufferPlayer";

type Filter = "all" | "order-only" | "review" | "unmarked" | "known" | "flagged";
type PlaybackMode = "sequence" | "words" | "sentences";
type RunMode = "single" | "consecutive";

const AUDIO_ELEMENT_LABELS: Record<AudioElementId, string> = {
  word: "English word",
  sentence: "English sentence",
  word_translation: "Chinese word translation",
  sentence_translation: "Chinese sentence translation",
};

const AUDIO_ELEMENT_SHORT_LABELS: Record<AudioElementId, string> = {
  word: "Word",
  sentence: "Sentence",
  word_translation: "中文释义",
  sentence_translation: "中文例句",
};

function itemAudioUrls(item?: Item): Partial<Record<AudioElementId, string>> {
  if (!item) return {};
  return {
    word: item.word_audio_url,
    sentence: item.sentence_audio_url,
    word_translation: item.word_translation_audio_url,
    sentence_translation: item.sentence_translation_audio_url,
  };
}

function sequenceKey(sequence: AudioSequenceConfig) {
  return sequence.steps.map(step => `${step.element}:${step.repeatCount}:${step.pauseAfterSeconds}`).join("|");
}

type AudioCue = AudioSequenceStep & {url: string; occurrence: number};

function AudioPlayer({item, sequence, mode, runMode, onNextItem, onPreviousItem, onRunModeChange, canNextItem, canPreviousItem, onPlayed}: {
  item?: Item;
  sequence: AudioSequenceConfig;
  mode: PlaybackMode;
  runMode: RunMode;
  onNextItem: () => boolean;
  onPreviousItem: () => boolean;
  onRunModeChange: (mode: RunMode) => void;
  canNextItem: boolean;
  canPreviousItem: boolean;
  onPlayed: (item: Item) => void;
}) {
  const audioUrls = useMemo(() => itemAudioUrls(item), [item?.sentence_audio_url, item?.sentence_translation_audio_url, item?.word_audio_url, item?.word_translation_audio_url]);
  const playableCues = useMemo(() => expandPlayableAudioSequence(sequence, audioUrls) as AudioCue[], [audioUrls, sequence]);
  const recipeKey = sequenceKey(sequence);
  const [cueIndex, setCueIndex] = useState(0);
  const [waitingForNextCue, setWaitingForNextCue] = useState(false);
  const continueSequenceRef = useRef(false);
  const playOnTargetChangeRef = useRef(false);
  const pendingTargetPlayRef = useRef(false);
  const preserveSequenceRunRef = useRef(false);
  const runModeRef = useRef(runMode);
  runModeRef.current = runMode;
  const lastTargetKeyRef = useRef<string | undefined>(undefined);
  const currentTimeRef = useRef(0);
  const waitTimerRef = useRef<number | null>(null);
  const playedItemRef = useRef<string | undefined>(undefined);
  const activeCueIndex = playableCues.length ? Math.min(cueIndex, playableCues.length - 1) : 0;
  const currentCue = playableCues[activeCueIndex];
  const url = currentCue?.url || "";
  const targetKey = item && currentCue ? `${item.item_uuid}:${currentCue.element}:${currentCue.occurrence}:${url}` : "";

  const clearWaiting = () => {
    if (waitTimerRef.current !== null) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    setWaitingForNextCue(false);
  };

  const player = useAudioBufferPlayer(url, () => {
    if (!item || !currentCue) return;
    if (playedItemRef.current !== item.item_uuid) {
      playedItemRef.current = item.item_uuid;
      onPlayed(item);
    }
    if (!continueSequenceRef.current) {
      continueSequenceRef.current = false;
      pendingTargetPlayRef.current = false;
      return;
    }

    const continueSequence = () => {
      const step = nextAudioSequenceStep({cueIndex: activeCueIndex, cueCount: playableCues.length, runMode: runModeRef.current, hasNextItem: canNextItem});
      pendingTargetPlayRef.current = true;
      if (step === "next-cue") {
        setCueIndex(activeCueIndex + 1);
        return true;
      }
      if (step === "stop") {
        continueSequenceRef.current = false;
        pendingTargetPlayRef.current = false;
        return false;
      }
      preserveSequenceRunRef.current = true;
      const moved = onNextItem();
      if (!moved) {
        preserveSequenceRunRef.current = false;
        continueSequenceRef.current = false;
        pendingTargetPlayRef.current = false;
      }
      return moved;
    };

    const hasNextAudio = nextAudioSequenceStep({cueIndex: activeCueIndex, cueCount: playableCues.length, runMode: runModeRef.current, hasNextItem: canNextItem}) !== "stop";
    if (currentCue.pauseAfterSeconds > 0 && hasNextAudio) {
      setWaitingForNextCue(true);
      waitTimerRef.current = window.setTimeout(() => {
        waitTimerRef.current = null;
        setWaitingForNextCue(false);
        if (!continueSequenceRef.current) {
          continueSequenceRef.current = false;
          pendingTargetPlayRef.current = false;
          return;
        }
        continueSequence();
      }, Math.round(currentCue.pauseAfterSeconds * 1000));
    } else {
      continueSequence();
    }
  });
  const [playerError, setPlayerError] = useState("");
  currentTimeRef.current = player.currentTime;

  useEffect(() => {
    if (cueIndex >= playableCues.length && playableCues.length > 0) setCueIndex(0);
  }, [cueIndex, playableCues.length]);

  useEffect(() => {
    const preserveSequenceRun = preserveSequenceRunRef.current;
    preserveSequenceRunRef.current = false;
    clearWaiting();
    setCueIndex(0);
    if (!preserveSequenceRun) {
      continueSequenceRef.current = false;
      playOnTargetChangeRef.current = false;
      pendingTargetPlayRef.current = false;
    }
    playedItemRef.current = undefined;
    player.pause();
    player.setPosition(0);
  }, [item?.item_uuid, recipeKey, player.pause, player.setPosition]);

  useEffect(() => {
    if (targetKey === lastTargetKeyRef.current) return;
    lastTargetKeyRef.current = targetKey;
    setPlayerError("");
    pendingTargetPlayRef.current = pendingTargetPlayRef.current || playOnTargetChangeRef.current || continueSequenceRef.current;
    playOnTargetChangeRef.current = false;
  }, [targetKey]);

  const playFrom = async (offset: number) => {
    if (!item || !currentCue || !player.audioBuffer || player.loadedAudioUrl !== url) return;
    const duration = player.audioBuffer.duration;
    const safeOffset = offset >= duration ? 0 : Math.max(0, offset);
    try {
      await player.playRange({
        start: 0,
        end: duration,
        offset: safeOffset,
        segmentId: `${item.item_uuid}:${currentCue.element}:${currentCue.occurrence}`,
      });
    } catch {
      setPlayerError("Audio could not be played.");
    }
  };

  // A newly selected target is allowed to autoplay only when the current run
  // explicitly requested continuation (or the user pressed Next).
  useEffect(() => {
    if (!pendingTargetPlayRef.current || waitingForNextCue || !item || !currentCue || !player.audioBuffer || player.loadedAudioUrl !== url || player.isPlaying) return;
    pendingTargetPlayRef.current = false;
    void playFrom(0);
  }, [currentCue, item, player.audioBuffer, player.isPlaying, player.loadedAudioUrl, targetKey, url, waitingForNextCue]);

  const silenceGaps = useMemo(() => {
    if (!player.audioBuffer) return [];
    const channels = Array.from(
      {length: player.audioBuffer.numberOfChannels},
      (_, index) => player.audioBuffer!.getChannelData(index),
    );
    return detectSilenceGapsMs(
      channels,
      player.audioBuffer.sampleRate,
      0,
      player.audioBuffer.duration * 1000,
    ).map(({startMs, endMs}) => ({start_ms: startMs, end_ms: endMs}));
  }, [player.audioBuffer]);

  const duration = player.audioBuffer?.duration || 0.01;
  const progressLabel = `${formatPlaybackTime(player.currentTime)} / ${formatPlaybackTime(player.audioBuffer?.duration || 0)}`;
  const hasNextTarget = activeCueIndex < playableCues.length - 1 || canNextItem;
  const hasPreviousTarget = activeCueIndex > 0 || canPreviousItem;
  const toggle = () => {
    if (!currentCue) return;
    if (waitingForNextCue) {
      clearWaiting();
      continueSequenceRef.current = true;
      void playFrom(0);
      return;
    }
    if (player.isPlaying) {
      player.pause();
      return;
    }
    continueSequenceRef.current = true;
    pendingTargetPlayRef.current = false;
    void playFrom(currentTimeRef.current);
  };
  const replay = () => {
    if (!currentCue) return;
    clearWaiting();
    continueSequenceRef.current = true;
    if (activeCueIndex === 0) {
      player.setPosition(0);
      void playFrom(0);
    } else {
      playOnTargetChangeRef.current = true;
      setCueIndex(0);
    }
  };
  const advanceManually = () => {
    if (!currentCue) return;
    clearWaiting();
    playOnTargetChangeRef.current = true;
    continueSequenceRef.current = true;
    const nextCueIndex = activeCueIndex + 1;
    if (nextCueIndex < playableCues.length) {
      setCueIndex(nextCueIndex);
      return;
    }
    preserveSequenceRunRef.current = true;
    const moved = onNextItem();
    if (!moved) {
      preserveSequenceRunRef.current = false;
      playOnTargetChangeRef.current = false;
      continueSequenceRef.current = false;
    }
  };
  const previousManually = () => {
    if (!currentCue) return;
    clearWaiting();
    playOnTargetChangeRef.current = true;
    continueSequenceRef.current = true;
    const previousCueIndex = activeCueIndex - 1;
    if (previousCueIndex >= 0) {
      setCueIndex(previousCueIndex);
      return;
    }
    preserveSequenceRunRef.current = true;
    const moved = onPreviousItem();
    if (!moved) {
      preserveSequenceRunRef.current = false;
      playOnTargetChangeRef.current = false;
      continueSequenceRef.current = false;
    }
  };
  const toggleRunMode = () => {
    const nextMode: RunMode = runMode === "single" ? "consecutive" : "single";
    onRunModeChange(nextMode);
  };
  const stop = () => {
    clearWaiting();
    continueSequenceRef.current = false;
    pendingTargetPlayRef.current = false;
    player.pause();
    player.setPosition(0);
  };
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTypingTarget = target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLInputElement && target.type !== "range")
        || (target instanceof HTMLElement && target.isContentEditable);
      if (isTypingTarget || event.repeat) return;

      const key = event.key.toLowerCase();
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (key === "a") {
        event.preventDefault();
        if (hasPreviousTarget) previousManually();
      } else if (key === "d") {
        event.preventDefault();
        if (hasNextTarget) advanceManually();
      } else if (key === "r") {
        event.preventDefault();
        if (player.audioBuffer) replay();
      } else if (key === "s") {
        event.preventDefault();
        if (player.audioBuffer) stop();
      } else if (key === "c") {
        event.preventDefault();
        toggleRunMode();
      }
    };
    document.addEventListener("keydown", handleKeyDown, {capture: true});
    return () => document.removeEventListener("keydown", handleKeyDown, {capture: true});
  }, [advanceManually, hasNextTarget, hasPreviousTarget, player.audioBuffer, previousManually, replay, stop, toggle, toggleRunMode]);

  if (!item) return <section className="player empty-player">Select an item to begin listening.</section>;
  if (!currentCue) return <section className="player empty-player">No playable audio is available for this item yet.</section>;

  return <section className="player" aria-label="Audio player">
    <div className="player-meta">
      <div className="player-current">
        <span className="player-kicker">CURRENT AUDIO</span>
        <strong>{item.headword}</strong>
        <small>{AUDIO_ELEMENT_LABELS[currentCue.element]}{currentCue.repeatCount > 1 ? ` · ${currentCue.occurrence}/${currentCue.repeatCount}` : ""}</small>
      </div>
      <span className="audio-time" aria-label="Playback time">{progressLabel}</span>
    </div>
    <div className="player-controls" role="toolbar" aria-label="Playback controls">
      <button type="button" onClick={replay} disabled={!player.audioBuffer} aria-label="Replay configured audio sequence" aria-keyshortcuts="R"><span className="button-label-full">Replay</span><span className="button-label-short">Replay</span></button>
      <button type="button" onClick={previousManually} disabled={!hasPreviousTarget} aria-label="Previous audio element or item" aria-keyshortcuts="A"><span className="button-label-full">Previous</span><span className="button-label-short">Prev</span></button>
      <button type="button" onClick={advanceManually} disabled={!hasNextTarget} aria-label="Next audio element or item" aria-keyshortcuts="D"><span className="button-label-full">Next</span><span className="button-label-short">Next</span></button>
      <button type="button" onClick={stop} disabled={!player.audioBuffer} aria-label="Stop audio" aria-keyshortcuts="S"><span className="button-label-full">Stop</span><span className="button-label-short">Stop</span></button>
      <button type="button" className={`player-run-mode ${runMode === "consecutive" ? "selected" : ""}`} onClick={toggleRunMode} aria-label="Toggle single or consecutive playback" aria-pressed={runMode === "consecutive"} aria-keyshortcuts="C"><span className="button-label-full">{runMode === "single" ? "Single" : "Consecutive"}</span><span className="button-label-short">{runMode === "single" ? "Single" : "Consec."}</span></button>
      <button
        type="button"
        className="primary play-toggle"
        onClick={toggle}
        disabled={!player.audioBuffer}
        aria-label={`${player.isPlaying ? "Pause" : "Play"} ${AUDIO_ELEMENT_LABELS[currentCue.element]}`}
        aria-keyshortcuts="Space"
      >
        {player.isPlaying ? "Pause" : "Play"}
      </button>
    </div>
    <div className="player-transport">
      <LineWaveform
        audioBuffer={player.audioBuffer}
        loadFailed={player.loadFailed}
        start={0}
        end={duration}
        currentTime={player.currentTime}
        silenceGaps={silenceGaps}
        vadNonSpeechIntervals={[]}
        onSeek={(time) => void player.seek(time)}
      />
    </div>
    <div className="player-help">{playerError || (waitingForNextCue ? `Paused ${currentCue.pauseAfterSeconds.toFixed(1)}s before the next audio element` : `${AUDIO_ELEMENT_SHORT_LABELS[currentCue.element]} · ${runMode === "single" ? "single item" : "play through items"} · ${mode} · A/D previous/next · Space play/pause`)}</div>
  </section>;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function isOrderOnlyReview(reference?: BookReference) {
  return Boolean(reference?.alignment_status === "matched_order" && reference.needs_review);
}

function alignmentLabel(reference: BookReference) {
  if (reference.alignment_status === "matched_sentence") return "Matched by exact sentence";
  if (reference.alignment_status === "matched_headword") return "Matched by book word";
  return "Matched by chapter order";
}

function cleanCollocation(value: string) {
  return value.replace(/^\[搭\]\s*/, "");
}

function audioUrlForElement(item: Item, element: AudioElementId) {
  return itemAudioUrls(item)[element] || "";
}

function AudioSequenceEditor({item, sequence, onChange, onReset}: {
  item: Item;
  sequence: AudioSequenceConfig;
  onChange: (sequence: AudioSequenceConfig) => void;
  onReset: () => void;
}) {
  const availableCount = sequence.steps.filter(step => Boolean(audioUrlForElement(item, step.element))).length;
  const updateStep = (step: AudioSequenceStep, patch: Partial<Pick<AudioSequenceStep, "repeatCount" | "pauseAfterSeconds">>) => {
    onChange(updateAudioSequenceStep(sequence, step.element, patch));
  };

  return <details className="sequence-editor" open>
    <summary>
      <span className="section-heading"><span>PLAYBACK RECIPE</span><strong>Arrange the four audio elements</strong></span>
      <span className="sequence-editor-summary">{availableCount}/4 audio files available</span>
    </summary>
    <p className="sequence-editor-intro">The order, repeat count, and pause are saved for this word in this browser. Missing translation audio can be configured now and will join the sequence when its file is added.</p>
    <ol className="sequence-rows">
      {sequence.steps.map((step, index) => {
        const available = Boolean(audioUrlForElement(item, step.element));
        return <li key={step.element} className={`sequence-row ${available ? "available" : "pending"}`}>
          <span className="sequence-position" aria-hidden="true">{index + 1}</span>
          <div className="sequence-row-name">
            <strong>{AUDIO_ELEMENT_LABELS[step.element]}</strong>
            <small>{available ? "Audio available" : "Audio to be added later"}</small>
          </div>
          <div className="sequence-order-buttons" aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]}`}>
            <button type="button" onClick={() => onChange(reorderAudioSequence(sequence, index, index - 1))} disabled={index === 0} aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]} earlier`}>↑</button>
            <button type="button" onClick={() => onChange(reorderAudioSequence(sequence, index, index + 1))} disabled={index === sequence.steps.length - 1} aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]} later`}>↓</button>
          </div>
          <label className="sequence-number-field sequence-repeat-field">Repeat
            <input type="number" min="1" max="20" step="1" value={step.repeatCount} onChange={event => updateStep(step, {repeatCount: Number(event.target.value)})} />
          </label>
          <label className="sequence-number-field sequence-pause-field">Pause after
            <span><input type="number" min="0" max="60" step="0.1" value={step.pauseAfterSeconds} onChange={event => updateStep(step, {pauseAfterSeconds: Number(event.target.value)})} /> s</span>
          </label>
        </li>;
      })}
    </ol>
    <div className="sequence-editor-footer">
      <span>Pause applies after every playback, including repeats, before the next available element or item.</span>
      <button type="button" className="sequence-reset" onClick={onReset}>Reset recipe</button>
    </div>
  </details>;
}

type CardToggle = "known" | "flagged" | "sentence_starred";

function FocusCard({selected, card, sequence, onToggle, onSequenceChange, onSequenceReset}: {
  selected?: Item;
  card?: CardState;
  sequence: AudioSequenceConfig;
  onToggle: (key: CardToggle) => void;
  onSequenceChange: (sequence: AudioSequenceConfig) => void;
  onSequenceReset: () => void;
}) {
  if (!selected) return <div className="focus-card"><p>Select an item from the list.</p></div>;

  const book = selected.book_reference;
  const orderOnlyReference = book?.alignment_status === "matched_order" && book.needs_review ? book : undefined;
  const displayWord = book?.headword || selected.headword;
  const displayPartOfSpeech = book?.part_of_speech || selected.part_of_speech || "word";
  const displaySentence = book?.example_en || selected.sentence;
  const displayMeaningZh = book?.meaning_zh || selected.meaning_zh;
  const hasUsage = Boolean(book && (book.collocations || book.word_formation || book.notes));

  return <div className="focus-card">
    <div className="focus-meta">
      <span>Chapter {selected.chapter} · #{selected.position}</span>
      {book ? <span className={`source-badge ${book.alignment_status}`}>{alignmentLabel(book)}</span> : <span className="source-badge audio-only">Audio record</span>}
    </div>

    <header className="word-hero">
      <h2>{displayWord}</h2>
      <div className="word-facts">
        <span className="pos">{displayPartOfSpeech}</span>
        {book?.ipa ? <span className="ipa">{book.ipa}</span> : null}
        {book ? <span className="book-source-inline">Reviewed book reference</span> : null}
      </div>
    </header>

    <section className="example-card current-line-card" aria-label="Current played lyric line" data-current-line>
      <div className="section-kicker-row">
        <span>CURRENT LINE</span>
      </div>
      <p className="example-en">{displaySentence}</p>
      {book?.example_zh ? <div className="example-translation"><span>中文翻译</span><p>{book.example_zh}</p></div> : null}
    </section>

    <AudioSequenceEditor item={selected} sequence={sequence} onChange={onSequenceChange} onReset={onSequenceReset} />

    {orderOnlyReference ? <section className="order-review-card" aria-label="Order-only book and audio alignment review">
      <div className="section-heading"><span>ORDER-ONLY REVIEW</span><strong>Book and audio are paired by position, not direct text match</strong></div>
      <p className="order-review-intro">Listen to the word and sentence clips below, then decide whether this book entry belongs to this audio position. This record remains marked for review until you verify it yourself.</p>
      <div className="order-review-grid">
        <div><span>BOOK WORD</span><strong>{orderOnlyReference.headword}</strong></div>
        <div><span>AUDIO-SIDE WORD</span><strong>{selected.headword}</strong></div>
        <div><span>BOOK EXAMPLE</span><p>{orderOnlyReference.example_en}</p></div>
        <div><span>AUDIO-SIDE SENTENCE</span><p>{selected.sentence}</p></div>
      </div>
      <small>{orderOnlyReference.book_word_id} · {orderOnlyReference.source_page} · reason: {orderOnlyReference.review_reasons.join("; ") || "order-only alignment"}</small>
    </section> : null}

    <section className="explanation-card" aria-label="Explanation below current line">
      <div className="section-heading"><span>EXPLANATION</span><strong>Understand this word in the current line</strong></div>
      <div className="explanation-grid">
        <article className="meaning-card meaning-primary">
          <span>MEANING</span>
          <p>{selected.meaning_en || "Meaning pending"}</p>
          <small>{selected.meaning_status === "ai_draft" ? "AI draft English meaning" : "Reviewed English meaning"}</small>
        </article>
        <article className="meaning-card meaning-translation">
          <span>中文释义</span>
          <p>{displayMeaningZh || "释义待生成"}</p>
          <small>{book ? "Reviewed book OCR" : "Current runtime meaning"}</small>
        </article>
      </div>
    </section>

    {hasUsage ? <section className="usage-section" aria-label="Usage information">
      <div className="section-heading"><span>USAGE NOTES</span><strong>Useful patterns from the reviewed book</strong></div>
      <div className="usage-grid">
        {book?.collocations ? <article><span>COLLOCATIONS</span><p>{cleanCollocation(book.collocations)}</p></article> : null}
        {book?.word_formation ? <article><span>WORD FORMATION</span><p>{book.word_formation}</p></article> : null}
        {book?.notes ? <article><span>NOTES</span><p>{book.notes}</p></article> : null}
      </div>
    </section> : null}

    {book ? <section className="source-card" aria-label="Reviewed book source">
      <div className="section-heading"><span>REVIEWED BOOK SOURCE</span><strong>Provenance for this word record</strong></div>
      <p>PDF page {book.pdf_page}{book.printed_page ? ` · printed page ${book.printed_page}` : ""} · entry {book.position_on_page}</p>
      <small>{book.book_word_id} · {book.source_page} · {alignmentLabel(book)}{book.needs_review ? ` · source review: ${book.review_reasons.join("; ") || "needs review"}` : ""}</small>
    </section> : null}

    <div className="card-actions">
      <button type="button" className={card?.known ? "selected" : ""} onClick={() => onToggle("known")}>✓ Known</button>
      <button type="button" className={card?.flagged ? "selected" : ""} onClick={() => onToggle("flagged")}>⚑ Flagged</button>
      <button type="button" className={card?.sentence_starred ? "selected" : ""} onClick={() => onToggle("sentence_starred")}>★ Sentence</button>
    </div>
  </div>;
}

export default function App() {
  const store = useRef<LocalStudyState | null>(null);
  if (!store.current) store.current = new LocalStudyState();
  const study = store.current;
  const sequenceStore = useRef<LocalAudioSequenceState | null>(null);
  if (!sequenceStore.current) sequenceStore.current = new LocalAudioSequenceState();
  const audioSequences = sequenceStore.current;
  const [summary, setSummary] = useState<Summary>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [chapter, setChapter] = useState<number | null>(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<PlaybackMode>("sequence");
  const [runMode, setRunMode] = useState<RunMode>("consecutive");
  const [stateVersion, setStateVersion] = useState(0);
  const [sequenceVersion, setSequenceVersion] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  useEffect(() => {
    const unsubscribeStudy = study.subscribe(() => setStateVersion(value => value + 1));
    const unsubscribeSequences = audioSequences.subscribe(() => setSequenceVersion(value => value + 1));
    return () => { unsubscribeStudy(); unsubscribeSequences(); };
  }, [audioSequences, study]);
  useEffect(() => { void Promise.all([getSummary(), getChapters()]).then(([nextSummary, nextChapters]) => { setSummary(nextSummary); setChapters(nextChapters); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load corpus.")); }, []);
  useEffect(() => { void getItems(chapter, search, filter === "order-only" ? "order_only" : undefined).then(nextItems => { setItems(nextItems); setSelectedId(current => current && nextItems.some(item => item.stable_id === current) ? current : nextItems[0]?.stable_id); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load items.")); }, [chapter, search, filter]);
  const visibleItems = useMemo(() => items.filter(item => { const card = study.card(item.item_uuid); if (filter === "order-only") return true; if (filter === "known") return card?.known; if (filter === "flagged") return card?.flagged; if (filter === "unmarked") return !card?.known && !card?.flagged; if (filter === "review") return Boolean(card?.due_at && Date.parse(card.due_at) <= Date.now()); return true; }), [items, filter, stateVersion, study]);
  const selected = visibleItems.find(item => item.stable_id === selectedId) || visibleItems[0];
  const counts = useMemo(() => ({orderOnly: summary?.book_order_review_items || 0, known: items.filter(item => study.card(item.item_uuid)?.known).length, flagged: items.filter(item => study.card(item.item_uuid)?.flagged).length, review: items.filter(item => { const due = study.card(item.item_uuid)?.due_at; return due && Date.parse(due) <= Date.now(); }).length}), [items, stateVersion, study, summary]);
  const selectedIndex = selected ? visibleItems.findIndex(item => item.stable_id === selected.stable_id) : -1;
  const card = selected ? study.card(selected.item_uuid) : undefined;
  const selectedSequence = useMemo(() => selected ? audioSequences.config(selected.item_uuid) : createDefaultAudioSequence(), [audioSequences, selected, sequenceVersion]);
  const playbackSequence = useMemo(() => {
    if (mode === "sequence") return selectedSequence;
    const element: AudioElementId = mode === "words" ? "word" : "sentence";
    return {version: 1 as const, steps: selectedSequence.steps.filter(step => step.element === element)};
  }, [mode, selectedSequence]);
  const advanceNext = (): boolean => {
    if (!selected) return false;
    const next = visibleItems[selectedIndex + 1];
    if (!next) return false;
    setSelectedId(next.stable_id);
    return true;
  };
  const advancePrevious = (): boolean => {
    if (!selected) return false;
    const previous = visibleItems[selectedIndex - 1];
    if (!previous) return false;
    setSelectedId(previous.stable_id);
    return true;
  };
  const changeMode = (nextMode: PlaybackMode) => setMode(nextMode);
  const canNextItem = Boolean(selected && selectedIndex >= 0 && selectedIndex < visibleItems.length - 1);
  const canPreviousItem = Boolean(selected && selectedIndex > 0);
  const toggle = (key: "known" | "flagged" | "sentence_starred") => { if (selected) study.update(selected.item_uuid, {[key]: !card?.[key]}); };
  const updateSelectedSequence = (sequence: AudioSequenceConfig) => { if (selected) audioSequences.update(selected.item_uuid, sequence); };
  const resetSelectedSequence = () => { if (selected) audioSequences.reset(selected.item_uuid); };
  const downloadBackup = () => { const blob = new Blob([JSON.stringify({version: 4, study: study.exportSnapshot(), audio_sequences: audioSequences.exportSnapshot()}, null, 2)], {type: "application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ielts-vocabulary-progress.json"; link.click(); URL.revokeObjectURL(link.href); };
  const restoreBackup = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && "study" in parsed) { const backup = parsed as {study: unknown; audio_sequences?: unknown}; study.restore(backup.study); if (backup.audio_sequences !== undefined) audioSequences.restore(backup.audio_sequences); } else { study.restore(parsed); } setMessage("Progress and playback recipes restored."); }).catch(() => setError("Progress backup is not valid JSON.")); };
  const exportAudio = () => { if (!chapter) return; const ids = items.filter(item => study.card(item.item_uuid)?.flagged).map(item => item.stable_id); if (!ids.length) { setMessage("No flagged items in this chapter."); return; } void exportFlaggedAudio(chapter, ids).then(result => { setMessage(`Export ready: ${result.file_name}`); window.open(result.audio_url, "_blank"); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Export failed.")); };
  return <div className="app-shell">
    <div className="content-scroll">
    <header className="topbar"><div className="brand-lockup"><img className="brand-icon" src="/icon.svg" alt="" aria-hidden="true" /><div><span className="eyebrow">IELTS VOCABULARY · SOURCE-AWARE AUDIO</span><h1>{summary?.title || "IELTS Vocabulary"}</h1><p>{summary ? `${summary.items} items · ${summary.book_reference_items} reviewed-book references · ${summary.book_order_review_items} order-only alignments to review` : "Loading corpus…"}</p></div></div><button className="outline" onClick={() => setShowBackup(value => !value)}>Progress</button></header>
    {showBackup ? <section className="backup-panel"><button type="button" onClick={downloadBackup}>Download progress</button><label className="file-button">Restore progress<input type="file" accept="application/json" onChange={restoreBackup} /></label><button type="button" onClick={() => { if (window.confirm("Archive and reset local progress?")) study.reset(); }}>Reset progress</button></section> : null}
    <nav className="chapter-strip" aria-label="Chapters"><button className={chapter === null ? "active" : ""} onClick={() => setChapter(null)}>All</button>{chapters.map(item => <button key={item.number} className={chapter === item.number ? "active" : ""} onClick={() => setChapter(item.number)}>Ch {item.number}</button>)}</nav>
    <section className="toolbar"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search book word, meaning, collocation, sentence…" /><div className="filters">{(["all", "order-only", "review", "unmarked", "known", "flagged"] as Filter[]).map(value => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "order-only" ? "Order-only" : value[0].toUpperCase() + value.slice(1)}{value === "order-only" ? ` ${counts.orderOnly}` : value === "known" ? ` ${counts.known}` : value === "flagged" ? ` ${counts.flagged}` : value === "review" ? ` ${counts.review}` : ""}</button>)}</div><button type="button" onClick={() => setFilter("flagged")} className="export" onDoubleClick={exportAudio}>Export flagged</button></section>
    <main className="study-layout">
      <aside className="item-list" aria-label="Vocabulary items">
        {visibleItems.map(item => {
          const itemCard = study.card(item.item_uuid);
          const itemBookReference = item.book_reference;
          const itemDisplayWord = itemBookReference?.headword || item.headword;
          const itemIsOrderOnly = isOrderOnlyReview(itemBookReference);
          return <button type="button" key={item.stable_id} className={selected?.stable_id === item.stable_id ? "item-row active" : "item-row"} onClick={() => setSelectedId(item.stable_id)}>
            <span>{String(item.position).padStart(3, "0")}</span>
            <strong>{itemDisplayWord}</strong>
            <small>{itemCard?.known ? "✓" : ""}{itemCard?.flagged ? " ⚑" : ""}{itemIsOrderOnly ? " · order-only" : itemBookReference ? " · book" : ""}</small>
          </button>;
        })}
      </aside>
      <section className="focus"><FocusCard selected={selected} card={card} sequence={selectedSequence} onToggle={toggle} onSequenceChange={updateSelectedSequence} onSequenceReset={resetSelectedSequence} /></section>
    </main>
    </div>
     <section className="player-dock" aria-label="Fixed playback controls"><div className="player-dock-inner"><AudioPlayer item={selected} sequence={playbackSequence} mode={mode} runMode={runMode} onNextItem={advanceNext} onPreviousItem={advancePrevious} onRunModeChange={setRunMode} canNextItem={canNextItem} canPreviousItem={canPreviousItem} onPlayed={item => study.recordPlayed(item)} /><div className="player-settings"><label>Content <select value={mode} onChange={event => changeMode(event.target.value as PlaybackMode)}><option value="sequence">Configured four-part sequence</option><option value="words">English word only</option><option value="sentences">English sentence only</option></select></label><span>{message || (card?.due_at ? `Review due ${new Date(card.due_at).toLocaleDateString()}` : "Playback enrolls this word for review")}</span></div></div></section>
    {error ? <div className="toast error">{error}</div> : null}
  </div>;
}
