"""
RailSync FastAPI Backend Server
Provides live endpoints for division state, conflict detection, and real-time operations.
"""

import sys
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
