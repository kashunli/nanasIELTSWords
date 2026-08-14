import { useCallback, useEffect, useRef, useState } from "react";

interface PlayRangeOptions {
  start: number;
  end: number;
  offset: number;
  segmentId: string;
}

interface ActiveRange {
  start: number;
  end: number;
  segmentId: string;
}

function clamp(value: number, duration?: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return duration === undefined ? value : Math.min(duration, value);
}

export function useAudioBufferPlayer(
  audioUrl: string,
  onRangeEnd: (segmentId: string) => void,
) {
  const requestedUrlRef = useRef(audioUrl);
  requestedUrlRef.current = audioUrl;
  const contextRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const loadedUrlRef = useRef("");
  const decodePromiseRef = useRef<Promise<AudioBuffer> | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeRangeRef = useRef<ActiveRange | null>(null);
  const currentTimeRef = useRef(0);
  const anchorAudioTimeRef = useRef(0);
  const anchorContextTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const requestNumberRef = useRef(0);
  const onRangeEndRef = useRef(onRangeEnd);
  onRangeEndRef.current = onRangeEnd;

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [loadedAudioUrl, setLoadedAudioUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const publishCurrentTime = useCallback((value: number) => {
    currentTimeRef.current = value;
    setCurrentTime(value);
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const detachSource = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // An already-ended source is harmless and cannot be stopped twice.
    }
    source.disconnect();
  }, []);

  const exactCurrentTime = useCallback(() => {
    const context = contextRef.current;
    const range = activeRangeRef.current;
    if (!context || !range || !isPlayingRef.current) return currentTimeRef.current;
    return Math.min(
      range.end,
      anchorAudioTimeRef.current + Math.max(0, context.currentTime - anchorContextTimeRef.current),
    );
  }, []);

  const animate = useCallback(() => {
    cancelAnimation();
    const update = () => {
      if (!isPlayingRef.current) {
        animationFrameRef.current = null;
        return;
      }
      publishCurrentTime(exactCurrentTime());
      animationFrameRef.current = requestAnimationFrame(update);
    };
    animationFrameRef.current = requestAnimationFrame(update);
  }, [cancelAnimation, exactCurrentTime, publishCurrentTime]);

  useEffect(() => {
    requestNumberRef.current += 1;
    cancelAnimation();
    detachSource();
    isPlayingRef.current = false;
    activeRangeRef.current = null;
    bufferRef.current = null;
    loadedUrlRef.current = "";
    decodePromiseRef.current = null;
    publishCurrentTime(0);
    setAudioBuffer(null);
    setLoadedAudioUrl("");
    setIsPlaying(false);
    setLoadFailed(false);

    if (!audioUrl) return undefined;

    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      setLoadFailed(true);
      return undefined;
    }
    const controller = new AbortController();
    contextRef.current = context;
    const decodePromise = (async () => {
      const response = await fetch(audioUrl, {signal: controller.signal});
      if (!response.ok) throw new Error("audio request failed");
      const encodedAudio = await response.arrayBuffer();
      const decodedAudio = await context.decodeAudioData(encodedAudio);
      if (controller.signal.aborted || requestedUrlRef.current !== audioUrl) {
        throw new DOMException("Audio load was superseded", "AbortError");
      }
      bufferRef.current = decodedAudio;
      loadedUrlRef.current = audioUrl;
      setAudioBuffer(decodedAudio);
      setLoadedAudioUrl(audioUrl);
      return decodedAudio;
    })();
    decodePromiseRef.current = decodePromise;
    void decodePromise.catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setLoadFailed(true);
    });

    return () => {
      controller.abort();
      requestNumberRef.current += 1;
      cancelAnimation();
      detachSource();
      if (contextRef.current === context) contextRef.current = null;
      void context.close().catch(() => {});
    };
  }, [audioUrl, cancelAnimation, detachSource, publishCurrentTime]);

  const playRange = useCallback(async ({start, end, offset, segmentId}: PlayRangeOptions) => {
    const requestNumber = ++requestNumberRef.current;
    const expectedUrl = requestedUrlRef.current;
    let buffer = bufferRef.current;
    if (!buffer || loadedUrlRef.current !== expectedUrl) {
      const pendingDecode = decodePromiseRef.current;
      if (!pendingDecode) throw new Error("audio is not ready");
      buffer = await pendingDecode;
    }
    const context = contextRef.current;
    if (!context || expectedUrl !== requestedUrlRef.current || requestNumber !== requestNumberRef.current) return;

    await context.resume();
    if (expectedUrl !== requestedUrlRef.current || requestNumber !== requestNumberRef.current) return;

    const safeStart = Math.min(buffer.duration, Math.max(0, start));
    const safeEnd = Math.min(buffer.duration, Math.max(safeStart, end));
    const safeOffset = Math.min(safeEnd, Math.max(safeStart, offset));
    cancelAnimation();
    detachSource();
    if (safeEnd - safeOffset <= 0.001) {
      activeRangeRef.current = null;
      publishCurrentTime(safeEnd);
      isPlayingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    sourceRef.current = source;
    activeRangeRef.current = {start: safeStart, end: safeEnd, segmentId};
    anchorAudioTimeRef.current = safeOffset;
    anchorContextTimeRef.current = context.currentTime;
    publishCurrentTime(safeOffset);
    isPlayingRef.current = true;
    setIsPlaying(true);

    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      source.disconnect();
      cancelAnimation();
      isPlayingRef.current = false;
      setIsPlaying(false);
      publishCurrentTime(safeEnd);
      onRangeEndRef.current(segmentId);
    };

    // The same decoded PCM drives both playback and the visible wavebar.
    source.start(0, safeOffset, safeEnd - safeOffset);
    animate();
  }, [animate, cancelAnimation, detachSource, publishCurrentTime]);

  const pause = useCallback(() => {
    requestNumberRef.current += 1;
    const position = exactCurrentTime();
    cancelAnimation();
    detachSource();
    isPlayingRef.current = false;
    setIsPlaying(false);
    publishCurrentTime(position);
  }, [cancelAnimation, detachSource, exactCurrentTime, publishCurrentTime]);

  const setPosition = useCallback((value: number) => {
    requestNumberRef.current += 1;
    cancelAnimation();
    detachSource();
    activeRangeRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    publishCurrentTime(clamp(value, bufferRef.current?.duration));
  }, [cancelAnimation, detachSource, publishCurrentTime]);

  const seek = useCallback((value: number) => {
    const range = activeRangeRef.current;
    const nextTime = range
      ? Math.min(range.end, Math.max(range.start, value))
      : clamp(value, bufferRef.current?.duration);
    if (isPlayingRef.current && range) return playRange({...range, offset: nextTime});
    publishCurrentTime(nextTime);
    return Promise.resolve();
  }, [playRange, publishCurrentTime]);

  return {
    audioBuffer,
    loadedAudioUrl,
    currentTime,
    isPlaying,
    loadFailed,
    pause,
    playRange,
    seek,
    setPosition,
  };
}
