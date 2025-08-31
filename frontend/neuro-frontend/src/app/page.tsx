"use client";

import { useState } from "react";
import Game, { type Trial } from "./Game";

type Metrics = { latency_ms: number; drift_px: number; accuracy_px: number };
type Result = { severity: number | null; metrics?: Metrics | null };

function severityLabel(sev: number | null) {
  if (sev === null) return { label: "—", color: "bg-slate-600" };
  if (sev >= 85) return { label: "High", color: "bg-red-500" };
  if (sev >= 60) return { label: "Medium", color: "bg-amber-500" };
  return { label: "Low", color: "bg-emerald-500" };
}

export default function Page() {
  const backend = "http://127.0.0.1:8000";
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [useGaze, setUseGaze] = useState(true);

  // temp holders for a round
  const lastLatency = { current: null as number | null };
  const lastAccuracy = { current: null as number | null };

  async function startSession() {
    try {
      const form = new FormData();
      form.append("metadata", "web-demo");
      const res = await fetch(`${backend}/session/start`, { method: "POST", body: form });
      const data = await res.json();
      setSessionId(data.session_id);
      setMessage(`Session ${data.session_id} started`);
      setResult(null);
    } catch {
      setMessage("Backend error starting session");
    }
  }

  async function submitTrial(trial: Trial) {
    if (!sessionId) return setMessage("Start a session first");
    if (trial.metric_name === "latency_ms") { lastLatency.current = trial.value; return; }
    if (trial.metric_name === "accuracy_px") { lastAccuracy.current = trial.value; return; }
    if (trial.metric_name === "drift_px") {
      const body = [{
        latency: lastLatency.current ?? 300,
        accuracy: lastAccuracy.current ?? 80,
        drift: trial.value,
      }];
      lastLatency.current = null; lastAccuracy.current = null;
      try {
        await fetch(`${backend}/session/${sessionId}/trials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        setMessage("Error saving trial");
      }
    }
  }

  async function computeScore() {
    if (!sessionId) return setMessage("Start a session first");
    try {
      const tryPost = await fetch(`${backend}/session/${sessionId}/score`, { method: "POST" }).catch(() => null);
      const res = tryPost && tryPost.ok ? tryPost : await fetch(`${backend}/session/${sessionId}/score`);
      const data = await res.json();
      const severity = data.severity ?? data.score ?? null;
      const metrics =
        data.metrics ??
        (typeof data.avg_latency !== "undefined"
          ? { latency_ms: data.avg_latency, drift_px: data.avg_drift, accuracy_px: data.avg_accuracy }
          : null);
      setResult({ severity, metrics });
      setMessage(
        metrics
          ? `${Math.round(metrics.latency_ms)}ms · ${Math.round(metrics.drift_px)}px drift · ${Math.round(metrics.accuracy_px)}px acc`
          : `Severity ${severity ?? "—"}`
      );
    } catch {
      setMessage("Error computing score");
    }
  }

  async function health() {
    try {
      const r = await fetch(`${backend}/health`);
      const d = await r.json();
      setMessage(`Backend: ${d.status}`);
    } catch {
      setMessage("Backend not reachable");
    }
  }

  const sev = result?.severity ?? null;
  const sevInfo = severityLabel(sev);

  return (
    <main className="min-h-screen bg-[#0b0b12] text-slate-100">
      {/* Top nav bar */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-400 to-sky-400" />
            <div className="text-lg font-semibold tracking-tight">NeuroBalance</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={health} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">Health</button>
            <button onClick={startSession} className="rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-emerald-300">Start Session</button>
            <button onClick={() => setUseGaze(v => !v)} className="rounded-lg bg-sky-400 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-sky-300">{useGaze ? "Eyes: ON" : "Eyes: OFF"}</button>
            <button onClick={computeScore} disabled={!sessionId} className="rounded-lg bg-fuchsia-400 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-fuchsia-300 disabled:opacity-50">Compute Score</button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-6 pt-10">
        <h1 className="text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-sky-300 to-fuchsia-300">
          Visual Motor Training — Effortless & Precise
        </h1>
        <p className="mt-3 max-w-3xl text-base text-slate-300">
          Play a gaze-controlled mini-game to train coordination. We measure <span className="font-medium">latency</span>, <span className="font-medium">accuracy</span>, and <span className="font-medium">drift</span> and compress them into a single severity score.
        </p>
      </section>

      {/* Main split */}
      <section className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 px-6 py-8 lg:grid-cols-[minmax(760px,1fr)_380px]">
        {/* Left: Game card (constrained, no bleed) */}
        <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#121625] to-[#0f1322] p-4 shadow-[0_10px_50px_rgba(88,101,242,0.15)]">
          <Game sessionId={sessionId} onTrial={submitTrial} useGaze={useGaze} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-300/80">
            <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center">SPACE = new round</div>
            <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center">← / → = move</div>
            <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center">C = calibrate</div>
          </div>
        </div>

        {/* Right: Results */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Session Results</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full text-white ${sevInfo.color}`}>
                {sevInfo.label}{sev !== null ? ` (${Math.round(sev)})` : ""}
              </span>
            </div>

            <div className="mt-3 h-1.5 w-full rounded bg-black/30 overflow-hidden">
              <div
                className="h-1.5 bg-gradient-to-r from-sky-400 to-fuchsia-400"
                style={{ width: `${Math.max(0, Math.min(100, sev ?? 0))}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="opacity-70">Latency</div>
                <div className="mt-0.5 text-base font-semibold">
                  {result?.metrics ? `${Math.round(result.metrics.latency_ms)} ms` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="opacity-70">Drift</div>
                <div className="mt-0.5 text-base font-semibold">
                  {result?.metrics ? `${Math.round(result.metrics.drift_px)} px` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="opacity-70">Accuracy</div>
                <div className="mt-0.5 text-base font-semibold">
                  {result?.metrics ? `${Math.round(result.metrics.accuracy_px)} px` : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h4 className="text-sm font-semibold">Status</h4>
            <p className="mt-2 text-sm text-slate-200/90">{message || "—"}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Privacy-first</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Latency / Accuracy / Drift</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">SQLite sessions</span>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

