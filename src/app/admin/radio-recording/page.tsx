"use client";

// ADMIN-ONLY: Radio Recording — captures the eBilikAgama Radio audio pipeline
// (radio tracks + azan interruptions) from the player's <audio> element via
// Web Audio tap + MediaRecorder, uploads to the configured Drive folder via
// the admin-only chunked API, and archives with azan markers.
//
// Protection is server-side at two layers: the proxy gates /admin/* pages to
// admin/owner roles, and every /api/radio-recording/* route re-verifies the
// session. This page also embeds the VirtualRadioPlayer in "capture mode" —
// its audio element is the ONE source the recorder taps (Web Audio
// MediaElementSource cannot see mic, tab, or system audio).

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/i18n";
import VirtualRadioPlayer from "@/components/VirtualRadioPlayer";
import {
  RecorderEngine,
  recordingFileName,
  requestWakeLock,
  uniquifyFileName,
  type RecordedAzanEvent,
  type ServerClockSample,
} from "@/lib/recorder-engine";

type RecordingMetaDto = {
  id: string;
  driveFileId: string | null;
  fileName: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  status: "recording" | "finalizing" | "uploading" | "archived" | "failed";
  uploadedBytes: number | null;
  totalBytes: number | null;
  azanEvents: { prayer: string; offsetSeconds: number; actualStartAt: number }[];
  createdBy: string;
  createdAt: string;
  error: string | null;
};

type RecStateDto = {
  active: RecordingMetaDto | null;
  archive: RecordingMetaDto[];
  folderId: string | null;
  folderName: string | null;
};

const PRAYERS = ["subuh", "zohor", "asar", "maghrib", "isyak"] as const;

function fmtHMS(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function fmtDateTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { hour12: false });
}

export default function RadioRecordingPage() {
  const { t, language, locale: ctxLocale } = useLanguage();
  const locale = ctxLocale || "en-MY";

  const [state, setState] = useState<RecStateDto>({ active: null, archive: [], folderId: null, folderName: null });
  const [engineReady, setEngineReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentAzan, setCurrentAzan] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<RecordedAzanEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const engineRef = useRef<RecorderEngine | null>(null);
  const sampleRef = useRef<ServerClockSample | null>(null);
  const wakeReleaseRef = useRef<(() => void) | null>(null);
  const stopGuardRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  // ── Session snapshot polling ──────────────────────────────────────
  const loadState = useCallback(async () => {
    const res = await fetch("/api/radio-recording", { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }, []);

  useEffect(() => {
    loadState();
    const id = setInterval(loadState, 15_000);
    return () => clearInterval(id);
  }, [loadState]);

  // ── Server clock sample refresh (10s cadence, shared reference) ───
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const sent = Date.now();
        const res = await fetch("/api/virtual-radio/time", { cache: "no-store" });
        const received = Date.now();
        if (!res.ok || !alive) return;
        const data = await res.json();
        sampleRef.current = {
          serverTime: data.serverTime,
          localAt: received,
          rttMs: received - sent,
        };
      } catch {
        /* keep last sample */
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ── Attach the recorder to the embedded player's audio element ────
  // VirtualRadioPlayer renders <audio data-virtual-radio>; wait for it to
  // mount (after radio state loads), then tap it ONCE. MediaElementSource
  // captures only this element: radio music + azan, nothing else.
  useEffect(() => {
    let cancelled = false;
    const wire = async () => {
      const audio = document.querySelector<HTMLAudioElement>("audio[data-virtual-radio]");
      if (!audio) {
        setTimeout(() => {
          if (!cancelled) void wire();
        }, 800);
        return;
      }
      if (engineRef.current?.attached) {
        setEngineReady(true);
        return;
      }
      engineRef.current = engineRef.current ?? new RecorderEngine();
      try {
        await engineRef.current.attach(audio);
        if (!cancelled) setEngineReady(true);
      } catch (err) {
        console.error("[REC] attach failed:", err);
        if (!cancelled) {
          setBanner({ kind: "err", text: err instanceof Error ? err.message : String(err) });
        }
      }
    };
    void wire();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Elapsed ticker ─────────────────────────────────────────────────
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(engineRef.current?.elapsedSeconds() ?? 0), 500);
    return () => clearInterval(id);
  }, [recording]);

  // ── Warn before closing the tab mid-recording ──────────────────────
  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

  // ── Heartbeat: keep the server session fresh + push azan markers ──
  const pushHeartbeat = useCallback(
    async (azanEvent?: RecordedAzanEvent) => {
      const id = sessionIdRef.current;
      const engine = engineRef.current;
      if (!id || !engine?.running) return;
      try {
        const res = await fetch("/api/radio-recording", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "heartbeat",
            id,
            elapsedSeconds: engine.elapsedSeconds(),
            ...(azanEvent ? { azanEvent } : {}),
          }),
        });
        if (res.status === 409) {
          // Session invalidated server-side (another admin aborted it) → stop.
          engine.abort();
          setRecording(false);
          setBanner({ kind: "err", text: t("rec_stopped_remotely") });
        }
      } catch {
        /* transient network error; next heartbeat retries */
      }
    },
    [t]
  );

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => void pushHeartbeat(), 30_000);
    return () => clearInterval(id);
  }, [recording, pushHeartbeat]);

  // ── Azan start hook (player calls this the instant azan plays) ────
  const handleAzanStart = useCallback(
    (info: { prayer: string }) => {
      const engine = engineRef.current;
      if (!engine?.running) return;
      const ev = engine.markAzan(info.prayer, sampleRef.current);
      if (ev) {
        setLiveEvents(engine.events);
        setCurrentAzan(info.prayer);
        void pushHeartbeat(ev);
        setTimeout(() => setCurrentAzan((c) => (c === info.prayer ? null : c)), 60_000);
      }
    },
    [pushHeartbeat]
  );

  // ── START ──────────────────────────────────────────────────────────
  const handleStart = async () => {
    const engine = engineRef.current;
    if (!engine?.attached || busy || recording) return;
    setBusy(true);
    setBanner(null);
    try {
      // Fresh sample for an accurate t=0.
      const sent = Date.now();
      const res = await fetch("/api/virtual-radio/time", { cache: "no-store" });
      const received = Date.now();
      if (!res.ok) throw new Error(t("rec_no_server_time"));
      const data = await res.json();
      const sample: ServerClockSample = {
        serverTime: data.serverTime,
        localAt: received,
        rttMs: received - sent,
      };

      const startedAtServer = engine.start(sample);
      const id = crypto.randomUUID();
      const fileName = uniquifyFileName(
        recordingFileName(startedAtServer),
        state.archive.map((r) => r.fileName)
      );

      const startRes = await fetch("/api/radio-recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", id, fileName, startedAt: startedAtServer }),
      });
      if (!startRes.ok) {
        engine.abort();
        const d = await startRes.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${startRes.status}`);
      }
      sessionIdRef.current = id;
      setRecording(true);
      setElapsed(0);
      setLiveEvents([]);
      setUploadPct(null);
      wakeReleaseRef.current = await requestWakeLock();
      await loadState();
      setBanner({ kind: "ok", text: t("rec_started") });
    } catch (err) {
      engineRef.current?.abort();
      setBanner({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  // ── STOP → finalize → chunked upload → archive ────────────────────
  const handleStop = async () => {
    const engine = engineRef.current;
    const id = sessionIdRef.current;
    if (!engine?.running || !id || busy || stopGuardRef.current) return;
    stopGuardRef.current = true;
    setBusy(true);
    setUploadPct(0);
    try {
      const { blob, durationSeconds } = await engine.stop();
      const startedAtServer = engine.startedAtServer ?? Date.now() - durationSeconds * 1000;
      const endedAtServer = startedAtServer + durationSeconds * 1000;

      // 1. Stop the server session (finalizing).
      const stopRes = await fetch("/api/radio-recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          id,
          endedAt: Math.round(endedAtServer),
          durationSeconds: Math.round(durationSeconds),
        }),
      });
      if (!stopRes.ok) {
        const d = await stopRes.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${stopRes.status}`);
      }

      // 2. Chunked upload to Drive.
      await uploadToDrive(id, blob);

      setRecording(false);
      sessionIdRef.current = null;
      setUploadPct(100);
      await loadState();
      setBanner({ kind: "ok", text: t("rec_archived") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBanner({ kind: "err", text: `${t("rec_upload_failed")}: ${msg}` });
      await fetch("/api/radio-recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fail", id, error: msg }),
      }).catch(() => {});
      setRecording(false);
      sessionIdRef.current = null;
    } finally {
      stopGuardRef.current = false;
      setBusy(false);
      wakeReleaseRef.current?.();
      wakeReleaseRef.current = null;
    }
  };

  // ── Chunked upload via the admin-only proxy API ────────────────────
  const uploadToDrive = async (id: string, blob: Blob) => {
    const totalBytes = blob.size;
    const fileName =
      state.active?.fileName ?? recordingFileName(engineRef.current?.startedAtServer ?? Date.now());

    const initRes = await fetch("/api/radio-recording/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "init", id, fileName, totalBytes }),
    });
    if (!initRes.ok) {
      const d = await initRes.json().catch(() => ({}));
      throw new Error(d.error ?? `init HTTP ${initRes.status}`);
    }

    const chunkSize = 4 * 1024 * 1024;
    let offset = 0;
    let seq = 0;
    while (offset < totalBytes) {
      const end = Math.min(offset + chunkSize, totalBytes);
      const isFinal = end >= totalBytes;
      const form = new FormData();
      form.append("id", id);
      form.append("chunkStart", String(offset));
      form.append("totalBytes", String(totalBytes));
      form.append("isFinal", String(isFinal));
      form.append("file", blob.slice(offset, end), `chunk_${seq}`);

      const res = await fetch("/api/radio-recording/upload", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.sessionExpired) {
          // Server instance recycled: re-open and retry the SAME chunk
          // (Drive's resumable protocol resumes from the last acked byte —
          // our offset may be ahead; re-sync via status first).
          try {
            const st = await fetch("/api/radio-recording/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "status", id }),
            });
            if (st.ok) {
              const s = await st.json();
              offset = Math.min(s.uploadedBytes ?? 0, totalBytes);
            }
          } catch {
            /* fall through to re-init */
          }
          await fetch("/api/radio-recording/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "init", id, fileName, totalBytes }),
          });
          continue; // retry from the re-synced offset
        }
        throw new Error(d.error ?? `chunk HTTP ${res.status}`);
      }
      const data = await res.json();
      setUploadPct(Math.min(100, Math.round(((data.uploadedBytes ?? end) / totalBytes) * 100)));
      offset = end;
      seq++;
    }
    // The final chunk archives server-side; nothing more to do here.
  };

  // ── Archive helpers ────────────────────────────────────────────────
  const handleAbortStuck = async (id: string) => {
    await fetch("/api/radio-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", id, error: "abandoned by admin" }),
    });
    await loadState();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("rec_delete_confirm"))) return;
    await fetch("/api/radio-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    await loadState();
  };

  // ── Archive player + jump-to-azan ──────────────────────────────────
  const [player, setPlayer] = useState<RecordingMetaDto | null>(null);
  const playerAudioRef = useRef<HTMLAudioElement | null>(null);

  const jumpToAzan = (offsetSeconds: number) => {
    const audio = playerAudioRef.current;
    if (!audio) return;
    audio.currentTime = offsetSeconds;
    void audio.play().catch(() => {});
  };

  const active = state.active;
  const showRecording = recording && !!active;
  const uploadProgressPct =
    active && active.totalBytes && active.uploadedBytes != null
      ? Math.min(100, Math.round((active.uploadedBytes / active.totalBytes) * 100))
      : null;

  return (
    <div className="space-y-6">
      {/* Capture source — the embedded virtual radio (its audio is tapped) */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white mb-2">{t("rec_source_title")}</h2>
        <p className="text-gray-400 text-sm mb-4">{t("rec_source_note")}</p>
        <div className="max-w-2xl">
          <VirtualRadioPlayer onAzanStart={handleAzanStart} />
        </div>
      </div>

      {/* Controls + live status */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white mb-4">{t("rec_title")}</h2>

        <div className="grid sm:grid-cols-2 gap-4 text-sm mb-5">
          <div>
            <p className="text-gray-400">{t("rec_destination")}</p>
            <p className="text-white font-medium">
              {state.folderName || "Google Drive / eBilikAgama Radio Recordings"}
            </p>
          </div>
          <div>
            <p className="text-gray-400">{t("rec_status")}</p>
            <p className={showRecording ? "text-red-400 font-bold animate-pulse" : "text-gray-300 font-bold"}>
              {showRecording ? `● ${t("rec_on_air")}` : `○ ${t("rec_idle")}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleStart}
            disabled={!engineReady || busy || showRecording}
            className="px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold"
          >
            ● {t("rec_start")}
          </button>
          <button
            onClick={handleStop}
            disabled={!showRecording || busy}
            className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold"
          >
            ■ {t("rec_stop")}
          </button>
          {active && ["finalizing", "uploading"].includes(active.status) && !recording && (
            <button
              onClick={() => handleAbortStuck(active.id)}
              className="px-5 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-semibold"
            >
              {t("rec_clear_stuck")}
            </button>
          )}
        </div>

        {!engineReady && (
          <p className="text-yellow-400 text-sm mt-3">{t("rec_engine_note")}</p>
        )}
        {busy && uploadPct != null && (
          <div className="mt-4">
            <p className="text-gray-300 text-sm mb-1">
              {t("rec_upload_progress")}: {uploadPct}%
            </p>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${uploadPct}%` }} />
            </div>
          </div>
        )}
        {uploadProgressPct != null && active?.status === "uploading" && (
          <div className="mt-4">
            <p className="text-gray-300 text-sm mb-1">
              {t("rec_upload_progress")}: {uploadProgressPct}% ({fmtBytes(active.uploadedBytes)} / {fmtBytes(active.totalBytes)})
            </p>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgressPct}%` }} />
            </div>
          </div>
        )}

        {banner && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              banner.kind === "ok"
                ? "bg-green-900/40 text-green-300"
                : banner.kind === "err"
                ? "bg-red-900/40 text-red-300"
                : "bg-blue-900/40 text-blue-300"
            }`}
          >
            {banner.text}
          </div>
        )}
      </div>

      {/* Live session stats */}
      {showRecording && active && (
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">{t("rec_live")}</h3>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-gray-400">{t("rec_started")}</dt>
              <dd className="text-white">{fmtDateTime(active.startedAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-gray-400">{t("rec_duration")}</dt>
              <dd className="text-white font-mono">{fmtHMS(elapsed)}</dd>
            </div>
            <div>
              <dt className="text-gray-400">{t("rec_current_azan")}</dt>
              <dd className="text-white">{currentAzan ? t(`prayer_${currentAzan}` as TranslationKey) : t("rec_none")}</dd>
            </div>
          </dl>
          <p className="text-gray-500 text-xs mt-3">{t("rec_session_note")}</p>
        </div>
      )}

      {/* Live azan list */}
      {liveEvents.length > 0 && (
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-3">{t("rec_azan_events")}</h3>
          <ol className="space-y-2 text-sm">
            {liveEvents.map((e, i) => (
              <li key={`${e.prayer}-${e.offsetSeconds}`} className="flex justify-between text-gray-300">
                <span>
                  {i + 1}. {t(`prayer_${e.prayer}` as TranslationKey)}
                </span>
                <span className="font-mono">{fmtHMS(e.offsetSeconds)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Archive */}
      <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4">{t("rec_archive")}</h3>
        {state.archive.length === 0 ? (
          <p className="text-gray-400 text-sm">{t("rec_archive_empty")}</p>
        ) : (
          <div className="space-y-3">
            {state.archive.map((r) => (
              <div key={r.id} className="border border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap justify-between gap-3 items-start">
                  <div className="text-sm min-w-0">
                    <p className="text-white font-medium">
                      {new Date(r.startedAt).toLocaleDateString(locale)}
                      {" · "}
                      {new Date(r.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      {r.endedAt
                        ? ` → ${new Date(r.endedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </p>
                    <p className="text-gray-400 font-mono text-xs mt-1 break-all">{r.fileName}</p>
                    <p className="text-gray-400 text-xs mt-1">
                      {t("rec_duration")}: {fmtHMS(r.durationSeconds ?? 0)} · {t("rec_azan_events")}:{" "}
                      {r.azanEvents.length} · {r.status === "archived" ? "Drive ✓" : r.status}
                    </p>
                    {r.status === "failed" && (
                      <p className="text-red-400 text-xs mt-1 break-all">
                        {t("rec_failed")}: {r.error}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {r.status === "archived" && (
                      <button
                        onClick={() => setPlayer(r)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                      >
                        {t("rec_view")}
                      </button>
                    )}
                    {r.status === "failed" && (
                      <button
                        onClick={() => handleAbortStuck(r.id)}
                        className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                      >
                        {t("rec_dismiss")}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                    >
                      {t("rec_delete")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recording player modal (admin-only) */}
      {player && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4 gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white break-all">{player.fileName}</h3>
                <p className="text-gray-400 text-sm">
                  {fmtHMS(player.durationSeconds ?? 0)} · {player.azanEvents.length} {t("rec_azan_count_suffix")}
                </p>
              </div>
              <button
                onClick={() => setPlayer(null)}
                className="text-gray-400 hover:text-white shrink-0"
                aria-label={t("rec_close")}
              >
                ✕
              </button>
            </div>

            <audio
              ref={playerAudioRef}
              src={`/api/radio-recording/stream?id=${encodeURIComponent(player.id)}`}
              controls
              className="w-full"
              preload="metadata"
            />

            <h4 className="text-white font-semibold mt-5 mb-2">{t("rec_azan_events")}</h4>
            {player.azanEvents.length === 0 ? (
              <p className="text-gray-400 text-sm">{t("rec_no_azan")}</p>
            ) : (
              <ol className="space-y-2">
                {player.azanEvents
                  .slice()
                  .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
                  .map((ev) => (
                    <li
                      key={`${ev.prayer}-${ev.offsetSeconds}`}
                      className="flex justify-between items-center text-sm border border-white/10 rounded-lg px-3 py-2 gap-2"
                    >
                      <span className="text-gray-300 min-w-0">
                        {t(`prayer_${ev.prayer}` as TranslationKey)} — <span className="font-mono">{fmtHMS(ev.offsetSeconds)}</span>
                      </span>
                      <button
                        onClick={() => jumpToAzan(ev.offsetSeconds)}
                        className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs shrink-0"
                      >
                        {t("rec_jump")}
                      </button>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
