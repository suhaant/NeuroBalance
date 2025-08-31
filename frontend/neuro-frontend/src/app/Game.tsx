"use client";

import { useEffect, useRef } from "react";
import { useWebGazer } from "./hooks/useWebGazer";

export type Trial = {
  game: "paddle";
  metric_name: "latency_ms" | "accuracy_px" | "drift_px";
  value: number;
  unit: string;
};

export default function Game({
  sessionId,
  onTrial,
  useGaze = true,
}: {
  sessionId: number | null;
  onTrial: (t: Trial) => void;
  useGaze?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Eye tracking with smoothing + blink detection (lost flag)
  const { ready, lost, smooth } = useWebGazer({
    enabled: useGaze,
    ema: 0.6,
    deadzone: 12,
    lostMs: 180,
  });
  const lostRef = useRef<boolean>(true);
  useEffect(() => {
    lostRef.current = !!lost;
  }, [lost]);

  // Base logical canvas size (drawn crisp; CSS scales it)
  const W = 800, H = 500;

  // Longer paddle (≈30% of width)
  const paddle = useRef({
    x: W / 2,
    y: H - 22,
    w: Math.round(W * 0.30),
    h: Math.max(12, Math.round(H * 0.035)),
    speed: Math.max(6, Math.round(W * 0.012)),
  });

  const ball = useRef({
    x: W / 2,
    y: Math.round(H * 0.30),
    r: Math.max(6, Math.round(H * 0.025)),
    vx: W * 0.007,
    vy: H * 0.012,
  });
  const keys = useRef({ left: false, right: false });

  // Round metrics
  const roundStartTs = useRef<number | null>(null);
  const firstContactTs = useRef<number | null>(null);
  const driftAcc = useRef<number>(0);
  const lastPaddleX = useRef<number>(paddle.current.x);
  const runningRef = useRef<boolean>(false);

  // Calibration state
  const calibratingRef = useRef<boolean>(false);
  const calibIndexRef = useRef<number>(0);
  const calibTargets = useRef<number[]>([0.15, 0.5, 0.85]);
  const calibSamplesRef = useRef<number[]>([]);
  const calib = useRef<{ a: number; b: number } | null>(null); // x' = a*x + b

  function resetRound() {
    ball.current.x = W / 2;
    ball.current.y = 120;
    ball.current.vx = (Math.random() < 0.5 ? -1 : 1) * (2.8 + Math.random() * 1.2);
    ball.current.vy = 3.6 + Math.random() * 1.4;
    roundStartTs.current = performance.now();
    firstContactTs.current = null;
    driftAcc.current = 0;
    lastPaddleX.current = paddle.current.x;
    runningRef.current = true;
  }

  // Keyboard + hotkeys
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") keys.current.left = true;
      if (e.key === "ArrowRight") keys.current.right = true;
      if (e.key === " ") resetRound();
      if (e.key.toLowerCase() === "c") startCalibration();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") keys.current.left = false;
      if (e.key === "ArrowRight") keys.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map gaze viewport X -> canvas X, then apply linear calibration
  function mapGazeX(gxViewport: number, cvs: HTMLCanvasElement) {
    const rect = cvs.getBoundingClientRect();
    const rawCanvasX = gxViewport - rect.left;
    if (!calib.current) return rawCanvasX;
    return calib.current.a * rawCanvasX + calib.current.b;
  }

  // Start 3-point calibration
  function startCalibration() {
    const cvs = canvasRef.current;
    if (!cvs) return;
    calibratingRef.current = true;
    calibIndexRef.current = 0;
    calibSamplesRef.current = [];
    runningRef.current = false;
    scheduleCalibSample();
  }

  function scheduleCalibSample() {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const idx = calibIndexRef.current;

    setTimeout(async () => {
      const rect = cvs.getBoundingClientRect();
      const samples: number[] = [];
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 30));
        const g = smooth.current;
        if (g) samples.push(g.x - rect.left);
      }
      const avg =
        samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : calibTargets.current[idx] * W;
      calibSamplesRef.current.push(avg);

      calibIndexRef.current += 1;
      if (calibIndexRef.current < calibTargets.current.length) {
        scheduleCalibSample();
      } else {
        // Fit linear map
        const screenXs = calibSamplesRef.current;
        const canvasXs = calibTargets.current.map((t) => t * W);
        const n = screenXs.length;
        const sx = screenXs.reduce((a, b) => a + b, 0);
        const sy = canvasXs.reduce((a, b) => a + b, 0);
        const sxx = screenXs.reduce((a, b) => a + b * b, 0);
        const sxy = screenXs.reduce((a, xi, i) => a + xi * canvasXs[i], 0);
        const denom = n * sxx - sx * sx || 1;
        const a = (n * sxy - sx * sy) / denom;
        const b = (sy - a * sx) / n;
        calib.current = { a, b };
        calibratingRef.current = false;
      }
    }, 500);
  }

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d")!;
    let raf = 0;

    const tick = () => {
      // Calibration overlay
      if (calibratingRef.current) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        roundRect(ctx, 16, 16, W - 32, H - 32, 18, true, false);
        strokeGlass(ctx, 16, 16, W - 32, H - 32, 18);
        const idx = calibIndexRef.current;
        const x = calibTargets.current[Math.min(idx, calibTargets.current.length - 1)] * W;
        const y = H * 0.6;
        drawGlowDot(ctx, x, y, 10, "#38bdf8");
        ctx.fillStyle = "rgba(203,213,225,0.95)";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText("Calibration — look at the dot", 24, 36);
        ctx.fillText(
          `Point ${Math.min(idx + 1, calibTargets.current.length)} / ${calibTargets.current.length}`,
          24,
          54
        );
        ctx.fillText("Press SPACE to start a round. Press C to re-calibrate anytime.", 24, 72);

        raf = requestAnimationFrame(tick);
        return;
      }

      // Control: gaze (preferred) or keyboard fallback
      if (useGaze && smooth.current) {
        const mappedX = mapGazeX(smooth.current.x, cvs);

        if (!lostRef.current) {
          const maxDelta = W * 0.1;
          const targetXRaw = Math.max(paddle.current.w / 2, Math.min(W - paddle.current.w / 2, mappedX));
          const delta = targetXRaw - paddle.current.x;
          const clampedTargetX =
            Math.abs(delta) > maxDelta ? paddle.current.x + Math.sign(delta) * maxDelta : targetXRaw;

          const lerp = 0.42;
          paddle.current.x = paddle.current.x + (clampedTargetX - paddle.current.x) * lerp;
        }
      } else {
        if (keys.current.left) paddle.current.x -= paddle.current.speed;
        if (keys.current.right) paddle.current.x += paddle.current.speed;
        paddle.current.x = Math.max(paddle.current.w / 2, Math.min(W - paddle.current.w / 2, paddle.current.x));
      }

      // Drift accumulation
      driftAcc.current += Math.abs(paddle.current.x - lastPaddleX.current);
      lastPaddleX.current = paddle.current.x;

      // Ball physics
      ball.current.x += ball.current.vx;
      ball.current.y += ball.current.vy;

      if (ball.current.x - ball.current.r <= 0 || ball.current.x + ball.current.r >= W) ball.current.vx *= -1;
      if (ball.current.y - ball.current.r <= 0) ball.current.vy *= -1;

      const pTop = paddle.current.y - paddle.current.h / 2;
      const pLeft = paddle.current.x - paddle.current.w / 2;
      const pRight = paddle.current.x + paddle.current.w / 2;
      const hit =
        ball.current.y + ball.current.r >= pTop &&
        ball.current.x >= pLeft &&
        ball.current.x <= pRight &&
        ball.current.vy > 0;

      if (hit) {
        if (!firstContactTs.current && roundStartTs.current) {
          firstContactTs.current = performance.now();
          const latency = firstContactTs.current - roundStartTs.current;
          onTrial({ game: "paddle", metric_name: "latency_ms", value: latency, unit: "ms" });
          const accuracy = Math.abs(ball.current.x - paddle.current.x);
          onTrial({ game: "paddle", metric_name: "accuracy_px", value: accuracy, unit: "px" });
        }
        const offset = (ball.current.x - paddle.current.x) / (paddle.current.w / 2);
        ball.current.vy *= -1;
        ball.current.vx += offset * 1.15;
      }

      if (ball.current.y - ball.current.r > H && runningRef.current) {
        runningRef.current = false;
        onTrial({ game: "paddle", metric_name: "drift_px", value: driftAcc.current, unit: "px" });
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#0b1220");
      g.addColorStop(1, "#0f1b34");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.05)";
      roundRect(ctx, 16, 16, W - 32, H - 32, 18, true, false);
      strokeGlass(ctx, 16, 16, W - 32, H - 32, 18);

      const drawPTop = paddle.current.y - paddle.current.h / 2;
      const drawPLeft = paddle.current.x - paddle.current.w / 2;
      drawGlowRect(ctx, drawPLeft, drawPTop, paddle.current.w, paddle.current.h, "#22d3ee");
      drawGlowDot(ctx, ball.current.x, ball.current.y, ball.current.r, "#f59e0b");

      ctx.fillStyle = "rgba(203,213,225,0.95)";
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText("SPACE=new round | ←/→ move | Eyes=on (if webcam allowed)", 24, 36);
      if (sessionId) ctx.fillText(`SID: ${sessionId}`, 24, 54);
      if (!runningRef.current) ctx.fillText("Press SPACE to start a round", 24, 72);
      if (useGaze)
        ctx.fillText(`Gaze: ${ready ? (lostRef.current ? "lost" : "ready") : "loading…"} | press 'C' to calibrate`, 24, 90);

      raf = requestAnimationFrame(tick);
    };

    resetRound();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, useGaze, ready]);

  // Helpers
  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: boolean,
    stroke: boolean
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
  function strokeGlass(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, r, false, true);
    ctx.restore();
  }
  function drawGlowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function drawGlowRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="block w-full h-auto rounded-xl border border-white/10"
      onClick={() => canvasRef.current?.focus()}
      tabIndex={0}
    />
  );
}
