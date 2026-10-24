"use client";

import "rrweb/dist/style.css";
import type { Replayer } from "rrweb";
import { AlertTriangle, Globe, Pause, Play, TerminalSquare, Video as VideoIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptSegment } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  activeIndex,
  buildTimeline,
  formatTime,
  isReplayable,
  sanitizeEvents,
  type PageContext,
  type ReplayEvent,
  type TimelineKind,
} from "./timeline";

type Props = {
  sessionId: string;
  startedAt: string;
  eventsUrl: string;
  mediaUrl: string | null;
  transcript: TranscriptSegment[];
  context: PageContext;
};

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "empty" }
  | { state: "ready" };

const SPEEDS = [0.5, 1, 2, 4] as const;
const DEFAULT_VIEWPORT = { width: 1100, height: 800 };

const KIND_META: Record<TimelineKind, { label: string; icon: typeof Globe; tone: string }> = {
  navigation: { label: "Navigation", icon: Globe, tone: "text-sky-700 dark:text-sky-400" },
  "console-error": { label: "Console error", icon: TerminalSquare, tone: "text-destructive" },
  "failed-request": { label: "Failed request", icon: AlertTriangle, tone: "text-amber-700 dark:text-amber-400" },
};

export function SessionPlayback({ sessionId, startedAt, eventsUrl, mediaUrl, transcript, context }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [frameWidth, setFrameWidth] = useState(0);
  const [videoError, setVideoError] = useState(false);

  const replayerRef = useRef<Replayer | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const fixingVideoRef = useRef(false);
  const pendingVideoRef = useRef<number | null>(null);

  // ---- fetch events (browser -> API, dev-only CORS reflected by the endpoint). The page keys this
  // component by session id, so initial state "loading" is the only reset needed. ----
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(eventsUrl, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Events request failed (${res.status})`);
        const clean = sanitizeEvents(await res.json());
        setEvents(clean);
        setLoad(isReplayable(clean) ? { state: "ready" } : { state: "empty" });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : "Could not load replay events" });
      });
    return () => ctrl.abort();
  }, [eventsUrl]);

  // Replay time 0 is the first event; without events fall back to the session start (same browser clock in practice).
  const t0 = events.length > 0 ? Math.min(...events.map((e) => e.timestamp)) : Date.parse(startedAt) || 0;
  const timeline = useMemo(() => buildTimeline(events, context, t0), [events, context, t0]);

  // ---- mount the Replayer once events are ready ----
  useEffect(() => {
    if (load.state !== "ready" || !rootRef.current) return;
    const root = rootRef.current;
    let cancelled = false;
    let raf = 0;
    let replayer: Replayer | null = null;

    (async () => {
      try {
        const { Replayer } = await import("rrweb");
        if (cancelled) return;
        replayer = new Replayer(events as ConstructorParameters<typeof Replayer>[0], {
          root,
          speed: speedRef.current,
          // Masked inputs and blocked elements are already neutralised at record time; never let a replay
          // warning (unknown node, failed style rule) surface as a console error.
          showWarning: false,
          showDebug: false,
          mouseTail: { strokeStyle: "#ef4444" },
          triggerFocus: false,
          liveMode: false,
        });
        replayerRef.current = replayer;
        const meta = replayer.getMetaData();
        setTotalMs(meta.totalTime);
        const first = events.find((e) => e.type === 4);
        const d = first?.data as { width?: number; height?: number } | undefined;
        if (d?.width && d?.height) setViewport({ width: d.width, height: d.height });
        replayer.on("resize", (dim) => {
          const r = dim as { width: number; height: number };
          if (r.width > 0 && r.height > 0) setViewport({ width: r.width, height: r.height });
        });
        replayer.on("finish", () => {
          playingRef.current = false;
          setPlaying(false);
          setCurrentMs(replayer?.getMetaData().totalTime ?? 0);
        });
        replayer.iframe.title = "Replay of the user's page";
        replayer.iframe.tabIndex = -1;
        replayer.pause(0); // render the first snapshot without starting
        setCurrentMs(0);

        let last = -1;
        const tick = () => {
          if (replayer && playingRef.current) {
            const t = Math.round(replayer.getCurrentTime());
            if (Math.floor(t / 100) !== last) {
              last = Math.floor(t / 100);
              setCurrentMs(t);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) setLoad({ state: "error", message: err instanceof Error ? err.message : "Replay failed to start" });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        replayer?.destroy();
      } catch {
        /* already torn down */
      }
      replayerRef.current = null;
      root.replaceChildren();
      playingRef.current = false;
      setPlaying(false);
    };
  }, [load.state, events]);

  // ---- scale the fixed-size replay viewport to the available width ----
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    ro.observe(el);
    setFrameWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [load.state]);
  const scale = frameWidth > 0 ? frameWidth / viewport.width : 1;

  // ---- transport ----
  const syncVideo = useCallback((ms: number, play: boolean | null) => {
    const v = videoRef.current;
    console.log('DBG syncVideo', ms, play, fixingVideoRef.current);
    if (!v) return;
    if (fixingVideoRef.current) {
      // Duration probe in progress: remember the wish, apply it when the probe finishes.
      if (Number.isFinite(ms)) pendingVideoRef.current = ms / 1000;
      if (play === true) void v.play().catch(() => undefined);
      return;
    }
    if (Number.isFinite(ms)) v.currentTime = ms / 1000;
    if (play === true) void v.play().catch(() => undefined);
    if (play === false) v.pause();
  }, []);

  const startAt = useCallback(
    (ms: number) => {
      const r = replayerRef.current;
      if (!r) return;
      r.play(ms);
      playingRef.current = true;
      setPlaying(true);
      setCurrentMs(ms);
      syncVideo(ms, true);
    },
    [syncVideo],
  );

  const pause = useCallback(() => {
    const r = replayerRef.current;
    if (!r) return;
    const t = r.getCurrentTime();
    r.pause();
    playingRef.current = false;
    setPlaying(false);
    setCurrentMs(Math.round(t));
    syncVideo(NaN, false);
  }, [syncVideo]);

  const seek = useCallback(
    (ms: number, opts?: { autoplay?: boolean }) => {
      const target = Math.max(0, ms);
      const r = replayerRef.current;
      if (!r) {
        syncVideo(target, opts?.autoplay ? true : null); // no replay: video-only seek
        return;
      }
      const clamped = Math.min(target, r.getMetaData().totalTime);
      if (playingRef.current || opts?.autoplay) {
        startAt(clamped);
      } else {
        r.pause(clamped);
        setCurrentMs(Math.round(clamped));
        syncVideo(clamped, null);
      }
    },
    [startAt, syncVideo],
  );

  const togglePlay = () => {
    if (playingRef.current) return pause();
    const at = currentMs >= totalMs - 50 ? 0 : currentMs;
    startAt(at);
  };

  const changeSpeed = (s: number) => {
    speedRef.current = s;
    setSpeed(s);
    replayerRef.current?.setConfig({ speed: s });
    if (videoRef.current) videoRef.current.playbackRate = s;
  };

  // ---- recorded video <-> replay sync (the native controls also drive the replay) ----
  const onVideoPlay = () => {
    const v = videoRef.current;
    if (v && replayerRef.current && !playingRef.current) startAt(v.currentTime * 1000);
  };
  const onVideoPause = () => {
    const v = videoRef.current;
    if (v && playingRef.current && !v.ended) pause();
  };
  const onVideoSeeked = () => {
    const v = videoRef.current;
    const r = replayerRef.current;
    if (!v || !r || fixingVideoRef.current) return;
    const ms = v.currentTime * 1000;
    if (Math.abs(ms - r.getCurrentTime()) > 400) {
      if (playingRef.current) r.play(ms);
      else r.pause(ms);
      setCurrentMs(Math.round(ms));
    }
  };
  const fixVideoDuration = useCallback(() => {
    // MediaRecorder WebM has no duration header: force the browser to compute it so seeking works.
    const v = videoRef.current;
    if (!v || v.duration !== Infinity || fixingVideoRef.current) return;
    fixingVideoRef.current = true; // these seeks must not move the replay
    pendingVideoRef.current = null;
    const finish = () => {
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      fixingVideoRef.current = false;
    };
    let target = 0;
    const onSeeked = () => {
      if (Math.abs(v.currentTime - target) < 0.5) finish(); // the restore seek, not the 1e101 probe
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener(
      "durationchange",
      () => {
        target = pendingVideoRef.current ?? 0;
        v.currentTime = target;
      },
      { once: true },
    );
    v.currentTime = 1e101;
    const timer = setTimeout(finish, 3000); // never stay stuck if the browser skips an event
  }, []);
  // The server-rendered <video> may have loaded its metadata before hydration attached onLoadedMetadata.
  useEffect(() => {
    if (videoRef.current && videoRef.current.readyState >= 1) fixVideoDuration();
  }, [fixVideoDuration, mediaUrl]);

  // ---- derived lists ----
  const transcriptOffsets = useMemo(() => transcript.map((t) => t.at), [transcript]);
  const activeLine = activeIndex(transcriptOffsets, currentMs);
  const timelineOffsets = useMemo(() => timeline.map((t) => t.offset), [timeline]);
  const activeEvent = activeIndex(timelineOffsets, currentMs);
  const canSeek = load.state === "ready" || mediaUrl !== null;
  const heightPx = viewport.height * scale;

  return (
    <div className="space-y-6">
      <div className={cn("grid gap-6", mediaUrl ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "")}>
        <Card>
          <CardHeader>
            <CardTitle>Session replay</CardTitle>
            <CardDescription>
              Reconstructed from recorded DOM events. Inputs and private content stay masked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              ref={frameRef}
              className="relative w-full overflow-hidden rounded-md border bg-muted"
              style={{ height: load.state === "ready" ? heightPx : 240 }}
              aria-busy={load.state === "loading"}
            >
              <div
                ref={rootRef}
                className="absolute top-0 left-0 origin-top-left [&_iframe]:pointer-events-none"
                style={{ transform: `scale(${scale})`, width: viewport.width, height: viewport.height }}
                hidden={load.state !== "ready"}
              />
              {load.state !== "ready" && (
                <div
                  className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground"
                  role={load.state === "error" ? "alert" : "status"}
                >
                  {load.state === "loading" && "Loading replay events…"}
                  {load.state === "empty" && "No replay was recorded for this session (fewer than two DOM events or no page snapshot)."}
                  {load.state === "error" && `Replay unavailable: ${load.message}`}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Replay controls">
              <Button
                size="sm"
                onClick={togglePlay}
                disabled={load.state !== "ready"}
                aria-label={playing ? "Pause replay" : "Play replay"}
              >
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
                {playing ? "Pause" : "Play"}
              </Button>
              <span className="font-mono text-xs tabular-nums" aria-hidden>
                {formatTime(currentMs)} / {formatTime(totalMs)}
              </span>
              <input
                type="range"
                className="min-w-32 flex-1 accent-primary disabled:opacity-50"
                min={0}
                max={Math.max(totalMs, 1)}
                step={100}
                value={Math.min(currentMs, Math.max(totalMs, 1))}
                disabled={load.state !== "ready"}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Replay position"
                aria-valuetext={`${formatTime(currentMs)} of ${formatTime(totalMs)}`}
              />
              <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <Button
                    key={s}
                    size="xs"
                    variant={speed === s ? "default" : "outline"}
                    aria-pressed={speed === s}
                    disabled={load.state !== "ready"}
                    onClick={() => changeSpeed(s)}
                  >
                    {s}×
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {mediaUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <VideoIcon className="size-4" aria-hidden /> Screen recording
              </CardTitle>
              <CardDescription>Tab video and microphone audio as captured.</CardDescription>
            </CardHeader>
            <CardContent>
              {videoError ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  The recording could not be loaded.
                </p>
              ) : (
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  className="w-full rounded-md border bg-black"
                  src={mediaUrl}
                  aria-label={`Screen recording of session ${sessionId}`}
                  onLoadedMetadata={fixVideoDuration}
                  onPlay={onVideoPlay}
                  onPause={onVideoPause}
                  onSeeked={onVideoSeeked}
                  onError={() => setVideoError(true)}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {!mediaUrl && (
        <p className="text-sm text-muted-foreground">No screen recording was uploaded for this session.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            <CardDescription>Select a line to jump the replay and recording to that moment.</CardDescription>
          </CardHeader>
          <CardContent>
            {transcript.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcript captured.</p>
            ) : (
              <ol className="max-h-96 space-y-1 overflow-auto" aria-label="Transcript">
                {transcript.map((t, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!canSeek}
                      onClick={() => seek(t.at, { autoplay: true })}
                      aria-current={i === activeLine ? "true" : undefined}
                      aria-label={`${t.role === "agent" ? "Agent" : "User"} at ${formatTime(t.at)}: ${t.text}. Jump to this moment.`}
                      className={cn(
                        "flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent",
                        i === activeLine && "bg-muted",
                      )}
                    >
                      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatTime(t.at)}
                      </span>
                      <span>
                        <strong>{t.role === "agent" ? "Agent" : "User"}</strong> {t.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>Navigations, console errors and failed requests.</CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {load.state === "loading"
                  ? "Loading…"
                  : "No navigations, console errors or failed requests were captured."}
              </p>
            ) : (
              <ol className="max-h-96 space-y-1 overflow-auto" aria-label="Session timeline">
                {timeline.map((item, i) => {
                  const meta = KIND_META[item.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={!canSeek}
                        onClick={() => seek(item.offset, { autoplay: false })}
                        aria-current={i === activeEvent ? "true" : undefined}
                        aria-label={`${meta.label} at ${formatTime(item.offset)}: ${item.title}. Jump to this moment.`}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent",
                          i === activeEvent && "bg-muted",
                        )}
                      >
                        <span className="w-10 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatTime(item.offset)}
                        </span>
                        <Icon className={cn("mt-0.5 size-4 shrink-0", meta.tone)} aria-hidden />
                        <span className="min-w-0">
                          <span className="block break-words">{item.title}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{meta.label}</Badge>
                            {item.detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
