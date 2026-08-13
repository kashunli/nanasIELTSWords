import { useEffect, useMemo, useRef, useState } from "react";
import { exportFlaggedAudio, getChapters, getItems, getSummary } from "./api";
import type { Chapter, Item, Summary } from "./types";
import { LocalStudyState } from "./features/study/localStudyState";

type Filter = "all" | "review" | "unmarked" | "known" | "flagged";
type Phase = "word" | "sentence";
type PlaybackMode = "words" | "sentences" | "both";
type RunMode = "single" | "consecutive";

function AudioPlayer({item, phase, mode, runMode, onEnd, onPhaseChange}: {item?: Item; phase: Phase; mode: PlaybackMode; runMode: RunMode; onEnd: () => void; onPhaseChange: (phase: Phase) => void}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const url = item ? phase === "word" ? item.word_audio_url : item.sentence_audio_url : "";
  useEffect(() => { setPlaying(false); setCurrent(0); if (audio.current) { audio.current.pause(); audio.current.currentTime = 0; audio.current.src = url; audio.current.load(); } }, [url]);
  if (!item) return <section className="player empty-player">Select an item to begin listening.</section>;
  const toggle = () => { if (!audio.current) return; if (audio.current.paused) { void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); } else { audio.current.pause(); setPlaying(false); } };
  return <section className="player" aria-label="Audio player">
    <audio ref={audio} onTimeUpdate={() => setCurrent(audio.current?.currentTime || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); onEnd(); }} />
    <div className="player-heading"><span>{phase === "word" ? "WORD" : "EXAMPLE SENTENCE"}</span><strong>{item.headword}</strong><small>{item.position} · Chapter {item.chapter}</small></div>
    <input className="timeline" type="range" min="0" max={audio.current?.duration || 0.01} step="0.01" value={Math.min(current, audio.current?.duration || 0.01)} onChange={event => { const value = Number(event.target.value); if (audio.current) audio.current.currentTime = value; setCurrent(value); }} aria-label="Seek audio" />
    <div className="player-controls"><button type="button" onClick={() => { if (audio.current) audio.current.currentTime = 0; toggle(); }}>Replay</button><button type="button" className="primary" onClick={toggle}>{playing ? "Pause" : "Play"}</button><button type="button" onClick={onEnd}>Next</button><span>{phase} · {runMode === "single" ? "single" : "consecutive"} · {mode}</span></div>
    <div className="player-phases"><button className={phase === "word" ? "active" : ""} onClick={() => onPhaseChange("word")}>Word</button><button className={phase === "sentence" ? "active" : ""} onClick={() => onPhaseChange("sentence")}>Sentence</button></div>
  </section>;
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
  const finish = () => {
    if (!selected) return;
    if (mode === "both" && phase === "word") { setPhase("sentence"); return; }
    study.recordPlayed(selected);
    if (runMode === "consecutive") {
      const index = visibleItems.findIndex(item => item.stable_id === selected.stable_id);
      const next = visibleItems[index + 1]; if (next) { setSelectedId(next.stable_id); setPhase(mode === "sentences" ? "sentence" : "word"); }
    }
  };
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
    <main className="study-layout"><aside className="item-list" aria-label="Vocabulary items">{visibleItems.map(item => { const itemCard = study.card(item.item_uuid); return <button key={item.stable_id} className={selected?.stable_id === item.stable_id ? "item-row active" : "item-row"} onClick={() => { setSelectedId(item.stable_id); setPhase("word"); }}><span>{String(item.position).padStart(3, "0")}</span><strong>{item.headword}</strong><small>{itemCard?.known ? "✓" : ""}{itemCard?.flagged ? " ⚑" : ""}{item.transcript_status === "needs_review" ? " · ASR" : ""}</small></button>})}</aside><section className="focus"><div className="focus-card">{selected ? <><div className="focus-meta">Chapter {selected.chapter} · #{selected.position} {selected.transcript_status === "needs_review" ? <span className="warning">ASR review needed</span> : null}</div><h2>{selected.headword}</h2><p className="pos">{selected.part_of_speech || "word"}</p><div className="meanings"><p>{selected.meaning_en || "Meaning pending"}</p><p>{selected.meaning_zh || "释义待生成"}</p><small>{selected.meaning_status === "ai_draft" ? "AI draft meaning" : "Reviewed meaning"}</small></div><div className="sentence"><span>EXAMPLE</span><p>{selected.sentence}</p></div><div className="card-actions"><button className={card?.known ? "selected" : ""} onClick={() => toggle("known")}>✓ Known</button><button className={card?.flagged ? "selected" : ""} onClick={() => toggle("flagged")}>⚑ Flagged</button><button className={card?.sentence_starred ? "selected" : ""} onClick={() => toggle("sentence_starred")}>★ Sentence</button></div></> : <p>Select an item from the list.</p>}</div><AudioPlayer item={selected} phase={phase} mode={mode} runMode={runMode} onEnd={finish} onPhaseChange={setPhase} /><div className="player-settings"><label>Content <select value={mode} onChange={event => setMode(event.target.value as PlaybackMode)}><option value="both">Word + sentence</option><option value="words">Words only</option><option value="sentences">Sentences only</option></select></label><button className={runMode === "consecutive" ? "selected" : ""} onClick={() => setRunMode(value => value === "single" ? "consecutive" : "single")}>{runMode === "single" ? "Single" : "Consecutive"}</button><span>{message || (card?.due_at ? `Review due ${new Date(card.due_at).toLocaleDateString()}` : "Playback enrolls this word for review")}</span></div></section></main>
    {error ? <div className="toast error">{error}</div> : null}
  </div>;
}
