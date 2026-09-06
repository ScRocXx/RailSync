"""
RailSync Dashboard — Data Bundle Builder
========================================
Reads the raw SIMULATOR feeds (COA, FOIS, TMS, TDMS, SMMS, TMMS, ICMS, CRT,
network topology) and compiles a single browser-loadable bundle:

    js/railsync-data.js   ->   window.RAILSYNC_DATA = {...}

Doing the heavy joins here (train path geometry, urgency scoring, AI block
proposals, conflict detection) keeps the dashboard itself a pure rendering
layer, and lets index.html run straight off the filesystem with no server.

Usage:  python build_data.py
"""

import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.join(os.path.dirname(HERE), "SIMULATOR", "data")
OUT = os.path.join(HERE, "js", "railsync-data.js")

DAY_MINUTES = 24 * 60


def load(name):
    with open(os.path.join(SIM, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def r(x, n=2):
    """Round for transport; keeps the bundle small and diffs stable."""
    return round(float(x), n)


# ---------------------------------------------------------------- topology

def build_corridors(topo):
    corridors = []
    for c in topo["corridors"]:
        corridors.append({
            "id": c["corridor_id"],
            "name": c["corridor_name"],
            "lines": c["lines"],
            "maxSpeed": c["max_speed_kmph"],
            "lengthKm": c["total_length_km"],
            "stations": [{
                "code": s["station_code"],
                "name": s["station_name"],
                "km": s["km_marker"],
                "loop": s.get("has_platform_loop", False),
                "loopCsr": s.get("loop_csr_meters", 0),
                "platforms": s.get("platforms", 1),
                "sidings": s.get("siding_ids", []),
                "crossovers": s.get("crossover_switches", []),
            } for s in c["stations"]],
            "sections": [{
                "id": b["section_id"],
                "from": b["from_station"],
                "to": b["to_station"],
                "km": b["distance_km"],
                "lines": b["lines"],
            } for b in c.get("block_sections", [])],
        })
    return corridors


def km_index(corridors):
    """corridor_id -> {station_code: km_marker}"""
    return {c["id"]: {s["code"]: s["km"] for s in c["stations"]} for c in corridors}


# ------------------------------------------------------------------ trains

# Priority class drives colour on the string chart and precedence in conflict
# resolution.  Ranks come straight from COA's priority_rank.
def classify(train_name, rank):
    n = (train_name or "").upper()
    if "VANDE BHARAT" in n or "RAJDHANI" in n or "SHATABDI" in n or rank == 1:
        return "PREMIUM"
    if "EMU" in n or "SUBURBAN" in n or rank == 3:
        return "SUBURBAN"
    return "EXPRESS"


def build_passenger(coa, kmx):
    trains = []
    for t in coa:
        cid = t["corridor_id"]
        marks = kmx.get(cid, {})
        sched, actual, halts = [], [], []
        for s in t["stations_trajectory"]:
            km = marks.get(s["station_code"])
            if km is None:
                continue
            # Two points per station: arrival and departure. A halt therefore
            # renders as a short horizontal dwell segment on the Marey chart,
            # which is exactly how a controller reads a stop.
            sched.append([s["arr_scheduled"], km])
            if s["dep_scheduled"] != s["arr_scheduled"]:
                sched.append([s["dep_scheduled"], km])
            actual.append([s["arr_actual_rtis"], km])
            if s["dep_actual_rtis"] != s["arr_actual_rtis"]:
                actual.append([s["dep_actual_rtis"], km])
            halts.append({
                "code": s["station_code"], "km": km,
                "arr": s["arr_scheduled"], "dep": s["dep_scheduled"],
                "arrAct": s["arr_actual_rtis"], "depAct": s["dep_actual_rtis"],
                "act": s["action"],
                "arrStr": s.get("arr_time_str", ""), "depStr": s.get("dep_time_str", ""),
            })
        if len(actual) < 2:
            continue
        delay = max(p["arrAct"] - p["arr"] for p in halts)
        run = actual[-1][0] - actual[0][0]
        dist = abs(actual[-1][1] - actual[0][1])
        trains.append({
            "id": "T" + t["train_no"],
            "no": t["train_no"],
            "name": t["train_name"],
            "kind": "PASSENGER",
            "cls": classify(t["train_name"], t.get("priority_rank", 2)),
            "rank": t.get("priority_rank", 2),
            "corridor": cid,
            "line": t["track_id"],
            "dir": t["direction"],
            "mps": t.get("max_permissible_speed_kmph", 110),
            "delay": delay,
            "entry": actual[0][0],
            "exit": actual[-1][0],
            "avgSpeed": r(dist / (run / 60.0), 1) if run > 0 else 0,
            "sched": sched,
            "path": actual,
            "halts": halts,
        })
    return trains


def build_freight(fois, kmx, corridors):
    """FOIS ships a manifest, not a timetable. A controller still has to see the
    rake as a path, so we lay one down across the corridor inside the operator's
    preferred departure window at the rake's speed potential."""
    by_id = {c["id"]: c for c in corridors}
    trains = []
    for i, f in enumerate(fois):
        cid = f["corridor_id"]
        corr = by_id.get(cid)
        marks = kmx.get(cid, {})
        if not corr:
            continue
        o = marks.get(f["origin_station"])
        d = marks.get(f["destination_station"])
        if o is None or d is None or o == d:
            continue
        # Stagger departures across the window so rakes don't overlay each other.
        w0 = f["preferred_departure_window"]["from_minutes"]
        w1 = f["preferred_departure_window"]["to_minutes"]
        dep = w0 + ((i * 37) % max(1, (w1 - w0)))
        transit = f.get("estimated_transit_minutes") or 180
        # Freight gets looped for crossings: model it as a few intermediate
        # points rather than one straight line, so the path reads realistically.
        pts, halts = [], []
        stns = [s for s in corr["stations"] if min(o, d) <= s["km"] <= max(o, d)]
        stns.sort(key=lambda s: s["km"], reverse=(d < o))
        span = abs(d - o)
        for s in stns:
            frac = abs(s["km"] - o) / span if span else 0
            tm = dep + transit * frac
            pts.append([r(tm, 1), s["km"]])
            halts.append({"code": s["code"], "km": s["km"], "arr": int(tm), "dep": int(tm),
                          "arrAct": int(tm), "depAct": int(tm), "act": "RUN-THROUGH",
                          "arrStr": fmt_hhmm(tm), "depStr": fmt_hhmm(tm)})
        if len(pts) < 2:
            continue
        trains.append({
            "id": "F" + str(i + 1),
            "no": f["rake_id"],
            "name": f["commodity_group"].replace("_", " ").title(),
            "kind": "FREIGHT",
            "cls": "FREIGHT",
            "rank": 5,
            "corridor": cid,
            "line": "DN_MAIN" if f["direction"] == "DN" else "UP_MAIN",
            "dir": f["direction"],
            "mps": f.get("speed_potential_kmph", 50),
            "delay": 0,
            "entry": pts[0][0],
            "exit": pts[-1][0],
            "avgSpeed": r(span / (transit / 60.0), 1) if transit else 0,
            "wagons": f["rake_configuration"]["total_wagons"],
            "tonnage": f["rake_configuration"]["gross_tonnage"],
            "lengthM": f["rake_configuration"]["total_length_meters"],
            "canLoop": f.get("can_be_stabled_in_loop", True),
            "criticality": f.get("powerhouse_criticality", "NORMAL"),
            "origin": f["origin_station"],
            "dest": f["destination_station"],
            "sched": pts,
            "path": pts,
            "halts": halts,
        })
    return trains


def fmt_hhmm(m):
    m = int(round(m)) % DAY_MINUTES
    return "%02d:%02d" % (m // 60, m % 60)


# --------------------------------------------------------- ingestion queue

# The urgency score is built from four named components rather than one opaque
# number, so the drawer can show a controller *why* a demand scored what it did.
#   condition (0-40) : how degraded the asset telemetry actually is
#   overdue   (0-25) : how long the demand has waited past its due date
#   safety    (0-20) : consequence if it fails (derailment / OHE / interlocking)
#   exposure  (0-15) : how much traffic actually runs over the defect
PRIORITY_FLOOR = {"CRITICAL": 78, "URGENT": 58, "AVERAGE": 34, "ROUTINE": 18, "GOOD": 10}

USFD_SEVERITY = {
    "IMR": 20, "IMRF": 20,       # imminent failure - remove immediately
    "REM": 15, "REMF": 15,       # remove within days
    "OBS": 8, "OBSF": 8,         # keep under observation
    "NONE": 0,
}


def lines_from_tag(text, adjacent=False):
    """Work out which running line an OHE segment or point machine sits over.

    TDMS elementary sections are numbered ES-<post>-UP-04 and S&T routes
    R-SZM-UP-04, so the line is encoded in the identifier. Getting this right
    matters: a block is only conflict-free if it is checked against the trains
    that actually run under it.
    """
    up = "-UP-" in text or text.endswith("-UP")
    dn = "-DN-" in text or text.endswith("-DN")
    out = []
    if up:
        out.append("UP_MAIN")
    if dn:
        out.append("DN_MAIN")
    if not out:
        out = ["UP_MAIN"]
    if adjacent:
        # Isolating the adjacent line kills both roads.
        out = ["UP_MAIN", "DN_MAIN"]
    return out


def band(score):
    if score >= 75:
        return "CRITICAL"
    if score >= 55:
        return "URGENT"
    return "ROUTINE"


def exposure_for(corridor_id, from_km, to_km, trains):
    """Count train paths that actually run over this chainage during the day."""
    n = 0
    lo, hi = min(from_km, to_km), max(from_km, to_km)
    for t in trains:
        if t["corridor"] != corridor_id:
            continue
        kms = [p[1] for p in t["path"]]
        if min(kms) <= hi and max(kms) >= lo:
            n += 1
    return n


def exposure_points(n, total):
    if not total:
        return 0.0
    return min(15.0, 15.0 * (n / float(max(total, 1))) * 2.2)


def build_queue(tms, tdms, smms, kmx, trains):
    rows = []
    per_corr = defaultdict(int)
    for t in trains:
        per_corr[t["corridor"]] += 1

    # ---- TMS / P-Way -----------------------------------------------------
    for d in tms:
        tgi = d["tgi_breakdown"]["composite_tgi"]
        flaw = d["usfd_flaw"]
        ch = d["chainage"]
        # TGI 100 = pristine; below ~35 needs attention under IRPWM.
        condition = max(0.0, min(40.0, (80.0 - tgi) * 0.62))
        overdue = min(25.0, d["overdue_days"] * 1.55)
        safety = min(20.0, USFD_SEVERITY.get(flaw["flaw_code"], 0)
                     + (6 if d["ballast_cushion_depth_mm"] < 150 else 0))
        expo = exposure_for(d["corridor_id"], ch["from_km"], ch["to_km"], trains)
        exposure = exposure_points(expo, per_corr[d["corridor_id"]])
        raw = condition + overdue + safety + exposure
        score = max(raw, PRIORITY_FLOOR.get(d["priority"], 0) * 0.92)
        usfd_pts = USFD_SEVERITY.get(flaw["flaw_code"], 0)
        ballast_pts = 6 if d["ballast_cushion_depth_mm"] < 150 else 0
        drivers = [
            {"k": "Composite TGI", "v": "%.1f" % tgi, "part": "condition",
             "pts": r(condition, 1)},
            {"k": "USFD flaw", "v": flaw["flaw_code"], "part": "safety",
             "pts": r(min(usfd_pts, 20), 1)},
            {"k": "Ballast cushion", "v": "%d mm" % d["ballast_cushion_depth_mm"],
             "part": "safety", "pts": r(ballast_pts, 1)},
            {"k": "Days overdue", "v": "%d d" % d["overdue_days"], "part": "overdue",
             "pts": r(overdue, 1)},
            {"k": "Traffic over defect", "v": "%d trains/day" % expo,
             "part": "exposure", "pts": r(exposure, 1)},
        ]
        rows.append({
            "id": d["inspection_id"],
            "dept": "TMS",
            "deptFull": "P-Way / Engineering",
            "corridor": d["corridor_id"],
            "line": d["track_id"],
            "lines": [d["track_id"]],
            "fromKm": ch["from_km"], "toKm": ch["to_km"],
            "chainage": "%s - %s" % (ch.get("from_mast", ""), ch.get("to_mast", "")),
            "telemetry": "TGI %.1f" % tgi,
            "telemetryDetail": [
                ["Composite TGI", "%.1f" % tgi],
                ["Unevenness (UI)", "%.0f" % d["tgi_breakdown"]["ui"]],
                ["Twist (TI)", "%.0f" % d["tgi_breakdown"]["ti"]],
                ["Gauge (GI)", "%.0f" % d["tgi_breakdown"]["gi"]],
                ["Alignment (AI)", "%.0f" % d["tgi_breakdown"]["ai"]],
                ["USFD flaw", flaw["flaw_code"]],
                ["Ballast cushion", "%d mm" % d["ballast_cushion_depth_mm"]],
                ["Rail / sleeper", "%s %s" % (d["track_structure"]["rail_weight"],
                                              d["track_structure"]["sleeper_type"])],
                ["GMT carried", "%.1f" % d["track_structure"]["gmt_carried"]],
            ],
            "action": d["required_action"],
            "overdueDays": d["overdue_days"],
            "priority": d["priority"],
            "score": r(min(100.0, score), 1),
            "parts": {"condition": r(condition, 1), "overdue": r(overdue, 1),
                      "safety": r(safety, 1), "exposure": r(exposure, 1)},
            "drivers": drivers,
            "trainsOver": expo,
            "durationMin": {"BCM_DEEP_SCREENING": 240, "TRT_RENEWAL": 300,
                            "CSM_TAMPING": 180, "DESTRESSING": 150,
                            "MANUAL_PACKING": 120}.get(d["required_action"], 180),
            "machineType": {"BCM_DEEP_SCREENING": "BCM", "TRT_RENEWAL": "PQRS",
                            "CSM_TAMPING": "CSM", "DESTRESSING": "UNIMAT",
                            "MANUAL_PACKING": None}.get(d["required_action"]),
        })

    # ---- TDMS / TRD (OHE) ------------------------------------------------
    for d in tdms:
        seg = d["catenary_segment"]
        et = d["electrical_topology"]
        dia = d["contact_wire_diameter_mm"]
        # 107 sqmm grooved contact wire is condemned near 8.25 mm residual.
        condition = max(0.0, min(40.0, (12.24 - dia) * 9.0))
        overdue = min(25.0, d["overdue_days"] * 1.9)
        safety = min(20.0, {"HEAVY_EROSION": 16, "MODERATE": 9, "PITTING": 11,
                            "LIGHT": 4, "NONE": 0}.get(d["sparking_severity"], 6)
                     + (5 if et.get("adjacent_line_isolation_required") else 0))
        expo = exposure_for(d["corridor_id"], seg["from_km"], seg["to_km"], trains)
        exposure = exposure_points(expo, per_corr[d["corridor_id"]])
        raw = condition + overdue + safety + exposure
        score = max(raw, PRIORITY_FLOOR.get(d["priority"], 0) * 0.92)
        ohe_lines = lines_from_tag(et["elementary_section_no"],
                                   et.get("adjacent_line_isolation_required"))
        spark_pts = {"HEAVY_EROSION": 16, "MODERATE": 9, "PITTING": 11,
                     "LIGHT": 4, "NONE": 0}.get(d["sparking_severity"], 6)
        drivers = [
            {"k": "Contact wire dia", "v": "%.1f mm" % dia, "part": "condition",
             "pts": r(condition, 1)},
            {"k": "Sparking", "v": d["sparking_severity"].replace("_", " ").title(),
             "part": "safety", "pts": r(min(spark_pts, 20), 1)},
            {"k": "Adjacent line isolation",
             "v": "Required" if et.get("adjacent_line_isolation_required") else "No",
             "part": "safety", "pts": 5 if et.get("adjacent_line_isolation_required") else 0},
            {"k": "Days overdue", "v": "%d d" % d["overdue_days"], "part": "overdue",
             "pts": r(overdue, 1)},
            {"k": "Traffic under OHE", "v": "%d trains/day" % expo,
             "part": "exposure", "pts": r(exposure, 1)},
        ]
        rows.append({
            "id": d["demand_id"],
            "dept": "TDMS",
            "deptFull": "TRD / Electrical OHE",
            "corridor": d["corridor_id"],
            "line": "OHE " + "/".join(l.replace("_MAIN", "") for l in ohe_lines),
            "lines": ohe_lines,
            "fromKm": seg["from_km"], "toKm": seg["to_km"],
            "chainage": "KM %.2f - %.2f" % (seg["from_km"], seg["to_km"]),
            "telemetry": "CW %.1f mm" % dia,
            "telemetryDetail": [
                ["Contact wire dia", "%.1f mm" % dia],
                ["Stagger deviation", "%.0f mm" % d["stagger_deviation_mm"]],
                ["Sparking", d["sparking_severity"].replace("_", " ").title()],
                ["Elementary section", et["elementary_section_no"]],
                ["Feeding post", et["feeding_post_id"]],
                ["Sub-sectioning post", et["sub_sectioning_post_id"]],
                ["Isolators to open", ", ".join(et["isolator_switches_to_open"])],
                ["Adjacent line isolation",
                 "REQUIRED" if et.get("adjacent_line_isolation_required") else "Not required"],
                ["Sub-division", seg.get("sub_division", "")],
            ],
            "action": d["power_block_type"],
            "overdueDays": d["overdue_days"],
            "priority": d["priority"],
            "score": r(min(100.0, score), 1),
            "parts": {"condition": r(condition, 1), "overdue": r(overdue, 1),
                      "safety": r(safety, 1), "exposure": r(exposure, 1)},
            "drivers": drivers,
            "trainsOver": expo,
            "durationMin": 180,
            "machineType": "TW",
            "isolation": et["elementary_section_no"],
            "isolators": et["isolator_switches_to_open"],
        })

    # ---- SMMS / S&T ------------------------------------------------------
    for d in smms:
        km = kmx.get(d["corridor_id"], {}).get(d["station_code"], 0.0)
        throw = d["motor_throw_time_sec"]
        # Point machines should throw in ~3.5-5 s; sluggish throw precedes failure.
        condition = max(0.0, min(40.0, (throw - 3.2) * 15.0))
        health = d["health_status"]
        overdue = {"CRITICAL": 22.0, "DEGRADED": 13.0, "HEALTHY": 3.0}.get(health, 5.0)
        safety = min(20.0, (0 if d["obstruction_test_5mm_passed"] else 14)
                     + min(6, len(d["interlocked_routes_affected"]) * 2))
        expo = exposure_for(d["corridor_id"], km - 0.5, km + 0.5, trains)
        exposure = exposure_points(expo, per_corr[d["corridor_id"]])
        raw = condition + overdue + safety + exposure
        mapped = {"CRITICAL": "CRITICAL", "DEGRADED": "URGENT"}.get(health, "ROUTINE")
        score = max(raw, PRIORITY_FLOOR.get(mapped, 0) * 0.92)
        pt_lines = lines_from_tag(" ".join(d["interlocked_routes_affected"]))
        obstruction_pts = 0 if d["obstruction_test_5mm_passed"] else 14
        drivers = [
            {"k": "Motor throw time", "v": "%.1f s" % throw, "part": "condition",
             "pts": r(condition, 1)},
            {"k": "5 mm obstruction test",
             "v": "PASSED" if d["obstruction_test_5mm_passed"] else "FAILED",
             "part": "safety", "pts": r(obstruction_pts, 1)},
            {"k": "Interlocked routes", "v": "%d affected" % len(d["interlocked_routes_affected"]),
             "part": "safety", "pts": r(min(6, len(d["interlocked_routes_affected"]) * 2), 1)},
            {"k": "Gear health", "v": health, "part": "overdue", "pts": r(overdue, 1)},
            {"k": "Traffic over points", "v": "%d trains/day" % expo,
             "part": "exposure", "pts": r(exposure, 1)},
        ]
        rows.append({
            "id": d["gear_id"],
            "dept": "SMMS",
            "deptFull": "S&T / Signalling",
            "corridor": d["corridor_id"],
            "line": "POINTS " + "/".join(l.replace("_MAIN", "") for l in pt_lines),
            "lines": pt_lines,
            "fromKm": km, "toKm": km,
            "chainage": "%s (KM %.1f)" % (d["station_code"], km),
            "station": d["station_code"],
            "telemetry": "Throw %.1f s" % throw,
            "telemetryDetail": [
                ["Motor throw time", "%.1f s" % throw],
                ["Operating current", "%.1f A" % d["motor_operating_current_amp"]],
                ["Turnout", d["turnout_number"]],
                ["5 mm obstruction test",
                 "PASSED" if d["obstruction_test_5mm_passed"] else "FAILED"],
                ["Disconnection notice",
                 "Required" if d["disconnection_notice_required"] else "Not required"],
                ["Memo no.", d.get("disconnection_memo_no", "-")],
                ["Routes affected", ", ".join(d["interlocked_routes_affected"])],
                ["Station", "%s - %s" % (d["station_code"], d["station_name"])],
            ],
            "action": "POINT_MAINTENANCE",
            "overdueDays": 0,
            "priority": mapped,
            "score": r(min(100.0, score), 1),
            "parts": {"condition": r(condition, 1), "overdue": r(overdue, 1),
                      "safety": r(safety, 1), "exposure": r(exposure, 1)},
            "drivers": drivers,
            "trainsOver": expo,
            "durationMin": 120,
            "machineType": None,
            "memo": d.get("disconnection_memo_no", "-"),
            "routes": d["interlocked_routes_affected"],
        })

    for row in rows:
        row["band"] = band(row["score"])
    rows.sort(key=lambda x: -x["score"])
    return rows


# ---------------------------------------------------- conflict engine

def path_enters(train, lo, hi, t0, t1):
    """Does this train occupy chainage [lo,hi] at any time within [t0,t1]?

    Walks consecutive path legs and solves for the time interval during which
    the train is inside the km window, then intersects with the block window.
    """
    pts = train["path"]
    for i in range(len(pts) - 1):
        ta, ka = pts[i]
        tb, kb = pts[i + 1]
        if tb == ta:
            continue
        klo, khi = min(ka, kb), max(ka, kb)
        if khi < lo or klo > hi:
            continue
        # Times at which the leg crosses the two edges of the km window.
        edges = []
        for edge in (lo, hi):
            if klo <= edge <= khi and kb != ka:
                edges.append(ta + (tb - ta) * (edge - ka) / (kb - ka))
        span = [min(ta, tb), max(ta, tb)] if not edges else \
               [max(min(ta, tb), min(edges)), min(max(ta, tb), max(edges))]
        if klo >= lo and khi <= hi:
            span = [min(ta, tb), max(ta, tb)]
        if span[0] <= t1 and span[1] >= t0:
            return True
    return False


def conflicts_for(trains, corridor, lines, lo, hi, t0, t1):
    """Trains blocked by an occupation of the given running line(s).

    A corridor with 3rd/4th lines can absorb traffic on a parallel road, so
    only trains on an occupied line count as hard conflicts. An OHE block that
    needs adjacent-line isolation occupies both roads, hence a list.
    """
    out = []
    for t in trains:
        if t["corridor"] != corridor:
            continue
        if t["line"] not in lines:
            continue
        if path_enters(t, lo, hi, t0, t1):
            out.append(t)
    return out


NIGHT_WINDOWS = [(0, 300), (1380, 1440), (300, 420)]   # 00:00-05:00, 23:00-24:00, then early morning


def choose_window(trains, corridor, lines, lo, hi, duration, probe=None):
    """Scan the day in 10-minute steps and return the best start time.

    A block is only useful if the traffic is clear AND the plant to work it is
    free, so both are scored together: picking a traffic-free slot the tampers
    cannot reach just moves the problem.  Preference order is fewest blocked
    trains, then least unsourced plant, then a night slot (when line blocks are
    conventionally granted), then earliest.
    """
    best = None
    for start in range(0, DAY_MINUTES - duration, 10):
        end = start + duration
        night = any(start >= a and end <= b for a, b in NIGHT_WINDOWS)
        c = conflicts_for(trains, corridor, lines, lo, hi, start, end)
        short = len(probe(start, end)) if probe else 0
        key = (len(c), short, 0 if night else 1, start)
        if best is None or key < best[0]:
            best = (key, start, c)
        if len(c) == 0 and short == 0 and night:
            break
    return best[1], best[2]


# ----------------------------------------------------- machine allocation

def build_machines(tmms, kmx, corridors):
    out = []
    for m in tmms:
        depot = m["base_depot"]
        loc = m["current_stabling_location"]
        # Locate the depot on whichever corridor carries that station.
        corr, km = None, None
        for c in corridors:
            for s in c["stations"]:
                if s["code"] == loc.get("station_code", depot):
                    corr, km = c["id"], s["km"]
                    break
            if corr:
                break
        crew = m["crew_hoer_state"]
        out.append({
            "id": m["machine_id"],
            "type": m["machine_type"],
            "model": m["machine_model"],
            "fitness": m["fitness_certificate"]["status"],
            "pohDue": m["fitness_certificate"]["poh_due_date"],
            "iohDue": m["fitness_certificate"]["ioh_due_date"],
            "depot": depot,
            "station": loc.get("station_code", depot),
            "siding": loc.get("siding_id", ""),
            "freeRunout": loc.get("has_free_runout_exit", False),
            "corridor": corr or m.get("corridor_assignment"),
            "km": km if km is not None else 0.0,
            "assigned": m.get("corridor_assignment"),
            "tineWear": m["wear_and_consumables"]["tamping_tine_wear_percent"],
            "fuel": m["wear_and_consumables"]["hsd_fuel_litres"],
            "crewId": crew["crew_id"],
            "dutyHours": crew["continuous_duty_hours"],
            "maxHours": crew["max_permissible_hours"],
            "rest": crew["rest_status"],
            "maxSpeed": m["max_operating_speed_kmph"],
            "transitSpeed": m["kinematics"]["transit_speed_kmph"],
            "workingSpeed": m["kinematics"]["working_speed_kmph"],
            "rampIn": m["kinematics"]["ramp_in_minutes"],
            "rampOut": m["kinematics"]["ramp_out_minutes"],
        })
    return out


def plan_machines(machines, needs, corridor, site_km, busy, spent, start, end, commit):
    """Source the plant a block needs for one specific window.

    A machine is a reusable resource, not a one-shot token: it is unavailable
    only while committed to an overlapping possession (including transit and
    ramp), and only until its crew runs out of HOER hours.  Runs as a dry probe
    while the planner is comparing candidate windows, then again with
    commit=True once a window is chosen.

    Returns (allocations, shortfall) where shortfall lists machine types that
    could not be sourced for this window at all.
    """
    local_busy = {}          # provisional holds within this one block
    picks, shortfall = [], []

    for mtype, task in needs:
        within, relief = [], []
        for m in machines:
            if m["type"] != mtype or m["fitness"] != "FIT":
                continue
            same = 0 if m["corridor"] == corridor else 1
            dist = abs(m["km"] - site_km) if same == 0 else 60.0
            transit = int(round((dist / max(m["transitSpeed"], 1.0)) * 60))
            # Occupied from leaving the siding until it is clear of the site.
            occ0 = start - transit - m["rampIn"]
            occ1 = end + m["rampOut"] + transit
            windows = busy.get(m["id"], []) + local_busy.get(m["id"], [])
            if any(occ0 < b1 and occ1 > b0 for b0, b1 in windows):
                continue
            hours = (occ1 - occ0) / 60.0
            # Headroom left for this crew today, after the hours already worked
            # and anything this machine is committed to earlier in the plan.
            remain = m["maxHours"] - m["dutyHours"] - spent.get(m["id"], 0.0)
            row = (same, dist, transit, hours, occ0, occ1, m, remain)
            # A long possession plus transit routinely outruns what the crew on
            # duty has left under HOER. That does not make the machine
            # unavailable — it makes it a crew-relief job, which is the
            # controller's call, so surface it rather than hiding the machine.
            if hours <= remain:
                within.append(row)
            else:
                relief.append(row)

        pool = within or relief
        if not pool:
            shortfall.append(mtype)
            continue
        pool.sort(key=lambda x: (x[0], x[1]))
        same, dist, transit, hours, occ0, occ1, m, remain = pool[0]
        local_busy.setdefault(m["id"], []).append((occ0, occ1))
        picks.append((m, transit, hours, occ0, occ1, task, not within, remain))

    if commit:
        for m, transit, hours, occ0, occ1, task, _relief, _remain in picks:
            busy.setdefault(m["id"], []).append((occ0, occ1))
            spent[m["id"]] = spent.get(m["id"], 0.0) + hours

    return picks, shortfall


def bundle_demands(queue):
    """Group demands that a single line block could clear together.

    Two demands bundle when they share a corridor and line and their chainages
    are within 6 km - the same possession, the same isolation, one set of
    protection. This is the 'bundling' a controller does by hand.
    """
    groups = []
    for d in sorted(queue, key=lambda x: -x["score"]):
        placed = False
        for g in groups:
            if g["corridor"] != d["corridor"]:
                continue
            if g["lines"] != d["lines"]:
                continue
            if min(abs(d["fromKm"] - g["hi"]), abs(g["lo"] - d["toKm"]),
                   abs(d["fromKm"] - g["lo"]), abs(d["toKm"] - g["hi"])) > 6.0:
                continue
            g["items"].append(d)
            g["lo"] = min(g["lo"], d["fromKm"], d["toKm"])
            g["hi"] = max(g["hi"], d["fromKm"], d["toKm"])
            placed = True
            break
        if not placed:
            groups.append({
                "corridor": d["corridor"], "line": d["line"], "lines": d["lines"],
                "lo": min(d["fromKm"], d["toKm"]), "hi": max(d["fromKm"], d["toKm"]),
                "items": [d],
            })
    return groups


# ---------------------------------------------------- window composition

# A block window is not just the work. Protection has to be set and withdrawn,
# OHE has to be earthed and de-earthed, and plant has to ramp on and off the
# section. Controllers grant the *window*; gangs get the *work time*.
PROTECTION_MIN = 10          # setting, then withdrawing, line-block protection
EARTHING_MIN = 15            # OHE earthing, and again for de-earthing

# Ramp on/off the section, by machine type (TMMS kinematics).
RAMP_BY_TYPE = {
    "CSM": (15, 15), "BCM": (20, 20), "TW": (10, 10),
    "PQRS": (30, 30), "UNIMAT": (15, 15),
}

# Track work leaves the bed unconsolidated: a temporary speed restriction
# stays until it settles. (speed kmph, hours in force)
POST_TSR = {
    "BCM_DEEP_SCREENING": (20, 72),
    "TRT_RENEWAL": (20, 72),
    "CSM_TAMPING": (30, 24),
    "DESTRESSING": (45, 24),
    "MANUAL_PACKING": (45, 12),
}

MORNING_PEAK = (360, 660)    # 06:00 - 11:00


def window_parts(items):
    """Split a bundle into physical work time and the overheads around it."""
    work = max(i["durationMin"] for i in items)
    work += int(sum(i["durationMin"] for i in items[1:]) * 0.55)
    work = max(60, min(work, 240))

    protection = 2 * PROTECTION_MIN
    earthing = 2 * EARTHING_MIN if any(i["dept"] == "TDMS" for i in items) else 0

    ramp = 0
    for i in items:
        mt = i.get("machineType")
        if mt and mt in RAMP_BY_TYPE:
            ramp = max(ramp, sum(RAMP_BY_TYPE[mt]))

    return {
        "workMin": work,
        "protectionMin": protection,
        "earthingMin": earthing,
        "rampMin": ramp,
        "totalMin": work + protection + earthing + ramp,
    }


def independent_cost(items):
    """What these tasks would cost as separate possessions — the baseline the
    bundling saving is measured against."""
    total = 0
    for i in items:
        own = i["durationMin"] + 2 * PROTECTION_MIN
        if i["dept"] == "TDMS":
            own += 2 * EARTHING_MIN
        mt = i.get("machineType")
        if mt and mt in RAMP_BY_TYPE:
            own += sum(RAMP_BY_TYPE[mt])
        total += own
    return total


def post_work_tsr(items, lo, hi, trains, lines, corridor, max_speed):
    """The speed restriction the work leaves behind, and what it costs the
    next morning peak."""
    worst = None
    for i in items:
        t = POST_TSR.get(i["action"])
        if t and (worst is None or t[0] < worst[0]):
            worst = t
    if not worst:
        return None

    speed, hours = worst
    length = max(0.5, hi - lo)
    per_train = (length / float(speed) - length / float(max_speed)) * 60.0

    peak = 0
    for t in trains:
        if t["kind"] != "PASSENGER" or t["corridor"] != corridor:
            continue
        if t["line"] not in lines:
            continue
        if path_enters(t, lo, hi, MORNING_PEAK[0], MORNING_PEAK[1]):
            peak += 1

    return {
        "speed": speed,
        "hours": hours,
        "lengthKm": r(length, 2),
        "normalSpeed": max_speed,
        "addedMinPerTrain": r(per_train, 1),
        "peakTrains": peak,
        "totalAddedMin": r(per_train * peak, 1),
    }


def regulate_freight(looped, corr, lo, hi):
    """Put each held rake in a loop that can actually take it.

    A loop only holds a rake if its clear standing room exceeds the rake
    length plus signal overlap — a 700 m loop takes a 680 m rake, a 600 m one
    does not, and that rake has to be delayed on the main line instead.
    """
    loops = [s for s in corr["stations"] if s.get("loop")]
    out = []
    for t in looped:
        need = (t.get("lengthM") or 0) + 30.0        # rake + overlap
        fits = [s for s in loops if s.get("loopCsr", 0) >= need]
        fits.sort(key=lambda s: min(abs(s["km"] - lo), abs(s["km"] - hi)))
        chosen = fits[0] if fits else None
        out.append({
            "rake": t["no"],
            "lengthM": t.get("lengthM"),
            "tonnage": t.get("tonnage"),
            "loop": chosen["code"] if chosen else None,
            "loopCsr": chosen.get("loopCsr") if chosen else None,
            "fits": bool(chosen),
        })
    return out


def reason_codes(p_lines, corridor, lo, hi, start, end, conflicting, looped,
                 regulation, allocated, shortfall, trains, weather):
    """Structured operational justifications for refusing a block.

    A Section Controller cannot reject an engineering demand on a whim — the
    refusal goes in the register with a reason. These are generated from the
    actual state of this block so the audit trail is specific.
    """
    out = []

    # Precedence: the highest-priority train that would be held.
    near = []
    for t in trains:
        if t["kind"] != "PASSENGER" or t["corridor"] != corridor:
            continue
        if t["line"] not in p_lines:
            continue
        if path_enters(t, lo, hi, start - 90, end + 90):
            near.append(t)
    near.sort(key=lambda t: (t["rank"], t["entry"]))
    if near:
        top = near[0]
        out.append({
            "code": "PRECEDENCE",
            "label": "Precedence to %s %s" % (top["name"], top["no"]),
            "detail": "%s %s runs this section at %s; the block cannot hold a "
                      "rank-%d path." % (top["name"], top["no"],
                                         fmt_hhmm(top["entry"]), top["rank"]),
        })

    if len([x for x in regulation if not x["fits"]]):
        bad = [x for x in regulation if not x["fits"]]
        out.append({
            "code": "LOOP_CAPACITY",
            "label": "Insufficient loop standing room",
            "detail": "%s cannot be accommodated in any loop on this corridor "
                      "(rake exceeds available CSR); it would stand on the "
                      "main line." % ", ".join(x["rake"] for x in bad),
        })

    if len(looped) >= 2:
        out.append({
            "code": "FREIGHT_CONGESTION",
            "label": "Severe freight congestion",
            "detail": "%d rake(s) would need regulation into loops during this "
                      "window." % len(looped),
        })

    if any(t["cls"] == "SUBURBAN" for t in near):
        emu = [t for t in near if t["cls"] == "SUBURBAN"][0]
        out.append({
            "code": "RAKE_TURNAROUND",
            "label": "Connecting rake turnaround risk",
            "detail": "EMU %s works a return path; holding it puts the "
                      "turnaround at risk." % emu["no"],
        })

    if any(m["crewRelief"] for m in allocated):
        m = [x for x in allocated if x["crewRelief"]][0]
        out.append({
            "code": "CREW_HOER",
            "label": "Crew HOER expiry",
            "detail": "%s crew %s has %.1f h left against a %.1f h engagement; "
                      "no relief booked." % (m["id"], m["crew"],
                                             m["crewRemainingHours"], m["engagedHours"]),
        })

    if shortfall:
        out.append({
            "code": "PLANT_UNAVAILABLE",
            "label": "Plant unavailable",
            "detail": "%s could not be sourced for this window." %
                      ", ".join(sorted(set(shortfall))),
        })

    # Rail temperature at the start of the block.
    wx = weather.get(corridor)
    if wx:
        hr = wx["hours"][min(23, int(start // 60))]
        if hr and not hr["safeTamp"]:
            out.append({
                "code": "WEATHER",
                "label": "Rail temperature outside tamping envelope",
                "detail": "Rail %.1f C against envelope %.0f-%.0f C at block "
                          "start." % (hr["rail"], hr["minMax"][0], hr["minMax"][1]),
            })

    out.append({
        "code": "DEFER",
        "label": "Defer to next available night",
        "detail": "No operational objection to the work; the slot is deferred "
                  "to the next traffic-free window.",
    })
    return out


# ------------------------------------------------------- block proposals

def build_proposals(queue, trains, machines, corridors, kmx, weather):
    by_id = {c["id"]: c for c in corridors}
    groups = bundle_demands(queue)
    # Only propose blocks worth a possession: sort by the value they release.
    groups.sort(key=lambda g: -sum(x["score"] for x in g["items"]))
    proposals = []
    busy = {}      # machine_id -> [(occupied_from, occupied_to)] in division minutes
    spent = {}     # machine_id -> hours already committed this day
    seq = 0

    for g in groups[:14]:
        items = sorted(g["items"], key=lambda x: -x["score"])[:4]
        corr = by_id[g["corridor"]]
        lo, hi = g["lo"], g["hi"]
        if hi - lo < 0.4:
            hi = lo + 0.4

        parts = window_parts(items)
        duration = parts["totalMin"]

        # What plant this bundle needs, so the window can be chosen around it.
        needs = [(i["machineType"], i["action"]) for i in items if i.get("machineType")]

        def probe(s0, s1, _needs=needs, _lo=lo):
            return plan_machines(machines, _needs, g["corridor"], _lo,
                                 busy, spent, s0, s1, commit=False)[1]

        start, conflicting = choose_window(trains, g["corridor"], g["lines"],
                                           lo, hi, duration, probe)
        end = start + duration

        picks, shortfall = plan_machines(machines, needs, g["corridor"], lo,
                                         busy, spent, start, end, commit=True)
        allocated = []
        for m, transit, hours, _o0, _o1, task, needs_relief, remain in picks:
            allocated.append({
                "id": m["id"], "type": m["type"], "model": m["model"],
                "depot": m["depot"], "from": m["station"], "siding": m["siding"],
                "transitMin": transit, "rampIn": m["rampIn"], "rampOut": m["rampOut"],
                "crew": m["crewId"], "dutyHours": m["dutyHours"], "maxHours": m["maxHours"],
                "engagedHours": r(hours, 1), "crewRelief": bool(needs_relief),
                "crewRemainingHours": r(max(0.0, remain), 1),
                "fuel": m["fuel"], "task": task,
                "reportBy": fmt_hhmm(start - transit - m["rampIn"]),
            })

        # Impact: passenger delay induced, freight regulated into loops.
        pax_hit = [t for t in conflicting if t["kind"] == "PASSENGER"]
        looped = []
        for t in trains:
            if t["kind"] != "FREIGHT" or t["corridor"] != g["corridor"]:
                continue
            if t["line"] not in g["lines"]:
                continue
            if path_enters(t, lo, hi, start, end) and t.get("canLoop"):
                looped.append(t)

        regulation = regulate_freight(looped, corr, lo, hi)

        pax_delay = 0
        for t in pax_hit:
            pax_delay += max(0, int(end - t["entry"]) if t["entry"] < end else 0)
        # Shadow bundling: demands we are NOT clearing that could ride along in
        # this same possession at marginal cost - the controller decides.
        shadow = []
        for d in queue:
            if d["id"] in [i["id"] for i in items]:
                continue
            if d["corridor"] != g["corridor"]:
                continue
            if not set(d["lines"]) & set(g["lines"]):
                continue
            gap = min(abs(d["fromKm"] - hi), abs(lo - d["toKm"]),
                      abs(d["fromKm"] - lo), abs(d["toKm"] - hi))
            if gap <= 12.0:
                shadow.append({
                    "id": d["id"], "dept": d["dept"], "score": d["score"],
                    "action": d["action"], "chainage": d["chainage"],
                    "gapKm": r(gap, 1),
                    "addMin": int(d["durationMin"] * 0.5),
                    "note": "Same possession, +%d min, no extra protection" % int(d["durationMin"] * 0.5),
                })
        shadow.sort(key=lambda x: -x["score"])
        shadow = shadow[:3]

        isolation = next((i.get("isolation") for i in items if i.get("isolation")), None)
        memo = next((i.get("memo") for i in items if i.get("memo")), None)
        indep = independent_cost(items)
        tsr_after = post_work_tsr(items, lo, hi, trains, g["lines"],
                                  g["corridor"], corr["maxSpeed"])
        seq += 1
        sec = section_name(corr, lo, hi)
        proposals.append({
            "id": "BLK-%s-%03d" % (g["corridor"].replace("CORR_", "")[:1], seq),
            "corridor": g["corridor"],
            "corridorName": corr["name"],
            "line": g["line"],
            "lines": g["lines"],
            "loKm": r(lo, 2), "hiKm": r(hi, 2),
            "section": sec,
            "start": start, "end": end, "duration": duration,
            "startStr": fmt_hhmm(start), "endStr": fmt_hhmm(end),
            "window": {
                "workMin": parts["workMin"],
                "protectionMin": parts["protectionMin"],
                "earthingMin": parts["earthingMin"],
                "rampMin": parts["rampMin"],
                "totalMin": parts["totalMin"],
                "workStart": start + parts["protectionMin"] // 2 +
                             parts["earthingMin"] // 2 + parts["rampMin"] // 2,
            },
            "savings": {
                "independentMin": indep,
                "bundledMin": duration,
                "savedMin": max(0, indep - duration),
                "tasks": len(items),
                "depts": sorted(set(i["dept"] for i in items)),
            },
            "postTsr": tsr_after,
            "items": [{"id": i["id"], "dept": i["dept"], "action": i["action"],
                       "score": i["score"], "chainage": i["chainage"],
                       "durationMin": i["durationMin"], "band": i["band"],
                       "telemetry": i["telemetry"], "overdueDays": i["overdueDays"],
                       "drivers": i["drivers"]}
                      for i in items],
            "machines": allocated,
            "plantShortfall": shortfall,
            "isolation": isolation,
            "isolators": next((i.get("isolators") for i in items if i.get("isolators")), []),
            "memo": memo,
            "routes": next((i.get("routes") for i in items if i.get("routes")), []),
            "impact": {
                "paxDelayMin": pax_delay,
                "paxAffected": len(pax_hit),
                "freightLooped": len(looped),
                "freightIds": [t["no"] for t in looped],
                "backlogCleared": len(items),
                "scoreReleased": r(sum(i["score"] for i in items), 1),
                "overdueDaysCleared": sum(i["overdueDays"] for i in items),
                "conflictTrains": [{"no": t["no"], "name": t["name"], "cls": t["cls"]}
                                   for t in conflicting[:6]],
            },
            "regulation": regulation,
            "reasons": [],
            "shadow": shadow,
            "status": "PENDING",
            "score": r(sum(i["score"] for i in items) / len(items), 1),
        })

        proposals[-1]["reasons"] = reason_codes(
            g["lines"], g["corridor"], lo, hi, start, end, conflicting, looped,
            regulation, allocated, shortfall, trains, weather)

    proposals.sort(key=lambda p: (-p["score"], p["start"]))
    return proposals


def section_name(corr, lo, hi):
    """Nearest station pair enclosing the chainage - how a block is named."""
    stns = sorted(corr["stations"], key=lambda s: s["km"])
    a = stns[0]["code"]
    b = stns[-1]["code"]
    for s in stns:
        if s["km"] <= lo:
            a = s["code"]
    for s in reversed(stns):
        if s["km"] >= hi:
            b = s["code"]
    return "%s - %s" % (a, b)


# ------------------------------------------------------ weather + TSR

def build_weather(crt):
    """Rail temperature per corridor per hour, plus the minute-resolution curve
    the banner sweeps through as the division clock runs."""
    per = defaultdict(dict)
    probes = {}
    curves = {}
    for w in crt:
        cid = w["corridor_id"]
        hour = w["hour"]
        # CRT repeats the same full-day minute curve in all 24 hourly records.
        # Keep exactly one copy per corridor - it is ~675 KB of duplication.
        if cid not in curves:
            curves[cid] = [r(x, 1) for x in w.get("minute_temperature_curve", [])]
        per[cid][hour] = {
            "amb": r(w["ambient_temp_celsius"], 1),
            "rail": r(w["rail_temp_celsius"], 1),
            "dest": r(w["de_stressing_temp_celsius"], 1),
            "minMax": [w["safe_tamping_envelope"]["min_temp"],
                       w["safe_tamping_envelope"]["max_temp"]],
            "buckle": w["track_buckling_warning"],
            "safeTamp": w["safe_for_tamping"],
            "rain": r(w["precipitation_rate_mm_hr"], 1),
            "wind": r(w["wind_velocity_kmph"], 1),
        }
        probes[cid] = {"probe": w["sensor_probe_id"], "station": w["station_code"]}
    out = {}
    for cid, hours in per.items():
        out[cid] = {
            "probe": probes[cid]["probe"],
            "station": probes[cid]["station"],
            "curve": curves.get(cid, []),
            "hours": [hours.get(h) for h in range(24)],
        }
    return out


def build_tsr(icms, kmx):
    out = []
    for t in icms:
        ch = t["chainage"]
        out.append({
            "no": t["caution_order_no"],
            "corridor": t["corridor_id"],
            "from": t["station_section"]["from_station"],
            "to": t["station_section"]["to_station"],
            "fromKm": ch["from_km"], "toKm": ch["to_km"],
            "line": ch["line"],
            "speed": t["restricted_speed_kmph"],
            "normal": t["normal_sectional_speed_kmph"],
            "reason": t["imposition_reason"].replace("_", " ").title(),
            "imposed": t["imposition_date"],
            "removal": t["estimated_removal_date"],
            "lossMin": r(((ch["to_km"] - ch["from_km"]) / max(t["restricted_speed_kmph"], 1)
                          - (ch["to_km"] - ch["from_km"]) / max(t["normal_sectional_speed_kmph"], 1)) * 60, 1),
        })
    out.sort(key=lambda x: x["speed"])
    return out


# ------------------------------------------------------------ punctuality

def build_metrics(trains, queue, machines, tsr):
    pax = [t for t in trains if t["kind"] == "PASSENGER"]
    # Indian Railways counts a train punctual if it runs within 15 minutes.
    ontime = [t for t in pax if t["delay"] <= 15]
    per_corr = {}
    for t in pax:
        c = per_corr.setdefault(t["corridor"], {"n": 0, "ok": 0, "delay": 0})
        c["n"] += 1
        c["ok"] += 1 if t["delay"] <= 15 else 0
        c["delay"] += t["delay"]
    for c in per_corr.values():
        c["pct"] = r(100.0 * c["ok"] / c["n"], 1) if c["n"] else 100.0
        c["avgDelay"] = r(c["delay"] / c["n"], 1) if c["n"] else 0.0

    per_cls = defaultdict(lambda: {"n": 0, "ok": 0, "delay": 0})
    for t in pax:
        k = per_cls[t["cls"]]
        k["n"] += 1
        k["ok"] += 1 if t["delay"] <= 15 else 0
        k["delay"] += t["delay"]
    for k in per_cls.values():
        k["pct"] = r(100.0 * k["ok"] / k["n"], 1) if k["n"] else 100.0
        k["avgDelay"] = r(k["delay"] / k["n"], 1) if k["n"] else 0.0

    backlog = defaultdict(lambda: {"n": 0, "critical": 0, "overdue": 0})
    for q in queue:
        b = backlog[q["dept"]]
        b["n"] += 1
        b["critical"] += 1 if q["band"] == "CRITICAL" else 0
        b["overdue"] += q["overdueDays"]

    return {
        "punctuality": r(100.0 * len(ontime) / len(pax), 1) if pax else 100.0,
        "trainsRun": len(pax),
        "trainsOnTime": len(ontime),
        "avgDelay": r(sum(t["delay"] for t in pax) / len(pax), 1) if pax else 0.0,
        "maxDelay": max((t["delay"] for t in pax), default=0),
        "freightRakes": len([t for t in trains if t["kind"] == "FREIGHT"]),
        "byCorridor": per_corr,
        "byClass": dict(per_cls),
        "backlog": dict(backlog),
        "tsrCount": len(tsr),
        "machinesFit": len([m for m in machines if m["fitness"] == "FIT"]),
        "machinesTotal": len(machines),
    }


# ------------------------------------------------------------------ main

def generate_bundle(sim_dir=None):
    base_sim = sim_dir if sim_dir else SIM
    
    def _load(name):
        with open(os.path.join(base_sim, name), "r", encoding="utf-8") as fh:
            return json.load(fh)

    topo = _load("network_topology.json")
    corridors = build_corridors(topo)
    kmx = km_index(corridors)

    coa = _load("coa_passenger_streams.json")
    fois = _load("fois_freight_manifests.json")
    trains = build_passenger(coa, kmx) + build_freight(fois, kmx, corridors)

    tms = _load("tms_track_defects.json")
    tdms = _load("tdms_catenary_health.json")
    smms = _load("smms_signalling_gears.json")
    tmms = _load("tmms_machine_inventory.json")
    icms = _load("icms_speed_restrictions.json")
    crt = _load("crt_weather_telemetry.json")

    machines = build_machines(tmms, kmx, corridors)
    queue = build_queue(tms, tdms, smms, kmx, trains)
    weather = build_weather(crt)
    proposals = build_proposals(queue, trains, machines, corridors, kmx, weather)
    tsr = build_tsr(icms, kmx)
    metrics = build_metrics(trains, queue, machines, tsr)

    return {
        "meta": {
            "division": topo["metadata"]["division"],
            "zone": topo["metadata"]["zone"],
            "date": topo["metadata"]["generated_at"][:10],
            "generatedAt": topo["metadata"]["generated_at"],
            "source": "RailSync SIMULATOR (COA / FOIS / TMS / TDMS / SMMS / TMMS / ICMS / CRT)",
        },
        "corridors": corridors,
        "trains": trains,
        "queue": queue,
        "proposals": proposals,
        "machines": machines,
        "tsr": tsr,
        "weather": weather,
        "metrics": metrics,
    }


def main():
    bundle = generate_bundle()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = json.dumps(bundle, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* Generated by build_data.py from ../SIMULATOR/data - do not edit by hand. */\n")
        fh.write("window.RAILSYNC_DATA=")
        fh.write(payload)
        fh.write(";\n")

    print("Wrote %s (%.1f KB)" % (OUT, len(payload) / 1024.0))
    print("  corridors  : %d" % len(corridors))
    print("  trains     : %d passenger + %d freight"
          % (len([t for t in trains if t["kind"] == "PASSENGER"]),
             len([t for t in trains if t["kind"] == "FREIGHT"])))
    print("  demands    : %d  (critical %d)"
          % (len(queue), len([q for q in queue if q["band"] == "CRITICAL"])))
    print("  proposals  : %d" % len(proposals))
    zero = len([p for p in proposals if p["impact"]["paxDelayMin"] == 0])
    print("  zero-delay : %d / %d" % (zero, len(proposals)))
    print("  punctuality: %.1f%%" % metrics["punctuality"])
    print("  TSR active : %d" % len(tsr))


if __name__ == "__main__":
    main()
