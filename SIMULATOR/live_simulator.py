"""
RailSync Live Simulator Runner
==============================
Provides interactive live ticker streams for individual simulators.
Can be run individually or spawned across separate terminal windows.
"""

import sys
import os
import time
import json
import argparse
from datetime import datetime

# Ensure root directory in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
import sqlite3

DATA_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "telemetry.db")
JSON_PATH = os.path.join(DATA_DIR, "live_telemetry.json")

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn

def init_db():
    try:
        conn = get_db()
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS simulator_heartbeat (
                    sim_id TEXT PRIMARY KEY,
                    sim_name TEXT,
                    last_heartbeat REAL,
                    tick_count INTEGER,
                    status TEXT,
                    last_message TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS simulator_state (
                    sim_id TEXT PRIMARY KEY,
                    updated_at TEXT,
                    payload TEXT
                )
            """)
        conn.close()
    except Exception:
        pass

def publish_tick(sim_id, sim_name, tick_count, status, last_message, payload=None):
    try:
        now_ts = time.time()
        now_iso = datetime.now().isoformat()
        conn = get_db()
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO simulator_heartbeat 
                (sim_id, sim_name, last_heartbeat, tick_count, status, last_message)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (sim_id, sim_name, now_ts, tick_count, status, last_message))
            
            if payload is not None:
                conn.execute("""
                    INSERT OR REPLACE INTO simulator_state (sim_id, updated_at, payload)
                    VALUES (?, ?, ?)
                """, (sim_id, now_iso, json.dumps(payload)))
        conn.close()

        # Atomic per-simulator snapshot for zero-lag reading
        per_sim_path = os.path.join(DATA_DIR, f"live_{sim_id}.json")
        tmp_path = per_sim_path + ".tmp"
        snap = {
            "source": sim_id,
            "sim_name": sim_name,
            "timestamp": now_iso,
            "tick": tick_count,
            "status": status,
            "message": last_message,
            "payload": payload
        }
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(snap, f)
        os.replace(tmp_path, per_sim_path)
    except Exception:
        pass

from simulators import (
    generate_network_topology,
    generate_tms_defects,
    generate_tdms_demands,
    generate_smms_gears,
    generate_tmms_inventory,
    generate_icms_restrictions,
    generate_crt_weather,
    generate_coa_streams,
    generate_fois_manifests,
)
from simulators.event_bus import RailSyncEventBusMock


def stream_network(interval=1.5):
    print("\n" + "=" * 70)
    print("  🟢 [LIVE SIMULATOR] SIM_NETWORK — Delhi Division Topology Backbone")
    print("=" * 70 + "\n")
    init_db()
    data = generate_network_topology()
    corridors = data["corridors"]
    
    idx = 0
    while True:
        corr = corridors[idx % len(corridors)]
        ts = datetime.now().strftime("%H:%M:%S")
        msg = f"CORRIDOR: {corr['corridor_id']:<12} | Name: {corr['corridor_name']} | Length: {corr['total_length_km']} KM | Max Speed: {corr['max_speed_kmph']} km/h"
        print(f"[{ts}] 🌐 {msg}")
        for stn in corr["stations"][:4]:
            print(f"       📍 Station {stn['station_code']} (KM {stn['km_marker']}) - Loop: {stn.get('has_platform_loop', False)} | Platforms: {stn.get('platforms', 1)}")
        publish_tick("network", "Network Topology Backbone", idx, "RUNNING", msg, {"corridor_id": corr["corridor_id"], "name": corr["corridor_name"]})
        idx += 1
        time.sleep(interval)


def stream_tms(interval=1.0):
    print("\n" + "=" * 70)
    print("  🛠️ [LIVE SIMULATOR] SIM_TMS — P-Way Track Defects & USFD Monitor")
    print("=" * 70 + "\n")
    init_db()
    defects = generate_tms_defects()
    
    idx = 0
    while True:
        d = defects[idx % len(defects)]
        ts = datetime.now().strftime("%H:%M:%S")
        tgi = d["tgi_breakdown"]
        flaw = d["usfd_flaw"]["flaw_code"]
        ballast = d["ballast_cushion_depth_mm"]
        msg = f"{d['inspection_id']:<18} | {d['corridor_id']} [{d['track_id']}] KM {d['chainage']['from_km']} -> {d['chainage']['to_km']} | TGI: {tgi['composite_tgi']:.1f} | USFD: {flaw}"
        print(f"[{ts}] 🔍 {d['inspection_id']:<18} | {d['corridor_id']} [{d['track_id']}] KM {d['chainage']['from_km']} -> {d['chainage']['to_km']}")
        print(f"       UI={tgi['ui']:.0f}  TI={tgi['ti']:.0f}  GI={tgi['gi']:.0f}  AI={tgi['ai']:.0f}  TGI={tgi['composite_tgi']:.1f} | USFD: {flaw} | Ballast: {ballast}mm")
        publish_tick("tms", "TMS Track Geometry & USFD", idx, "RUNNING", msg, d)
        idx += 1
        time.sleep(interval)


def stream_tdms(interval=1.0):
    print("\n" + "=" * 70)
    print("  ⚡ [LIVE SIMULATOR] SIM_TDMS — TRD OHE Catenary Health & Power Demands")
    print("=" * 70 + "\n")
    init_db()
    demands = generate_tdms_demands()
    
    idx = 0
    while True:
        item = demands[idx % len(demands)]
        ts = datetime.now().strftime("%H:%M:%S")
        wire_dia = item["contact_wire_diameter_mm"]
        stagger = item["stagger_deviation_mm"]
        sec = item["electrical_topology"]["elementary_section_no"]
        seg = item["catenary_segment"]
        msg = f"SECT {sec} | {item['corridor_id']} KM {seg['from_km']}->{seg['to_km']} | Wire: {wire_dia:.1f}mm Stagger: {stagger:.1f}mm"
        print(f"[{ts}] ⚡ SECT {sec:<14} | {item['corridor_id']} KM {seg['from_km']} -> {seg['to_km']}")
        print(f"       Wire Dia: {wire_dia:.1f}mm | Stagger Dev: {stagger:.1f}mm | Sub-Div: {seg['sub_division']}")
        publish_tick("tdms", "TDMS Catenary Telemetry", idx, "RUNNING", msg, item)
        idx += 1
        time.sleep(interval)


def stream_smms(interval=1.0):
    print("\n" + "=" * 70)
    print("  🚦 [LIVE SIMULATOR] SIM_SMMS — Signalling Maintenance & Point Machines")
    print("=" * 70 + "\n")
    init_db()
    gears = generate_smms_gears()
    
    idx = 0
    while True:
        g = gears[idx % len(gears)]
        ts = datetime.now().strftime("%H:%M:%S")
        turnout = g["turnout_number"]
        throw_time = g["motor_throw_time_sec"]
        current = g["motor_operating_current_amp"]
        obs_test = g["obstruction_test_5mm_passed"]
        msg = f"GEAR {g['gear_id']} ({turnout}) @ {g['station_code']} | Throw: {throw_time}s Current: {current}A"
        print(f"[{ts}] 🚦 GEAR {g['gear_id']:<16} ({turnout}) @ {g['station_code']} ({g['corridor_id']})")
        print(f"       Throw: {throw_time}s | Motor Current: {current}A | 5mm Obstruction Test: {obs_test}")
        publish_tick("smms", "SMMS Point Machines", idx, "RUNNING", msg, g)
        idx += 1
        time.sleep(interval)


def stream_tmms(interval=1.2):
    print("\n" + "=" * 70)
    print("  🚜 [LIVE SIMULATOR] SIM_TMMS — Track Machine Fleet & Kinematics")
    print("=" * 70 + "\n")
    init_db()
    machines = generate_tmms_inventory()
    
    idx = 0
    while True:
        m = machines[idx % len(machines)]
        ts = datetime.now().strftime("%H:%M:%S")
        crew = m["crew_hoer_state"]
        wear = m["wear_and_consumables"]
        msg = f"MACHINE {m['machine_id']} ({m['machine_type']}) Base: {m['base_depot']} | Crew: {crew['continuous_duty_hours']:.1f}h / {crew['max_permissible_hours']}h | Tine: {wear['tamping_tine_wear_percent']}%"
        print(f"[{ts}] 🚜 MACHINE {m['machine_id']} ({m['machine_type']}) Base: {m['base_depot']}")
        print(f"       Tine Wear: {wear['tamping_tine_wear_percent']}% | HSD Fuel: {wear['hsd_fuel_litres']}L | Crew Hours: {crew['continuous_duty_hours']}h/{crew['max_permissible_hours']}h")
        publish_tick("tmms", "TMMS Track Machines", idx, "RUNNING", msg, m)
        idx += 1
        time.sleep(interval)


def stream_icms(interval=1.0):
    print("\n" + "=" * 70)
    print("  ⚠️ [LIVE SIMULATOR] SIM_ICMS_TSR — Speed Restrictions & Caution Orders")
    print("=" * 70 + "\n")
    init_db()
    tsrs = generate_icms_restrictions()
    
    idx = 0
    while True:
        t = tsrs[idx % len(tsrs)]
        ts = datetime.now().strftime("%H:%M:%S")
        r_speed = t["restricted_speed_kmph"]
        norm_speed = t["normal_sectional_speed_kmph"]
        ch = t["chainage"]
        sec = t["station_section"]
        msg = f"TSR #{t['caution_order_no']} | {t['corridor_id']} [{ch['line']}] KM {ch['from_km']}->{ch['to_km']} | {r_speed} km/h (Normal: {norm_speed})"
        print(f"[{ts}] ⚠️ TSR #{t['caution_order_no']:<20} | {t['corridor_id']} [{ch['line']}] KM {ch['from_km']} -> {ch['to_km']}")
        print(f"       🛑 Imposed Speed: {r_speed} km/h (Normal: {norm_speed} km/h) | Section: {sec['from_station']}-{sec['to_station']} | Reason: {t['imposition_reason']}")
        publish_tick("icms", "ICMS Speed Restrictions", idx, "RUNNING", msg, t)
        idx += 1
        time.sleep(interval)


def stream_crt(interval=0.8):
    print("\n" + "=" * 70)
    print("  🌡️ [LIVE SIMULATOR] SIM_CRT_WEATHER — Continuous Rail Thermometry & Met")
    print("=" * 70 + "\n")
    init_db()
    records = generate_crt_weather()
    
    idx = 0
    while True:
        r = records[idx % len(records)]
        ts = datetime.now().strftime("%H:%M:%S")
        tr = r["rail_temp_celsius"]
        ta = r["ambient_temp_celsius"]
        precip = r["precipitation_rate_mm_hr"]
        wind = r["wind_velocity_kmph"]
        msg = f"SENSOR {r['sensor_probe_id']} @ {r['station_code']} ({r['corridor_id']}) | Tr: {tr:.1f}°C | Ta: {ta:.1f}°C"
        print(f"[{ts}] 🌡️ SENSOR {r['sensor_probe_id']} @ {r['station_code']} ({r['corridor_id']}) Hour {r['hour']:02d}:00")
        print(f"       Ta: {ta:.1f}°C | Tr: {tr:.1f}°C | Rain: {precip:.1f}mm/hr | Wind: {wind:.1f}km/h")
        publish_tick("crt", "CRT Rail Thermometry", idx, "RUNNING", msg, r)
        idx += 1
        time.sleep(interval)


def stream_coa(interval=0.6):
    print("\n" + "=" * 70)
    print("  🚆 [LIVE SIMULATOR] SIM_COA — Passenger Streams & RTIS Real-Time Clock")
    print("=" * 70 + "\n")
    init_db()
    trains = generate_coa_streams()
    
    idx = 0
    while True:
        tr = trains[idx % len(trains)]
        ts = datetime.now().strftime("%H:%M:%S")
        traj = tr["stations_trajectory"]
        first = traj[0]
        last = traj[-1]
        delay = tr["current_delay_minutes"]
        msg = f"TRAIN {tr['train_no']} ({tr['train_name']}) | {tr['corridor_id']} [{tr['track_id']}] | Delay: {delay}min"
        print(f"[{ts}] 🚆 TRAIN {tr['train_no']} ({tr['train_name']}) | {tr['corridor_id']} [{tr['track_id']}] {tr['direction']} | MPS: {tr['max_permissible_speed_kmph']}km/h")
        print(f"       {first['station_code']} dep {first['dep_time_str']} -> {last['station_code']} arr {last['arr_time_str']} | Sched dep: {first['dep_scheduled']//60:02d}:{first['dep_scheduled']%60:02d} | Delay: {delay}min")
        publish_tick("coa", "COA Passenger Streams", idx, "RUNNING", msg, {
            "train_no": tr["train_no"],
            "train_name": tr["train_name"],
            "corridor_id": tr["corridor_id"],
            "track_id": tr["track_id"],
            "current_delay_minutes": delay,
            "direction": tr["direction"],
            "mps": tr["max_permissible_speed_kmph"]
        })
        idx += 1
        time.sleep(interval)


def stream_fois(interval=1.0):
    print("\n" + "=" * 70)
    print("  📦 [LIVE SIMULATOR] SIM_FOIS — Freight Operations & Loop Stabling Manifests")
    print("=" * 70 + "\n")
    init_db()
    rakes = generate_fois_manifests()
    
    idx = 0
    while True:
        rk = rakes[idx % len(rakes)]
        ts = datetime.now().strftime("%H:%M:%S")
        cfg = rk["rake_configuration"]
        msg = f"RAKE {rk['rake_id']} | {cfg['wagon_type']} ({rk['commodity_group']}) | {rk['origin_station']}->{rk['destination_station']} | {cfg['gross_tonnage']}T"
        print(f"[{ts}] 📦 RAKE {rk['rake_id']} | {cfg['wagon_type']} ({rk['commodity_group']}) | {rk['corridor_id']} [{rk['direction']}]")
        print(f"       {rk['origin_station']} -> {rk['destination_station']} | Wagons: {cfg['total_wagons']} | Tonnage: {cfg['gross_tonnage']}T | Length: {cfg['total_length_meters']}m")
        publish_tick("fois", "FOIS Freight Operations", idx, "RUNNING", msg, rk)
        idx += 1
        time.sleep(interval)


SIMULATORS = {
    "network": ("Network Topology Backbone", stream_network),
    "tms": ("TMS Track Geometry & USFD", stream_tms),
    "tdms": ("TDMS Catenary Wire Telemetry", stream_tdms),
    "smms": ("SMMS Point Machine Telemetry", stream_smms),
    "tmms": ("TMMS Track Machine Inventory", stream_tmms),
    "icms": ("ICMS Speed Restrictions", stream_icms),
    "crt": ("CRT Rail Thermometry & Met", stream_crt),
    "coa": ("COA Passenger Timetable & RTIS", stream_coa),
    "fois": ("FOIS Freight Rake Manifests", stream_fois),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RailSync Live Simulator Streamer")
    parser.add_argument("--sim", choices=list(SIMULATORS.keys()), default="coa", help="Simulator to stream live")
    parser.add_argument("--interval", type=float, default=1.0, help="Refresh interval in seconds")
    args = parser.parse_args()
    
    sim_name, runner_fn = SIMULATORS[args.sim]
    try:
        runner_fn(interval=args.interval)
    except KeyboardInterrupt:
        print(f"\n[Terminated live stream of {sim_name}]")
