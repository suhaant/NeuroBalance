"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    webgazer?: {
      setGazeListener: (cb: (data: { x: number; y: number } | null, ts: number) => void) => any;
      begin: () => Promise<void>;
      end: () => Promise<void>;
      showVideoPreview: (show: boolean) => any;
      showVideo: (show: boolean) => any;
      showFaceOverlay: (show: boolean) => any;
      showFaceFeedbackBox: (show: boolean) => any;
      showPredictionPoints: (show: boolean) => any;
      setRegression: (name: string) => any;
      saveDataAcrossSessions: (s: boolean) => any;
    };
  }
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function useWebGazer(opts?: { enabled?: boolean; ema?: number; deadzone?: number; lostMs?: number }) {
  const enabled = opts?.enabled ?? true;
  const alpha = opts?.ema ?? 0.6;          // smoothing (0..1)
  const deadzone = opts?.deadzone ?? 12;   // px
  const lostMs = opts?.lostMs ?? 180;      // consider gaze “lost” if no update for this many ms

  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(true);
  const rawRef = useRef<{ x: number; y: number } | null>(null);
  const smoothRef = useRef<{ x: number; y: number } | null>(null);
  const lastTsRef = useRef<number>(0);

  const onGaze = useCallback(
    (p: { x: number; y: number } | null) => {
      const now = performance.now();
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        // ignore invalid frames
        rawRef.current = null;
        return;
      }
      rawRef.current = p;

      // EMA smoothing w/ deadzone
      const prev = smoothRef.current;
      if (!prev) {
        smoothRef.current = { ...p };
      } else {
        const dx = p.x - prev.x, dy = p.y - prev.y;
        if (Math.hypot(dx, dy) >= deadzone) {
          smoothRef.current = { x: prev.x + alpha * dx, y: prev.y + alpha * dy };
        }
      }
      lastTsRef.current = now;
      setLost(false);
    },
    [alpha, deadzone]
  );

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | null = null;

    (async () => {
      await loadScriptOnce("https://cdn.jsdelivr.net/npm/webgazer/dist/webgazer.min.js");
      const wg = window.webgazer!;
      wg.setRegression("ridge");
      wg.showVideo(false);
      wg.showVideoPreview(false);
      wg.showFaceOverlay(false);
      wg.showFaceFeedbackBox(false);
      wg.showPredictionPoints(false);
      wg.saveDataAcrossSessions(false);

      wg.setGazeListener((data, ts) => {
        if (stopped) return;
        onGaze(data ? { x: data.x, y: data.y } : null);
      });

      await wg.begin();
      if (!stopped) {
        setReady(true);
        // heartbeat to mark gaze “lost” if no updates recently
        const beat = () => {
          const now = performance.now();
          setLost(now - lastTsRef.current > lostMs);
          timer = window.setTimeout(beat, 60);
        };
        beat();
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (window.webgazer) window.webgazer.end().catch(() => {});
    };
  }, [enabled, onGaze, lostMs]);

  return { ready, lost, raw: rawRef, smooth: smoothRef };
}
