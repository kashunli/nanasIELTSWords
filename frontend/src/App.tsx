import { useEffect, useMemo, useRef, useState } from "react";
import { exportFlaggedAudio, getChapters, getItems, getSummary } from "./api";
import type { Chapter, Item, Summary } from "./types";
import { LocalStudyState } from "./features/study/localStudyState";
import { LineWaveform } from "./features/player/LineWaveform";
import { nextPlaybackStep } from "./features/player/playbackSequence.mjs";
import { detectSilenceGapsMs } from "./features/player/waveform.mjs";
import { useAudioBufferPlayer } from "./features/player/useAudioBufferPlayer";

type Filter = "all" | "review" | "unmarked" | "known" | "flagged";
type Phase = "word" | "sentence";
type PlaybackMode = "words" | "sentences" | "both";
type RunMode = "single" | "consecutive";

function AudioPlayer({item, phase, mode, runMode, onEnd, onNext, onPhaseChange, onRunModeChange, canNext}: {item?: Item; phase: Phase; mode: PlaybackMode; runMode: RunMode; onEnd: () => boolean; onNext: () => boolean; onPhaseChange: (phase: Phase) => void; onRunModeChange: (mode: RunMode) => void; canNext: boolean}) {
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

  if (!item) return <section className="player empty-player">Select an item to begin listening.</section>;

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
  return <section className="player" aria-label="Audio player">
    <div className="player-heading"><span>{phase === "word" ? "WORD" : "EXAMPLE SENTENCE"}</span><strong>{item.headword}</strong><small>{item.position} · Chapter {item.chapter}</small></div>
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
    <div className="player-controls">
      <span className="audio-time" aria-label="Playback time">{progressLabel}</span>
      <button type="button" onClick={replay} disabled={!player.audioBuffer}>Replay</button>
      <button type="button" className="primary" onClick={toggle} disabled={!player.audioBuffer}>{player.isPlaying ? "Pause" : "Play"}</button>
      <button type="button" onClick={advanceManually} disabled={!canNext}>Next</button>
      <button type="button" onClick={stop} disabled={!player.audioBuffer}>Stop</button>
      <button type="button" className={runMode === "consecutive" ? "selected" : ""} onClick={toggleRunMode} aria-pressed={runMode === "consecutive"}>{runMode === "single" ? "Single" : "Consecutive"}</button>
      <span>{playerError || `${phase} · ${runMode === "single" ? "single clip" : "play through list"} · ${mode}`}</span>
    </div>
    <div className="player-phases"><button className={phase === "word" ? "active" : ""} onClick={() => onPhaseChange("word")}>Word</button><button className={phase === "sentence" ? "active" : ""} onClick={() => onPhaseChange("sentence")} disabled={!item.sentence_audio_url}>Sentence</button></div>
  </section>;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export default function App() {
  const store = useRef<LocalStudyState | null>(null);
  if (!store.current) store.current = new LocalStudyState();
  const study = store.current;
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
  useEffect(() => study.subscribe(() => setStateVersion(value => value + 1)), [study]);
  useEffect(() => { void Promise.all([getSummary(), getChapters()]).then(([nextSummary, nextChapters]) => { setSummary(nextSummary); setChapters(nextChapters); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load corpus.")); }, []);
  useEffect(() => { void getItems(chapter, search).then(nextItems => { setItems(nextItems); setSelectedId(current => current && nextItems.some(item => item.stable_id === current) ? current : nextItems[0]?.stable_id); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Could not load items.")); }, [chapter, search]);
  const visibleItems = useMemo(() => items.filter(item => { const card = study.card(item.item_uuid); if (filter === "known") return card?.known; if (filter === "flagged") return card?.flagged; if (filter === "unmarked") return !card?.known && !card?.flagged; if (filter === "review") return Boolean(card?.due_at && Date.parse(card.due_at) <= Date.now()); return true; }), [items, filter, stateVersion, study]);
  const selected = visibleItems.find(item => item.stable_id === selectedId) || visibleItems[0];
  const counts = useMemo(() => ({known: items.filter(item => study.card(item.item_uuid)?.known).length, flagged: items.filter(item => study.card(item.item_uuid)?.flagged).length, review: items.filter(item => { const due = study.card(item.item_uuid)?.due_at; return due && Date.parse(due) <= Date.now(); }).length}), [items, stateVersion, study]);
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
  const changeMode = (nextMode: PlaybackMode) => { setMode(nextMode); setPhase(nextMode === "sentences" ? "sentence" : "word"); };
  const canNext = Boolean(selected && (mode === "both" && phase === "word" && selected.sentence_audio_url || selectedIndex >= 0 && selectedIndex < visibleItems.length - 1));
  const card = selected ? study.card(selected.item_uuid) : undefined;
  const toggle = (key: "known" | "flagged" | "sentence_starred") => { if (selected) study.update(selected.item_uuid, {[key]: !card?.[key]}); };
  const downloadBackup = () => { const blob = new Blob([JSON.stringify(study.exportSnapshot(), null, 2)], {type: "application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ielts-vocabulary-progress.json"; link.click(); URL.revokeObjectURL(link.href); };
  const restoreBackup = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { study.restore(JSON.parse(text)); setMessage("Progress restored."); }).catch(() => setError("Progress backup is not valid JSON.")); };
  const exportAudio = () => { if (!chapter) return; const ids = items.filter(item => study.card(item.item_uuid)?.flagged).map(item => item.stable_id); if (!ids.length) { setMessage("No flagged items in this chapter."); return; } void exportFlaggedAudio(chapter, ids).then(result => { setMessage(`Export ready: ${result.file_name}`); window.open(result.audio_url, "_blank"); }).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "Export failed.")); };
  return <div className="app-shell">
    <header className="topbar"><div><span className="eyebrow">IELTS VOCABULARY · AUDIO-FIRST</span><h1>{summary?.title || "IELTS Vocabulary"}</h1><p>{summary ? `${summary.items} items · ${summary.chapters} chapters · ${summary.transcript_review_items} transcript reviews` : "Loading corpus…"}</p></div><button className="outline" onClick={() => setShowBackup(value => !value)}>Progress</button></header>
    {showBackup ? <section className="backup-panel"><button onClick={downloadBackup}>Download progress</button><label className="file-button">Restore progress<input type="file" accept="application/json" onChange={restoreBackup} /></label><button onClick={() => { if (window.confirm("Archive and reset local progress?")) study.reset(); }}>Reset progress</button></section> : null}
    <nav className="chapter-strip" aria-label="Chapters"><button className={chapter === null ? "active" : ""} onClick={() => setChapter(null)}>All</button>{chapters.map(item => <button key={item.number} className={chapter === item.number ? "active" : ""} onClick={() => setChapter(item.number)}>Ch {item.number}</button>)}</nav>
    <section className="toolbar"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search headword, meaning, sentence…" /><div className="filters">{(["all", "review", "unmarked", "known", "flagged"] as Filter[]).map(value => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}{value === "known" ? ` ${counts.known}` : value === "flagged" ? ` ${counts.flagged}` : value === "review" ? ` ${counts.review}` : ""}</button>)}</div><button onClick={() => setFilter("flagged")} className="export" onDoubleClick={exportAudio}>Export flagged</button></section>
    <main className="study-layout"><aside className="item-list" aria-label="Vocabulary items">{visibleItems.map(item => { const itemCard = study.card(item.item_uuid); return <button key={item.stable_id} className={selected?.stable_id === item.stable_id ? "item-row active" : "item-row"} onClick={() => { setSelectedId(item.stable_id); setPhase("word"); }}><span>{String(item.position).padStart(3, "0")}</span><strong>{item.headword}</strong><small>{itemCard?.known ? "✓" : ""}{itemCard?.flagged ? " ⚑" : ""}{item.transcript_status === "needs_review" ? " · ASR" : ""}</small></button>})}</aside><section className="focus"><div className="focus-card">{selected ? <><div className="focus-meta">Chapter {selected.chapter} · #{selected.position} {selected.transcript_status === "needs_review" ? <span className="warning">ASR review needed</span> : null}</div><h2>{selected.headword}</h2><p className="pos">{selected.part_of_speech || "word"}</p><div className="meanings"><p>{selected.meaning_en || "Meaning pending"}</p><p>{selected.meaning_zh || "释义待生成"}</p><small>{selected.meaning_status === "ai_draft" ? "AI draft meaning" : "Reviewed meaning"}</small></div><div className="sentence"><span>EXAMPLE</span><p>{selected.sentence}</p></div><div className="card-actions"><button className={card?.known ? "selected" : ""} onClick={() => toggle("known")}>✓ Known</button><button className={card?.flagged ? "selected" : ""} onClick={() => toggle("flagged")}>⚑ Flagged</button><button className={card?.sentence_starred ? "selected" : ""} onClick={() => toggle("sentence_starred")}>★ Sentence</button></div></> : <p>Select an item from the list.</p>}</div><AudioPlayer item={selected} phase={phase} mode={mode} runMode={runMode} onEnd={finish} onNext={advanceNext} onPhaseChange={setPhase} onRunModeChange={setRunMode} canNext={canNext} /><div className="player-settings"><label>Content <select value={mode} onChange={event => changeMode(event.target.value as PlaybackMode)}><option value="both">Word + sentence</option><option value="words">Words only</option><option value="sentences">Sentences only</option></select></label><span>{message || (card?.due_at ? `Review due ${new Date(card.due_at).toLocaleDateString()}` : "Playback enrolls this word for review")}</span></div></section></main>
    {error ? <div className="toast error">{error}</div> : null}
  </div>;
}
