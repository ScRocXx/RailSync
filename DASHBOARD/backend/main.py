"""
RailSync FastAPI Backend Server
Provides live endpoints for division state, conflict detection, and real-time operations.
"""

import os
import sys
import time
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add DASHBOARD directory to sys.path so build_data can be imported
BACKEND_DIR = Path(__file__).resolve().parent
DASHBOARD_DIR = BACKEND_DIR.parent
SIMULATOR_DATA_DIR = DASHBOARD_DIR.parent / "SIMULATOR" / "data"

if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))

try:
    from build_data import generate_bundle
except ImportError as e:
    raise RuntimeError(f"Could not import generate_bundle from build_data: {e}")

app = FastAPI(
    title="RailSync Operations API",
    description="Operational railway dispatch, maintenance block scheduling, and conflict detection API",
    version="1.0.0",
)

# Enable CORS for Vite dev server and local access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cached in-memory bundle
_bundle_cache = None


def get_current_bundle(force_refresh: bool = False):
    global _bundle_cache
    if _bundle_cache is None or force_refresh:
        _bundle_cache = generate_bundle(sim_dir=str(SIMULATOR_DATA_DIR))
    return _bundle_cache


class DelayInjectionRequest(BaseModel):
    train_id: str
    delay_minutes: int
    reason: Optional[str] = "Unscheduled operational check"


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "RailSync Operations API",
        "division": "Delhi Division",
        "zone": "Northern Railway",
    }


@app.get("/api/division-state")
def get_division_state(refresh: bool = False):
    """
    Returns the complete operational data bundle for Delhi Division,
    including network topology, scheduled/running trains, maintenance queue,
    automated block proposals, machine fleet status, TSRs, and division metrics.
    """
    try:
        bundle = get_current_bundle(force_refresh=refresh)
        return bundle
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate division state: {str(e)}")


@app.post("/api/inject-delay")
def inject_delay(req: DelayInjectionRequest):
    """
    What-if simulation: inject an ad-hoc delay into a passenger/freight train path
    and adjust downstream path arrival times.
    """
    bundle = get_current_bundle()
    trains = bundle.get("trains", [])
    target = None
    for t in trains:
        if t["id"] == req.train_id or t["no"] == req.train_id:
            target = t
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"Train {req.train_id} not found")

    target["delay"] = target.get("delay", 0) + req.delay_minutes
    target["entry"] = target.get("entry", 0) + req.delay_minutes
    target["exit"] = target.get("exit", 0) + req.delay_minutes
    
    # Shift actual path coordinates
    if "path" in target:
        target["path"] = [[pt[0] + req.delay_minutes, pt[1]] for pt in target["path"]]
    
    # Shift halts
    if "halts" in target:
        for h in target["halts"]:
            h["arrAct"] = h.get("arrAct", h.get("arr", 0)) + req.delay_minutes
            h["depAct"] = h.get("depAct", h.get("dep", 0)) + req.delay_minutes

    return {
        "status": "injected",
        "train_id": target["id"],
        "train_no": target["no"],
        "new_delay_minutes": target["delay"],
        "reason": req.reason,
    }


import sqlite3

SIM_DB = os.path.join(os.path.dirname(__file__), "..", "..", "SIMULATOR", "data", "telemetry.db")


def read_live_telemetry():
    """Queries telemetry.db for active simulator heartbeats and latest states."""
    active_sims = []
    latest_states = {}
    if not os.path.exists(SIM_DB):
        return {"live": False, "connected": [], "states": {}}

    try:
        conn = sqlite3.connect(SIM_DB, timeout=1.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        now_ts = time.time()
        # Look for heartbeats within the last 3.5 seconds
        cur.execute("SELECT * FROM simulator_heartbeat WHERE ? - last_heartbeat < 3.5", (now_ts,))
        rows = cur.fetchall()
        for r in rows:
            active_sims.append({
                "sim_id": r["sim_id"],
                "sim_name": r["sim_name"],
                "tick_count": r["tick_count"],
                "last_message": r["last_message"],
                "latency_sec": round(now_ts - r["last_heartbeat"], 2),
            })

        # Read latest states
        cur.execute("SELECT * FROM simulator_state")
        srows = cur.fetchall()
        for sr in srows:
            try:
                latest_states[sr["sim_id"]] = json.loads(sr["payload"])
            except Exception:
                pass
        conn.close()
    except Exception:
        pass

    return {
        "live": len(active_sims) > 0,
        "connected": active_sims,
        "states": latest_states,
    }


@app.get("/api/stream")
async def live_stream(request: Request):
    """
    Server-Sent Events (SSE) route: streams periodic operational telemetry ticks,
    active simulator terminal heartbeats, simulated division clock progression,
    and live telemetry updates to the dashboard.
    """
    async def event_generator():
        # Open on morning peak shift (07:30 AM = 450 min)
        clock_minute = 450.0
        while True:
            if await request.is_disconnected():
                break

            bundle = get_current_bundle()
            metrics = bundle.get("metrics", {})
            live_telemetry = read_live_telemetry()
            payload = {
                "type": "telemetry_tick",
                "clock": round(clock_minute, 2),
                "punctuality": metrics.get("punctuality", 72.2),
                "timestamp": datetime.utcnow().isoformat(),
                "telemetry_live": live_telemetry["live"],
                "connected_simulators": live_telemetry["connected"],
                "live_states": live_telemetry["states"],
            }
            yield f"data: {json.dumps(payload)}\n\n"
            clock_minute = (clock_minute + 0.1) % (24 * 60)
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
