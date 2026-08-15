import { useEffect, useMemo, useRef, useState } from "react";
import { exportFlaggedAudio, getChapters, getItems, getSummary } from "./api";
import type { BookReference, CardState, Chapter, Item, Summary } from "./types";
import { LocalStudyState } from "./features/study/localStudyState";
import { LocalAsrReviewState } from "./features/review/asrReviewState.mjs";
import { LineWaveform } from "./features/player/LineWaveform";
import { nextPlaybackStep } from "./features/player/playbackSequence.mjs";
import { detectSilenceGapsMs } from "./features/player/waveform.mjs";
import { useAudioBufferPlayer } from "./features/player/useAudioBufferPlayer";

type Filter = "all" | "asr" | "order-only" | "review" | "unmarked" | "known" | "flagged";
type Phase = "word" | "sentence";
type PlaybackMode = "words" | "sentences" | "both";
type RunMode = "single" | "consecutive";

function AudioPlayer({item, phase, mode, runMode, onEnd, onNext, onPrevious, onRunModeChange, canNext, canPrevious}: {item?: Item; phase: Phase; mode: PlaybackMode; runMode: RunMode; onEnd: () => boolean; onNext: () => boolean; onPrevious: () => boolean; onRunModeChange: (mode: RunMode) => void; canNext: boolean; canPrevious: boolean}) {
  const url = item ? phase === "word" ? item.word_audio_url : item.sentence_audio_url : "";
  const autoAdvanceRef = useRef(false);
  const playOnTargetChangeRef = useRef(false);
  const pendingTargetPlayRef = useRef(false);
  const lastTargetKeyRef = useRef<string | undefined>(undefined);
  const currentTimeRef = useRef(0);
  const targetKey = item ? `${item.item_uuid}:${phase}:${url}` : "";
  const player = useAudioBufferPlayer(url, () => {
    const continued = onEnd();
    if (!continued) {
      autoAdvanceRef.current = false;
      pendingTargetPlayRef.current = false;
    }
  });
  const [playerError, setPlayerError] = useState("");
  currentTimeRef.current = player.currentTime;

  useEffect(() => {
    if (targetKey === lastTargetKeyRef.current) return;
    lastTargetKeyRef.current = targetKey;
    setPlayerError("");
    pendingTargetPlayRef.current = playOnTargetChangeRef.current || autoAdvanceRef.current;
    playOnTargetChangeRef.current = false;
  }, [targetKey]);

  const playFrom = async (offset: number) => {
    if (!item || !player.audioBuffer) return;
    const duration = player.audioBuffer.duration;
    const safeOffset = offset >= duration ? 0 : Math.max(0, offset);
    try {
      await player.playRange({
        start: 0,
        end: duration,
        offset: safeOffset,
        segmentId: `${item.item_uuid}:${phase}`,
      });
    } catch {
      setPlayerError("Audio could not be played.");
    }
  };

  // A newly selected target is allowed to autoplay only when the current run
  // explicitly requested continuation (or the user pressed Next).
  useEffect(() => {
    if (!pendingTargetPlayRef.current || !item || !player.audioBuffer || player.loadedAudioUrl !== url || player.isPlaying) return;
    pendingTargetPlayRef.current = false;
    void playFrom(0);
  }, [item, player.audioBuffer, player.isPlaying, player.loadedAudioUrl, targetKey, url]);

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
  const toggle = () => {
    if (player.isPlaying) {
      player.pause();
      return;
    }
    autoAdvanceRef.current = runMode === "consecutive";
    pendingTargetPlayRef.current = false;
    void playFrom(currentTimeRef.current);
  };
  const replay = () => {
    autoAdvanceRef.current = runMode === "consecutive";
    player.setPosition(0);
    void playFrom(0);
  };
  const advanceManually = () => {
    playOnTargetChangeRef.current = true;
    autoAdvanceRef.current = runMode === "consecutive";
    const advanced = onNext();
    if (!advanced) {
      playOnTargetChangeRef.current = false;
      autoAdvanceRef.current = false;
    }
  };
  const previousManually = () => {
    playOnTargetChangeRef.current = true;
    autoAdvanceRef.current = runMode === "consecutive";
    const moved = onPrevious();
    if (!moved) {
      playOnTargetChangeRef.current = false;
      autoAdvanceRef.current = false;
    }
  };
  const toggleRunMode = () => {
    const nextMode: RunMode = runMode === "single" ? "consecutive" : "single";
    if (nextMode === "single") {
      autoAdvanceRef.current = false;
      pendingTargetPlayRef.current = false;
    } else if (player.isPlaying) {
      autoAdvanceRef.current = true;
    }
    onRunModeChange(nextMode);
  };
  const stop = () => {
    autoAdvanceRef.current = false;
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
        if (canPrevious) previousManually();
      } else if (key === "d") {
        event.preventDefault();
        if (canNext) advanceManually();
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
  }, [advanceManually, canNext, canPrevious, player.audioBuffer, previousManually, replay, stop, toggle, toggleRunMode]);

  if (!item) return <section className="player empty-player">Select an item to begin listening.</section>;

  return <section className="player" aria-label="Audio player">
    <div className="player-meta">
      <div className="player-current">
        <span className="player-kicker">CURRENT AUDIO</span>
        <strong>{item.headword}</strong>
      </div>
      <span className="audio-time" aria-label="Playback time">{progressLabel}</span>
    </div>
    <div className="player-controls" role="toolbar" aria-label="Playback controls">
      <button type="button" onClick={replay} disabled={!player.audioBuffer} aria-label="Replay audio" aria-keyshortcuts="R"><span className="button-label-full">Replay</span><span className="button-label-short">Replay</span></button>
      <button type="button" onClick={previousManually} disabled={!canPrevious} aria-label="Previous audio" aria-keyshortcuts="A"><span className="button-label-full">Previous</span><span className="button-label-short">Prev</span></button>
      <button type="button" onClick={advanceManually} disabled={!canNext} aria-label="Next audio" aria-keyshortcuts="D"><span className="button-label-full">Next</span><span className="button-label-short">Next</span></button>
      <button type="button" onClick={stop} disabled={!player.audioBuffer} aria-label="Stop audio" aria-keyshortcuts="S"><span className="button-label-full">Stop</span><span className="button-label-short">Stop</span></button>
      <button type="button" className={`player-run-mode ${runMode === "consecutive" ? "selected" : ""}`} onClick={toggleRunMode} aria-label="Toggle single or consecutive playback" aria-pressed={runMode === "consecutive"} aria-keyshortcuts="C"><span className="button-label-full">{runMode === "single" ? "Single" : "Consecutive"}</span><span className="button-label-short">{runMode === "single" ? "Single" : "Consec."}</span></button>
      <button
        type="button"
        className="primary play-toggle"
        onClick={toggle}
        disabled={!player.audioBuffer}
        aria-label={`${player.isPlaying ? "Pause" : "Play"} ${phase} audio`}
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
    <div className="player-help">{playerError || `${phase} · ${runMode === "single" ? "single clip" : "play through list"} · ${mode} · A/D previous/next · Space play/pause`}</div>
  </section>;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function normalizeDisplayWord(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordsDiffer(bookWord: string, asrWord: string) {
  return normalizeDisplayWord(bookWord) !== normalizeDisplayWord(asrWord);
}

function bookWordMatches(item: Item) {
  const reference = item.book_reference;
  if (!reference) return false;
  if (reference.alignment_status === "matched_headword" || reference.alignment_status === "matched_sentence") return true;
  return !wordsDiffer(reference.headword, item.headword);
}

function bookSentenceMatches(reference?: BookReference) {
  return Boolean(reference && (reference.sentence_match === "exact" || reference.sentence_match === "normalized"));
}

function isOrderOnlyReview(reference?: BookReference) {
  return Boolean(reference?.alignment_status === "matched_order" && reference.needs_review);
}

function bookResolvesAsrReview(item: Item) {
  return Boolean(item.transcript_status === "needs_review" && (bookWordMatches(item) || bookSentenceMatches(item.book_reference)));
}

function alignmentLabel(reference: BookReference) {
  if (reference.alignment_status === "matched_sentence") return "Matched by exact sentence";
  if (reference.alignment_status === "matched_headword") return "Matched by book word";
  return "Matched by chapter order";
}

function sentenceMatchLabel(reference: BookReference) {
  if (reference.sentence_match === "exact") return "Exact audio sentence match";
  if (reference.sentence_match === "normalized") return "Same audio sentence after punctuation normalization";
  return "Book example differs from audio transcript";
}

function cleanCollocation(value: string) {
  return value.replace(/^\[搭\]\s*/, "");
}

function TranslationAudio({url, label}: {url: string; label: string}) {
  if (!url) return null;
  return <audio className="translation-audio" controls preload="none" src={url} aria-label={`Play ${label}`} />;
}

type CardToggle = "known" | "flagged" | "sentence_starred";

function FocusCard({selected, card, asrPending, asrConfirmed, onConfirmSentence, onKeepSentence, onUndoSentence, onToggle}: {
  selected?: Item;
  card?: CardState;
  asrPending: boolean;
  asrConfirmed: boolean;
  onConfirmSentence: () => void;
  onKeepSentence: () => void;
  onUndoSentence: () => void;
  onToggle: (key: CardToggle) => void;
}) {
  if (!selected) return <div className="focus-card"><p>Select an item from the list.</p></div>;

  const book = selected.book_reference;
  const orderOnlyReference = book?.alignment_status === "matched_order" && book.needs_review ? book : undefined;
  const displayWord = book?.headword || selected.headword;
  const displayPartOfSpeech = book?.part_of_speech || selected.part_of_speech || "word";
  const displaySentence = book?.example_en || selected.sentence;
  const displayMeaningZh = book?.meaning_zh || selected.meaning_zh;
  const hasUsage = Boolean(book && (book.collocations || book.word_formation || book.notes));
  const bookWordIsAuthoritative = bookWordMatches(selected);
  const hasAsrWordEvidence = !book || !bookWordIsAuthoritative;
  const hasAsrSentenceEvidence = !book || (!bookWordIsAuthoritative && !bookSentenceMatches(book));
  const hasAsrEvidence = !bookWordIsAuthoritative && (!book || hasAsrWordEvidence || hasAsrSentenceEvidence);
  const sentenceDiffers = hasAsrSentenceEvidence;
  const bookResolvedReview = bookResolvesAsrReview(selected);

  return <div className="focus-card">
    <div className="focus-meta">
      <span>Chapter {selected.chapter} · #{selected.position}</span>
      {book ? <span className={`source-badge ${book.alignment_status}`}>{alignmentLabel(book)}</span> : <span className="source-badge asr-only">ASR-only record</span>}
      {bookResolvedReview ? <span className="confirmed">Book match is authoritative</span> : asrPending ? <span className="warning">Sentence ASR review needed</span> : asrConfirmed ? <span className="confirmed">Sentence ASR confirmed in this browser</span> : null}
    </div>

    <header className="word-hero">
      <h2>{displayWord}</h2>
      {hasAsrWordEvidence ? <p className="asr-original">ASR heard: <code>{selected.headword}</code></p> : null}
      <div className="word-facts">
        <span className="pos">{displayPartOfSpeech}</span>
        {book?.ipa ? <span className="ipa">{book.ipa}</span> : null}
        {book ? <span className="book-source-inline">Reviewed book reference</span> : null}
      </div>
    </header>

    <section className="example-card current-line-card" aria-label="Current played lyric line" data-current-line>
      <div className="section-kicker-row">
        <span>CURRENT LINE</span>
        {book && !bookWordIsAuthoritative ? <span className={`match-badge ${book.sentence_match}`}>{sentenceMatchLabel(book)}</span> : null}
      </div>
      <p className="example-en">{displaySentence}</p>
      {book?.example_zh ? <div className="example-translation"><div className="translation-heading"><span>中文翻译</span><TranslationAudio url={selected.example_zh_audio_url} label="Chinese example translation" /></div><p>{book.example_zh}</p></div> : null}
      {sentenceDiffers ? <div className="sentence-compare"><span>ASR SENTENCE</span><p>{selected.sentence}</p></div> : null}
    </section>

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
          <div className="translation-heading"><span>中文释义</span><TranslationAudio url={selected.meaning_zh_audio_url} label="Chinese meaning" /></div>
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

    {hasAsrEvidence ? <section className="evidence-card" aria-label="ASR evidence">
      <div className="section-heading"><span>ASR EVIDENCE</span><strong>Unmatched fields from the audio transcription</strong></div>
      <div className="evidence-grid">
        {hasAsrWordEvidence ? <div><span>WORD AUDIO</span><code>{selected.headword}</code></div> : null}
        {hasAsrSentenceEvidence ? <div><span>SENTENCE AUDIO</span><p>{selected.sentence}</p></div> : null}
      </div>
      {asrPending ? <div className="asr-review-actions">
        <button type="button" className="confirm" onClick={onConfirmSentence}>✓ Confirm sentence audio</button>
        <button type="button" onClick={onKeepSentence}>Keep sentence in review queue</button>
      </div> : asrConfirmed ? <div className="asr-confirmed-actions"><span>Sentence reference confirmed in this browser.</span><button type="button" onClick={onUndoSentence}>Undo sentence confirmation</button></div> : null}
      <small>Book-backed fields are shown in the learner-facing card; raw ASR is retained only for unmatched fields and audit artifacts.</small>
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
  const asrReviewStore = useRef<LocalAsrReviewState | null>(null);
  if (!asrReviewStore.current) asrReviewStore.current = new LocalAsrReviewState();
  const asrReview = asrReviewStore.current;
  const [summary, setSummary] = useState<Summary>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [chapter, setChapter] = useState<number | null>(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [phase, setPhase] = useState<Phase>("word");
  const [mode, setMode] = useState<PlaybackMode>("both");
  const [runMode, setRunMode] = useState<RunMode>("consecutive");
  const [stateVersion, setStateVersion] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  useEffect(() => {
    const unsubscribeStudy = study.subscribe(() => setStateVersion(value => value + 1));
    const unsubscribeAsrReview = asrReview.subscribe(() => setStateVersion(value => value + 1));
    return () => { unsubscribeStudy(); unsubscribeAsrReview(); };
  }, [asrReview, study]);
  useEffect(() => { void Promise.all([getSummary(), getChapters()]).then(([nextSummary, nextChapters]) => { setSummary(nextSummary); setChapters(nextChapters); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load corpus.")); }, []);
  useEffect(() => { void getItems(chapter, search, filter === "order-only" ? "order_only" : undefined).then(nextItems => { setItems(nextItems); setSelectedId(current => current && nextItems.some(item => item.stable_id === current) ? current : nextItems[0]?.stable_id); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load items.")); }, [chapter, search, filter]);
  const isAsrPending = (item: Item) => item.transcript_status === "needs_review" && !bookResolvesAsrReview(item) && !asrReview.isConfirmed(item.stable_id);
  const isAsrConfirmed = (item: Item) => item.transcript_status === "needs_review" && !bookResolvesAsrReview(item) && asrReview.isConfirmed(item.stable_id);
  const visibleItems = useMemo(() => items.filter(item => { const card = study.card(item.item_uuid); if (filter === "order-only") return true; if (filter === "asr") return isAsrPending(item); if (filter === "known") return card?.known; if (filter === "flagged") return card?.flagged; if (filter === "unmarked") return !card?.known && !card?.flagged; if (filter === "review") return Boolean(card?.due_at && Date.parse(card.due_at) <= Date.now()); return true; }), [items, filter, stateVersion, study, asrReview]);
  const selected = visibleItems.find(item => item.stable_id === selectedId) || visibleItems[0];
  const counts = useMemo(() => ({asr: items.filter(isAsrPending).length, orderOnly: summary?.book_order_review_items || 0, known: items.filter(item => study.card(item.item_uuid)?.known).length, flagged: items.filter(item => study.card(item.item_uuid)?.flagged).length, review: items.filter(item => { const due = study.card(item.item_uuid)?.due_at; return due && Date.parse(due) <= Date.now(); }).length}), [items, stateVersion, study, asrReview, summary]);
  const selectedIndex = selected ? visibleItems.findIndex(item => item.stable_id === selected.stable_id) : -1;
  const finish = (): boolean => {
    if (!selected) return false;
    study.recordPlayed(selected);
    const step = nextPlaybackStep({
      playbackMode: mode,
      playbackRunMode: runMode,
      phase,
      hasSentence: Boolean(selected.sentence_audio_url),
      hasNextEntry: selectedIndex >= 0 && selectedIndex < visibleItems.length - 1,
    });
    if (step === "sentence") {
      setPhase("sentence");
      return true;
    }
    if (step === "next-entry") {
      const next = visibleItems[selectedIndex + 1];
      if (!next) return false;
      setSelectedId(next.stable_id);
      setPhase(mode === "sentences" ? "sentence" : "word");
      return true;
    }
    return false;
  };
  const advanceNext = (): boolean => {
    if (!selected) return false;
    if (mode === "both" && phase === "word" && selected.sentence_audio_url) {
      setPhase("sentence");
      return true;
    }
    const next = visibleItems[selectedIndex + 1];
    if (!next) return false;
    setSelectedId(next.stable_id);
    setPhase(mode === "sentences" ? "sentence" : "word");
    return true;
  };
  const advancePrevious = (): boolean => {
    if (!selected) return false;
    if (mode === "both" && phase === "sentence") {
      setPhase("word");
      return true;
    }
    const previous = visibleItems[selectedIndex - 1];
    if (!previous) return false;
    setSelectedId(previous.stable_id);
    setPhase(mode === "sentences" || (mode === "both" && Boolean(previous.sentence_audio_url)) ? "sentence" : "word");
    return true;
  };
  const changeMode = (nextMode: PlaybackMode) => { setMode(nextMode); setPhase(nextMode === "sentences" ? "sentence" : "word"); };
  const canNext = Boolean(selected && (mode === "both" && phase === "word" && selected.sentence_audio_url || selectedIndex >= 0 && selectedIndex < visibleItems.length - 1));
  const canPrevious = Boolean(selected && ((mode === "both" && phase === "sentence") || selectedIndex > 0));
  const card = selected ? study.card(selected.item_uuid) : undefined;
  const toggle = (key: "known" | "flagged" | "sentence_starred") => { if (selected) study.update(selected.item_uuid, {[key]: !card?.[key]}); };
  const selectedAsrPending = Boolean(selected && isAsrPending(selected));
  const selectedAsrConfirmed = Boolean(selected && isAsrConfirmed(selected));
  const selectedBookReference = selected?.book_reference;
  const selectedDisplayWord = selectedBookReference?.headword || selected?.headword || "";
  const confirmSentenceAsr = () => {
    if (!selected || !selectedAsrPending) return;
    const currentIndex = visibleItems.findIndex(item => item.stable_id === selected.stable_id);
    const nextItem = visibleItems[currentIndex + 1] || visibleItems[currentIndex - 1];
    asrReview.confirm(selected.stable_id);
    setMessage(`Sentence reference for ${selectedDisplayWord} confirmed in this browser.`);
    if (filter === "asr") {
      setSelectedId(nextItem?.stable_id);
      setPhase("word");
    }
  };
  const undoAsr = () => {
    if (!selected || !selectedAsrConfirmed) return;
    asrReview.undo(selected.stable_id);
    setMessage(`Sentence reference for ${selectedDisplayWord} returned to the ASR review queue.`);
  };
  const downloadBackup = () => { const blob = new Blob([JSON.stringify({version: 2, study: study.exportSnapshot(), asr_review: asrReview.exportSnapshot()}, null, 2)], {type: "application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ielts-vocabulary-progress.json"; link.click(); URL.revokeObjectURL(link.href); };
  const restoreBackup = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === "object" && "study" in parsed) { const backup = parsed as {study: unknown; asr_review?: unknown}; study.restore(backup.study); asrReview.restore(backup.asr_review); } else { study.restore(parsed); } setMessage("Progress and word/sentence review decisions restored."); }).catch(() => setError("Progress backup is not valid JSON.")); };
  const exportAudio = () => { if (!chapter) return; const ids = items.filter(item => study.card(item.item_uuid)?.flagged).map(item => item.stable_id); if (!ids.length) { setMessage("No flagged items in this chapter."); return; } void exportFlaggedAudio(chapter, ids).then(result => { setMessage(`Export ready: ${result.file_name}`); window.open(result.audio_url, "_blank"); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Export failed.")); };
  return <div className="app-shell">
    <div className="content-scroll">
    <header className="topbar"><div className="brand-lockup"><img className="brand-icon" src="/icon.svg" alt="" aria-hidden="true" /><div><span className="eyebrow">IELTS VOCABULARY · SOURCE-AWARE AUDIO</span><h1>{summary?.title || "IELTS Vocabulary"}</h1><p>{summary ? `${summary.items} items · ${summary.book_reference_items} reviewed-book references · ${summary.transcript_review_items} unresolved ASR reviews · ${summary.book_order_review_items} order-only alignments to review` : "Loading corpus…"}</p></div></div><button className="outline" onClick={() => setShowBackup(value => !value)}>Progress</button></header>
    {showBackup ? <section className="backup-panel"><button type="button" onClick={downloadBackup}>Download progress</button><label className="file-button">Restore progress<input type="file" accept="application/json" onChange={restoreBackup} /></label><button type="button" onClick={() => { if (window.confirm("Archive and reset local progress and ASR review decisions?")) { study.reset(); asrReview.reset(); } }}>Reset progress</button></section> : null}
    <nav className="chapter-strip" aria-label="Chapters"><button className={chapter === null ? "active" : ""} onClick={() => setChapter(null)}>All</button>{chapters.map(item => <button key={item.number} className={chapter === item.number ? "active" : ""} onClick={() => setChapter(item.number)}>Ch {item.number}</button>)}</nav>
    <section className="toolbar"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search book word, meaning, collocation, sentence…" /><div className="filters">{(["all", "asr", "order-only", "review", "unmarked", "known", "flagged"] as Filter[]).map(value => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "asr" ? "ASR" : value === "order-only" ? "Order-only" : value[0].toUpperCase() + value.slice(1)}{value === "asr" ? ` ${counts.asr}` : value === "order-only" ? ` ${counts.orderOnly}` : value === "known" ? ` ${counts.known}` : value === "flagged" ? ` ${counts.flagged}` : value === "review" ? ` ${counts.review}` : ""}</button>)}</div><button type="button" onClick={() => setFilter("flagged")} className="export" onDoubleClick={exportAudio}>Export flagged</button></section>
    <main className="study-layout">
      <aside className="item-list" aria-label="Vocabulary items">
        {visibleItems.map(item => {
          const itemCard = study.card(item.item_uuid);
          const itemBookReference = item.book_reference;
          const itemDisplayWord = itemBookReference?.headword || item.headword;
          const itemIsOrderOnly = isOrderOnlyReview(itemBookReference);
          const showAsrWord = Boolean(itemBookReference && !bookWordMatches(item));
          const showAsrSentence = Boolean(itemBookReference && !bookWordMatches(item) && !bookSentenceMatches(itemBookReference));
          return <button type="button" key={item.stable_id} className={selected?.stable_id === item.stable_id ? "item-row active" : "item-row"} onClick={() => { setSelectedId(item.stable_id); setPhase("word"); }}>
            <span>{String(item.position).padStart(3, "0")}</span>
            <strong>{itemDisplayWord}</strong>
            <small>{itemCard?.known ? "✓" : ""}{itemCard?.flagged ? " ⚑" : ""}{itemIsOrderOnly ? " · order-only" : showAsrWord ? ` · ASR: ${item.headword}` : showAsrSentence ? " · sentence ASR" : itemBookReference ? " · book" : isAsrPending(item) ? " · sentence ASR" : isAsrConfirmed(item) ? " · ✓ sentence" : ""}</small>
          </button>;
        })}
      </aside>
      <section className="focus"><FocusCard selected={selected} card={card} asrPending={selectedAsrPending} asrConfirmed={selectedAsrConfirmed} onConfirmSentence={confirmSentenceAsr} onKeepSentence={() => setMessage("Kept the sentence in the ASR review queue.")} onUndoSentence={undoAsr} onToggle={toggle} /></section>
    </main>
    </div>
     <section className="player-dock" aria-label="Fixed playback controls"><div className="player-dock-inner"><AudioPlayer item={selected} phase={phase} mode={mode} runMode={runMode} onEnd={finish} onNext={advanceNext} onPrevious={advancePrevious} onRunModeChange={setRunMode} canNext={canNext} canPrevious={canPrevious} /><div className="player-settings"><label>Content <select value={mode} onChange={event => changeMode(event.target.value as PlaybackMode)}><option value="both">Word + sentence</option><option value="words">Words only</option><option value="sentences">Sentences only</option></select></label><span>{message || (card?.due_at ? `Review due ${new Date(card.due_at).toLocaleDateString()}` : "Playback enrolls this word for review")}</span></div></div></section>
    {error ? <div className="toast error">{error}</div> : null}
  </div>;
}
