from fastapi import FastAPI, UploadFile, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
import os
from statistics import median

DB_FILE = "sessions.db"

# Ensure database exists
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metadata TEXT
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS trials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        latency REAL,
        accuracy REAL,
        drift REAL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
    )
    """)
    conn.commit()
    conn.close()

init_db()

app = FastAPI()

# Allow frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # dev-friendly
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Trial(BaseModel):
    latency: float
    accuracy: float
    drift: float

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/session/start")
def start_session(metadata: Optional[str] = Form(None)):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT INTO sessions (metadata) VALUES (?)", (metadata,))
    session_id = c.lastrowid
    conn.commit()
    conn.close()
    return {"session_id": session_id}

@app.post("/session/{session_id}/trials")
def add_trials(session_id: int, trials: List[Trial] = Body(...)):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    for t in trials:
        c.execute(
            "INSERT INTO trials (session_id, latency, accuracy, drift) VALUES (?, ?, ?, ?)",
            (session_id, t.latency, t.accuracy, t.drift)
        )
    conn.commit()
    conn.close()
    return {"status": "trials added", "count": len(trials)}

# ----------------------
# Friendlier severity scoring
# ----------------------

# Normalization caps (anything worse than this is treated as "100 bad")
LAT_MS_CAP    = 700.0   # latency ≥ 700ms -> max badness
DRIFT_PX_CAP  = 450.0   # drift ≥ 450px  -> max badness
ACC_PX_CAP    = 120.0   # miss ≥ 120px   -> max badness

# Weights (sum to 1.0). Emphasize accuracy (= control).
W_ACC = 0.50
W_LAT = 0.30
W_DRF = 0.20

def _percentile(xs, p):
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = (len(xs) - 1) * p
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    if f == c:
        return float(xs[f])
    d0 = xs[f] * (c - f)
    d1 = xs[c] * (k - f)
    return float(d0 + d1)

def _clip_to(xs, hi):
    return [min(x, hi) for x in xs]

def _normalize(value, cap):
    """Map raw value -> 0..100 badness (lower raw is better)."""
    if value <= 0:
        return 0.0
    return max(0.0, min(100.0, (value / cap) * 100.0))

def _robust_center(xs):
    return median(xs) if xs else 0.0

def _robust_score(latencies, drifts, accuracies):
    """Compute severity (0..100) and robust per-metric centers."""
    if not (latencies or drifts or accuracies):
        return 0.0, {"latency_ms": 0.0, "drift_px": 0.0, "accuracy_px": 0.0}

    # 1) Clip extremes at the 95th percentile to reduce outlier influence
    if latencies:
        latencies = _clip_to(latencies, _percentile(latencies, 0.95))
    if drifts:
        drifts = _clip_to(drifts, _percentile(drifts, 0.95))
    if accuracies:
        accuracies = _clip_to(accuracies, _percentile(accuracies, 0.95))

    # 2) Robust central tendency (median)
    lat_med = _robust_center(latencies)
    drf_med = _robust_center(drifts)
    acc_med = _robust_center(accuracies)

    # 3) Normalize to 0..100 "badness"
    lat_bad = _normalize(lat_med, LAT_MS_CAP)
    drf_bad = _normalize(drf_med, DRIFT_PX_CAP)
    acc_bad = _normalize(acc_med, ACC_PX_CAP)

    # 4) Weighted severity (still 0..100)
    severity = (W_ACC * acc_bad) + (W_LAT * lat_bad) + (W_DRF * drf_bad)

    return float(severity), {
        "latency_ms": float(lat_med),
        "drift_px": float(drf_med),
        "accuracy_px": float(acc_med),
    }

@app.post("/session/{session_id}/score")
@app.get("/session/{session_id}/score")
def compute_score(session_id: int):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT latency, accuracy, drift FROM trials WHERE session_id = ?", (session_id,))
    rows = c.fetchall()
    conn.close()

    if not rows:
        return {"session_id": session_id, "severity": None, "metrics": None, "n_trials": 0, "message": "no trials"}

    latencies = [r[0] for r in rows if r[0] is not None]
    accuracies = [r[1] for r in rows if r[1] is not None]
    drifts    = [r[2] for r in rows if r[2] is not None]

    severity, metrics = _robust_score(latencies, drifts, accuracies)

    # Back-compat fields (avg_*) so your frontend fallback still works
    avg_latency  = sum(latencies) / len(latencies) if latencies else 0.0
    avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else 0.0
    avg_drift    = sum(drifts) / len(drifts) if drifts else 0.0

    return {
        "session_id": session_id,
        "severity": round(severity, 2),
        "metrics": {
            "latency_ms": round(metrics["latency_ms"], 1),
            "drift_px": round(metrics["drift_px"], 1),
            "accuracy_px": round(metrics["accuracy_px"], 1),
        },
        "avg_latency": round(avg_latency, 3),
        "avg_accuracy": round(avg_accuracy, 3),
        "avg_drift": round(avg_drift, 3),
        "n_trials": len(rows),
    }

@app.get("/session/{session_id}")
def get_session(session_id: int):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    session = c.fetchone()
    c.execute("SELECT latency, accuracy, drift FROM trials WHERE session_id = ?", (session_id,))
    trials = c.fetchall()
    conn.close()
    return {"session": session, "trials": trials}
