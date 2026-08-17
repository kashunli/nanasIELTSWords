import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getChapters, getItems, getSummary } from "./api";
import type { AudioElementId, AudioSequenceConfig, AudioSequenceStep, CardState, Chapter, Item, Summary } from "./types";
import { LocalStudyState } from "./features/study/localStudyState";
import { LocalAudioSequenceState } from "./features/player/localAudioSequenceState";
import { LineWaveform } from "./features/player/LineWaveform";
import { appendAudioSequenceStep, AUDIO_ELEMENT_IDS, expandPlayableAudioSequence, nextAudioSequenceStep, removeAudioSequenceStep, reorderAudioSequence, updateAudioSequenceStep } from "./features/player/audioSequence.mjs";
import { detectSilenceGapsMs } from "./features/player/waveform.mjs";
import { useAudioBufferPlayer } from "./features/player/useAudioBufferPlayer";

type Filter = "all" | "review" | "unmarked" | "known" | "flagged";
type RunMode = "single" | "consecutive";

const AUDIO_ELEMENT_LABELS: Record<AudioElementId, string> = {
  word: "English word",
  sentence: "English sentence",
  word_translation: "Chinese word translation",
  sentence_translation: "Chinese sentence translation",
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
  return sequence.steps.map(step => `${step.id}:${step.element}:${step.repeatCount}:${step.pauseAfterSeconds}`).join("|");
}

type AudioCue = AudioSequenceStep & {url: string; occurrence: number};
type PlayRequest = {itemUuid: string; requestId: number; element?: AudioElementId};

function IconReplay() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>;
}
function IconPrevious() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>;
}
function IconNext() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>;
}
function IconPlay() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
}
function IconPause() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
}
function IconRepeat() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>;
}
function IconRepeatOne() {
  return <svg className="ctrl-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-4v2h2v4h2z"/></svg>;
}

function AudioPlayer({item, sequence, runMode, playRequest, onNextItem, onPreviousItem, onRunModeChange, canNextItem, canPreviousItem, onPlayed}: {
  item?: Item;
  sequence: AudioSequenceConfig;
  runMode: RunMode;
  playRequest?: PlayRequest;
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
  const handledPlayRequestRef = useRef<number | null>(null);
  const activeCueIndex = playableCues.length ? Math.min(cueIndex, playableCues.length - 1) : 0;
  const currentCue = playableCues[activeCueIndex];
  const url = currentCue?.url || "";
  const targetKey = item && currentCue ? `${item.item_uuid}:${currentCue.id}:${currentCue.element}:${currentCue.occurrence}:${url}` : "";
  const requestedCueIndex = playRequest?.element
    ? playableCues.findIndex(cue => cue.element === playRequest.element)
    : 0;

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
        segmentId: `${item.item_uuid}:${currentCue.id}:${currentCue.element}:${currentCue.occurrence}`,
      });
    } catch {
      setPlayerError("Audio could not be played.");
    }
  };

  useEffect(() => {
    if (!playRequest || !item || playRequest.itemUuid !== item.item_uuid || !currentCue || requestedCueIndex < 0 || handledPlayRequestRef.current === playRequest.requestId) return;
    handledPlayRequestRef.current = playRequest.requestId;
    clearWaiting();
    continueSequenceRef.current = !playRequest.element;
    playOnTargetChangeRef.current = true;
    pendingTargetPlayRef.current = true;
    if (activeCueIndex !== requestedCueIndex) {
      setCueIndex(requestedCueIndex);
      return;
    }
    if (player.audioBuffer && player.loadedAudioUrl === url) {
      pendingTargetPlayRef.current = false;
      void playFrom(0);
    }
  }, [activeCueIndex, currentCue, item?.item_uuid, playRequest?.element, playRequest?.itemUuid, playRequest?.requestId, player.audioBuffer, player.loadedAudioUrl, requestedCueIndex, targetKey, url]);

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
      } else if (key === "c") {
        event.preventDefault();
        toggleRunMode();
      }
    };
    document.addEventListener("keydown", handleKeyDown, {capture: true});
    return () => document.removeEventListener("keydown", handleKeyDown, {capture: true});
  }, [advanceManually, hasNextTarget, hasPreviousTarget, player.audioBuffer, previousManually, replay, toggle, toggleRunMode]);

  if (!item) return <section className="player empty-player">Select an item to begin listening.</section>;
  if (!currentCue) return <section className="player empty-player">No playable audio is available for this item yet.</section>;

  return <section className="player" aria-label="Audio player">
    <div className="player-controls" role="toolbar" aria-label="Playback controls">
      <button type="button" onClick={replay} disabled={!player.audioBuffer} aria-label="Replay configured audio sequence" aria-keyshortcuts="R" title="Replay (R)"><IconReplay /></button>
      <button type="button" onClick={previousManually} disabled={!hasPreviousTarget} aria-label="Previous audio element or item" aria-keyshortcuts="A" title="Previous (A)"><IconPrevious /></button>
      <button type="button" onClick={advanceManually} disabled={!hasNextTarget} aria-label="Next audio element or item" aria-keyshortcuts="D" title="Next (D)"><IconNext /></button>
      <button type="button" className={`player-run-mode ${runMode === "consecutive" ? "selected" : ""}`} onClick={toggleRunMode} aria-label="Toggle single or consecutive playback" aria-pressed={runMode === "consecutive"} aria-keyshortcuts="C" title={`${runMode === "single" ? "Single" : "Consecutive"} playback (C)`}>{runMode === "consecutive" ? <IconRepeat /> : <IconRepeatOne />}</button>
      <button
        type="button"
        className="primary play-toggle"
        onClick={toggle}
        disabled={!player.audioBuffer}
        aria-label={`${player.isPlaying ? "Pause" : "Play"} ${AUDIO_ELEMENT_LABELS[currentCue.element]}`}
        aria-keyshortcuts="Space"
        title={`${player.isPlaying ? "Pause" : "Play"} (Space)`}
      >
        {player.isPlaying ? <IconPause /> : <IconPlay />}
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
    {playerError || waitingForNextCue ? <div className="player-status">{playerError || `Paused ${currentCue.pauseAfterSeconds.toFixed(1)}s before the next audio element`}</div> : null}
  </section>;
}

function cleanCollocation(value: string) {
  return value.replace(/^\[搭\]\s*/, "");
}

function audioUrlForElement(item: Item | undefined, element: AudioElementId) {
  return itemAudioUrls(item)[element] || "";
}

function AudioSequenceEditor({item, sequence, onChange, onReset, onClose}: {
  item?: Item;
  sequence: AudioSequenceConfig;
  onChange: (sequence: AudioSequenceConfig) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null);
  const availableCount = AUDIO_ELEMENT_IDS.filter(element => Boolean(audioUrlForElement(item, element))).length;
  const updateStep = (step: AudioSequenceStep, patch: Partial<Pick<AudioSequenceStep, "repeatCount" | "pauseAfterSeconds">>) => {
    onChange(updateAudioSequenceStep(sequence, step.id, patch));
  };
  const addStep = (element: AudioElementId) => {
    onChange(appendAudioSequenceStep(sequence, element));
    setAddMenuOpen(false);
  };

  return <section className="sequence-editor" aria-label="Global playback recipe">
    <div className="sequence-editor-header">
      <div className="section-heading"><span>PLAYBACK RECIPE</span><strong>Listening sequence</strong></div>
      <div className="sequence-editor-header-actions">
        <span className="sequence-editor-summary">{item ? `${availableCount}/${AUDIO_ELEMENT_IDS.length} audio files available for this word` : "Select a word to check audio availability"}</span>
        <button type="button" className="sequence-close" onClick={onClose} aria-label="Close playback recipe settings">×</button>
      </div>
    </div>
    <p className="sequence-editor-intro">Each row is one playback occurrence. Add the same audio more than once when you want it repeated later.</p>
    <ol className="sequence-rows">
      {(() => {
        const occurrenceCounts = new Map<AudioElementId, number>();
        return sequence.steps.map((step, index) => {
          const available = Boolean(audioUrlForElement(item, step.element));
          const occurrence = (occurrenceCounts.get(step.element) || 0) + 1;
          occurrenceCounts.set(step.element, occurrence);
          const fromIndex = draggingStepId ? sequence.steps.findIndex(candidate => candidate.id === draggingStepId) : -1;
          return <li
            key={step.id}
            className={`sequence-row ${available ? "available" : "pending"} ${draggingStepId === step.id ? "dragging" : ""}`}
            draggable
            onDragStart={event => {
              setDraggingStepId(step.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              if (fromIndex >= 0 && fromIndex !== index) onChange(reorderAudioSequence(sequence, fromIndex, index));
              setDraggingStepId(null);
            }}
            onDragEnd={() => setDraggingStepId(null)}
          >
            <div className="sequence-row-leading">
              <span className="sequence-position" aria-hidden="true">{index + 1}</span>
              <span className="sequence-drag-handle" aria-hidden="true">⠿</span>
            </div>
            <div className="sequence-row-name">
              <div className="sequence-row-title">
                <strong>{AUDIO_ELEMENT_LABELS[step.element]}</strong>
                {occurrence > 1 ? <span className="sequence-repeat-badge">REPEAT</span> : null}
              </div>
              <small>{available ? "Audio available" : "Audio to be added later"}</small>
            </div>
            <div className="sequence-order-buttons" aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]}`}>
              <button type="button" onClick={() => onChange(reorderAudioSequence(sequence, index, index - 1))} disabled={index === 0} aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]} earlier`}>↑</button>
              <button type="button" onClick={() => onChange(reorderAudioSequence(sequence, index, index + 1))} disabled={index === sequence.steps.length - 1} aria-label={`Move ${AUDIO_ELEMENT_LABELS[step.element]} later`}>↓</button>
            </div>
            <label className="sequence-number-field sequence-repeat-field"><span>REPEAT</span>
              <input type="number" min="0" max="20" step="1" value={step.repeatCount} onChange={event => updateStep(step, {repeatCount: Number(event.target.value)})} />
            </label>
            <label className="sequence-number-field sequence-pause-field"><span>PAUSE AFTER</span>
              <span className="sequence-seconds-input"><input type="number" min="0" max="60" step="0.1" value={step.pauseAfterSeconds} onChange={event => updateStep(step, {pauseAfterSeconds: Number(event.target.value)})} /><b>s</b></span>
            </label>
            <button type="button" className="sequence-remove" onClick={() => onChange(removeAudioSequenceStep(sequence, step.id))} disabled={sequence.steps.length <= 1} aria-label={`Remove ${AUDIO_ELEMENT_LABELS[step.element]} occurrence`}>×</button>
          </li>;
        });
      })()}
    </ol>
    <div className="sequence-add-area">
      <button type="button" className="sequence-add-step" onClick={() => setAddMenuOpen(value => !value)} aria-expanded={addMenuOpen}>＋ <span>Add step</span></button>
      {addMenuOpen ? <div className="sequence-add-menu" role="menu" aria-label="Choose an audio step">
        {AUDIO_ELEMENT_IDS.map(element => <button key={element} type="button" role="menuitem" onClick={() => addStep(element)}>{AUDIO_ELEMENT_LABELS[element]}</button>)}
      </div> : null}
    </div>
    <div className="sequence-editor-footer">
      <span>Pause applies after every playback, including repeats, before the next available element or item.</span>
      <div className="sequence-editor-actions">
        <button type="button" className="sequence-reset" onClick={onReset}>Reset sequence</button>
        <button type="button" className="sequence-save" onClick={onClose}>Save sequence</button>
      </div>
    </div>
  </section>;
}

type CardToggle = "known" | "flagged";

function AudioTextButton({children, className, onClick, ariaLabel, disabled = false}: {
  children: ReactNode;
  className: string;
  onClick: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return <button type="button" className={`content-audio-trigger ${className}`} onClick={onClick} aria-label={ariaLabel} disabled={disabled}>{children}</button>;
}

function FocusCard({selected, card, onToggle, onPlayAudio, listOpen, onToggleList}: {
  selected?: Item;
  card?: CardState;
  onToggle: (key: CardToggle) => void;
  onPlayAudio: (element: AudioElementId) => void;
  listOpen: boolean;
  onToggleList: () => void;
}) {
  if (!selected) return <div className="focus-card"><p>Select an item from the list.</p></div>;

  const book = selected.book_reference;
  const displayWord = book?.headword || selected.headword;
  const displayPartOfSpeech = book?.part_of_speech || selected.part_of_speech || "word";
  const displaySentence = book?.example_en || selected.sentence;
  const displayMeaningZh = book?.meaning_zh || selected.meaning_zh;
  const hasUsage = Boolean(book && (book.collocations || book.word_formation || book.notes));
  const hasReviewedEnglishMeaning = selected.meaning_status === "reviewed" && Boolean(selected.meaning_en.trim());

  return <div className="focus-card">
    <header className="word-hero">
      <div className="word-title-row">
        <h2><AudioTextButton className="word-audio-trigger" onClick={() => onPlayAudio("word")} ariaLabel={`Play ${displayWord}`} disabled={!selected.word_audio_url}>{displayWord}</AudioTextButton></h2>
        {displayMeaningZh ? <AudioTextButton className="word-translation-trigger" onClick={() => onPlayAudio("word_translation")} ariaLabel={`Play Chinese meaning for ${displayWord}`} disabled={!selected.word_translation_audio_url}>{displayMeaningZh}</AudioTextButton> : null}
      </div>
      <div className="word-facts">
        <span className="pos">{displayPartOfSpeech}</span>
        {book?.ipa ? <span className="ipa">{book.ipa}</span> : null}
      </div>
    </header>

    <section className="example-card current-line-card" aria-label="Current played lyric line" data-current-line>
      <AudioTextButton className="example-en example-audio-trigger" onClick={() => onPlayAudio("sentence")} ariaLabel={`Play example sentence for ${displayWord}`} disabled={!selected.sentence_audio_url}>{displaySentence}</AudioTextButton>
      {book?.example_zh ? <div className="example-translation"><AudioTextButton className="example-translation-text" onClick={() => onPlayAudio("sentence_translation")} ariaLabel={`Play Chinese translation of the example sentence for ${displayWord}`} disabled={!selected.sentence_translation_audio_url}>{book.example_zh}</AudioTextButton></div> : null}
    </section>

    {hasReviewedEnglishMeaning ? <section className="explanation-card" aria-label="Explanation below current line">
      <div className="section-heading"><span>EXPLANATION</span><strong>Understand this word in the current line</strong></div>
      <div className="explanation-grid">
        <article className="meaning-card meaning-primary">
          <span>MEANING</span>
          <p>{selected.meaning_en}</p>
          <small>Reviewed English meaning</small>
        </article>
      </div>
    </section> : null}

    {hasUsage ? <section className="usage-section" aria-label="Usage information">
      <div className="section-heading"><span>USAGE NOTES</span><strong>Useful patterns</strong></div>
      <div className="usage-grid">
        {book?.collocations ? <article><span>COLLOCATIONS</span><p>{cleanCollocation(book.collocations)}</p></article> : null}
        {book?.word_formation ? <article><span>WORD FORMATION</span><p>{book.word_formation}</p></article> : null}
        {book?.notes ? <article><span>NOTES</span><p>{book.notes}</p></article> : null}
      </div>
    </section> : null}

    <div className="card-actions">
      <button type="button" className={card?.known ? "selected" : ""} onClick={() => onToggle("known")}>✓ Known</button>
      <button type="button" className={card?.flagged ? "selected" : ""} onClick={() => onToggle("flagged")}>⚑ Flagged</button>
      <button type="button" className="list-toggle" onClick={onToggleList} aria-expanded={listOpen}>{listOpen ? "Hide list" : "List"}</button>
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
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [playRequest, setPlayRequest] = useState<PlayRequest>();
  const playRequestIdRef = useRef(0);
  const listRef = useRef<HTMLElement | null>(null);
  const [runMode, setRunMode] = useState<RunMode>("consecutive");
  const [stateVersion, setStateVersion] = useState(0);
  const [sequenceVersion, setSequenceVersion] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [showPlaybackSettings, setShowPlaybackSettings] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    const unsubscribeStudy = study.subscribe(() => setStateVersion(value => value + 1));
    const unsubscribeSequences = audioSequences.subscribe(() => setSequenceVersion(value => value + 1));
    return () => { unsubscribeStudy(); unsubscribeSequences(); };
  }, [audioSequences, study]);
  useEffect(() => { void Promise.all([getSummary(), getChapters()]).then(([nextSummary, nextChapters]) => { setSummary(nextSummary); setChapters(nextChapters); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load corpus.")); }, []);
  useEffect(() => { void getItems(chapter).then(nextItems => { setItems(nextItems); setSelectedId(current => current && nextItems.some(item => item.stable_id === current) ? current : nextItems[0]?.stable_id); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load items.")); }, [chapter]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);
  const visibleItems = useMemo(() => items.filter(item => { const card = study.card(item.item_uuid); if (filter === "known") return card?.known; if (filter === "flagged") return card?.flagged; if (filter === "unmarked") return !card?.known && !card?.flagged; if (filter === "review") return Boolean(card?.due_at && Date.parse(card.due_at) <= Date.now()); return true; }), [items, filter, stateVersion, study]);
  const selected = visibleItems.find(item => item.stable_id === selectedId) || visibleItems[0];
  useEffect(() => {
    const active = listRef.current?.querySelector?.(".item-row.active");
    active?.scrollIntoView({block: "nearest", inline: "nearest"});
  }, [selected?.stable_id, listOpen]);
  const counts = useMemo(() => ({known: items.filter(item => study.card(item.item_uuid)?.known).length, flagged: items.filter(item => study.card(item.item_uuid)?.flagged).length, review: items.filter(item => { const due = study.card(item.item_uuid)?.due_at; return due && Date.parse(due) <= Date.now(); }).length}), [items, stateVersion, study]);
  const selectedIndex = selected ? visibleItems.findIndex(item => item.stable_id === selected.stable_id) : -1;
  const card = selected ? study.card(selected.item_uuid) : undefined;
  const globalSequence = useMemo(() => audioSequences.config(), [audioSequences, sequenceVersion]);
  const playerSequence = useMemo(() => {
    const requestedElement = playRequest?.element;
    if (!requestedElement) return globalSequence;
    const requestedStep = globalSequence.steps.find(step => step.element === requestedElement);
    if (!requestedStep) return globalSequence;
    const steps = globalSequence.steps.map(step => step.element === requestedElement
      ? {...step, repeatCount: Math.max(1, step.repeatCount), pauseAfterSeconds: 0}
      : step);
    if (!steps.some(step => step.element === requestedElement)) {
      steps.push({...requestedStep, repeatCount: Math.max(1, requestedStep.repeatCount), pauseAfterSeconds: 0});
    }
    return {version: 2 as const, steps};
  }, [globalSequence, playRequest?.element]);
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
  const canNextItem = Boolean(selected && selectedIndex >= 0 && selectedIndex < visibleItems.length - 1);
  const canPreviousItem = Boolean(selected && selectedIndex > 0);
  const toggle = (key: "known" | "flagged") => { if (selected) study.update(selected.item_uuid, {[key]: !card?.[key]}); };
  const requestPlayback = (item: Item, element?: AudioElementId) => {
    playRequestIdRef.current += 1;
    setSelectedId(item.stable_id);
    setPlayRequest({itemUuid: item.item_uuid, requestId: playRequestIdRef.current, element});
  };
  const selectAndPlay = (item: Item) => requestPlayback(item);
  const playSelectedAudio = (element: AudioElementId) => { if (selected) requestPlayback(selected, element); };
  const updateGlobalSequence = (sequence: AudioSequenceConfig) => { audioSequences.update(sequence); };
  const resetGlobalSequence = () => { audioSequences.reset(); };
  const downloadBackup = () => { const blob = new Blob([JSON.stringify({version: 5, study: study.exportSnapshot(), audio_sequence: audioSequences.exportSnapshot()}, null, 2)], {type: "application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ielts-vocabulary-progress.json"; link.click(); URL.revokeObjectURL(link.href); };
  const restoreBackup = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && "study" in parsed) { const backup = parsed as {study: unknown; audio_sequence?: unknown; audio_sequences?: unknown}; study.restore(backup.study); if (backup.audio_sequence !== undefined) audioSequences.restore(backup.audio_sequence); else if (backup.audio_sequences !== undefined) audioSequences.restore(backup.audio_sequences); } else { study.restore(parsed); } setMessage("Progress and global playback settings restored."); }).catch(() => setError("Progress backup is not valid JSON.")); };
  return <div className="app-shell">
    <div className="content-scroll">
    <header className="topbar"><div className="brand-lockup"><img className="brand-icon" src="/icon.svg" alt="" aria-hidden="true" /><div className="brand-text"><span className="eyebrow">IELTS VOCABULARY</span><h1>{summary?.title || "IELTS Vocabulary"}</h1><p>{summary ? `${summary.items} items` : "Loading corpus…"}</p></div></div><div className="topbar-controls"><select className="chapter-select" value={chapter === null ? "" : String(chapter)} onChange={event => setChapter(event.target.value === "" ? null : Number(event.target.value))} aria-label="Select chapter"><option value="">All chapters</option>{chapters.map(item => <option key={item.number} value={String(item.number)}>Ch {item.number}</option>)}</select><select className="filter-select" value={filter} onChange={event => setFilter(event.target.value as Filter)} aria-label="Filter items">{(["all", "review", "unmarked", "known", "flagged"] as Filter[]).map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}{value === "known" ? ` (${counts.known})` : value === "flagged" ? ` (${counts.flagged})` : value === "review" ? ` (${counts.review})` : ""}</option>)}</select><button className="outline" onClick={() => setShowBackup(value => !value)}>Progress</button><button type="button" className={`outline settings-trigger ${showPlaybackSettings ? "selected" : ""}`} onClick={() => setShowPlaybackSettings(value => !value)} aria-label={showPlaybackSettings ? "Close global playback settings" : "Open global playback settings"} aria-expanded={showPlaybackSettings} title="Global playback settings"><span className="settings-gear" aria-hidden="true">⚙</span><span>Recipe</span></button></div></header>
    {showBackup ? <section className="backup-panel"><button type="button" onClick={downloadBackup}>Download progress</button><label className="file-button">Restore progress<input type="file" accept="application/json" onChange={restoreBackup} /></label><button type="button" onClick={() => { if (window.confirm("Archive and reset local progress?")) study.reset(); }}>Reset progress</button></section> : null}
    <main className="study-layout">
      <aside ref={listRef} className={`item-list ${listOpen ? "open" : ""}`} aria-label="Vocabulary items">
        {visibleItems.map(item => {
          const itemCard = study.card(item.item_uuid);
          return <button type="button" key={item.stable_id} className={selected?.stable_id === item.stable_id ? "item-row active" : "item-row"} onClick={() => { selectAndPlay(item); setListOpen(false); }} aria-label={`Play ${item.headword}`} title={`Play ${item.headword}`}>
            <span>{String(item.position).padStart(3, "0")}</span>
            <strong>{item.headword}</strong>
            <small>{itemCard?.known ? "✓" : ""}{itemCard?.flagged ? " ⚑" : ""}</small>
          </button>;
        })}
      </aside>
      <section className="focus"><FocusCard selected={selected} card={card} onToggle={toggle} onPlayAudio={playSelectedAudio} listOpen={listOpen} onToggleList={() => setListOpen(value => !value)} /></section>
    </main>
    </div>
      <section className="player-dock" aria-label="Fixed playback controls"><div className="player-dock-inner"><AudioPlayer item={selected} sequence={playerSequence} runMode={runMode} playRequest={playRequest} onNextItem={advanceNext} onPreviousItem={advancePrevious} onRunModeChange={setRunMode} canNextItem={canNextItem} canPreviousItem={canPreviousItem} onPlayed={item => study.recordPlayed(item)} /></div>{showPlaybackSettings ? <div className="playback-settings-popover" role="dialog" aria-label="Global playback settings"><AudioSequenceEditor item={selected} sequence={globalSequence} onChange={updateGlobalSequence} onReset={resetGlobalSequence} onClose={() => setShowPlaybackSettings(false)} /></div> : null}</section>
    {error ? <div className="toast error">{error}</div> : null}{message ? <div className="toast success">{message}</div> : null}
  </div>;
}
