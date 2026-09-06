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
    data = generate_network_topology()
    corridors = data["corridors"]
    
    idx = 0
    while True:
        corr = corridors[idx % len(corridors)]
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] 🌐 CORRIDOR: {corr['corridor_id']:<12} | Name: {corr['corridor_name']} | Length: {corr['total_length_km']} KM | Max Speed: {corr['max_speed_kmph']} km/h")
        for stn in corr["stations"][:4]:
            print(f"       📍 Station {stn['station_code']} (KM {stn['km_marker']}) - Loop: {stn.get('has_platform_loop', False)} | Platforms: {stn.get('platforms', 1)}")
        idx += 1
        time.sleep(interval)


def stream_tms(interval=1.0):
    print("\n" + "=" * 70)
    print("  🛠️ [LIVE SIMULATOR] SIM_TMS — P-Way Track Defects & USFD Monitor")
    print("=" * 70 + "\n")
    defects = generate_tms_defects()
    
    idx = 0
    while True:
        d = defects[idx % len(defects)]
        ts = datetime.now().strftime("%H:%M:%S")
        tgi = d["tgi_breakdown"]
        flaw = d["usfd_flaw"]["flaw_code"]
        ballast = d["ballast_cushion_depth_mm"]
        print(f"[{ts}] 🔍 {d['inspection_id']:<18} | {d['corridor_id']} [{d['track_id']}] KM {d['chainage']['from_km']} -> {d['chainage']['to_km']}")
        print(f"       UI={tgi['ui']:.0f}  TI={tgi['ti']:.0f}  GI={tgi['gi']:.0f}  AI={tgi['ai']:.0f}  TGI={tgi['composite_tgi']:.1f} | USFD: {flaw} | Ballast: {ballast}mm")
        idx += 1
        time.sleep(interval)


def stream_tdms(interval=1.0):
    print("\n" + "=" * 70)
    print("  ⚡ [LIVE SIMULATOR] SIM_TDMS — TRD OHE Catenary Health & Power Demands")
    print("=" * 70 + "\n")
    demands = generate_tdms_demands()
    
    idx = 0
    while True:
        item = demands[idx % len(demands)]
        ts = datetime.now().strftime("%H:%M:%S")
        wire_dia = item["contact_wire_diameter_mm"]
        stagger = item["stagger_deviation_mm"]
        sec = item["electrical_topology"]["elementary_section_no"]
        seg = item["catenary_segment"]
        print(f"[{ts}] ⚡ SECT {sec:<14} | {item['corridor_id']} KM {seg['from_km']} -> {seg['to_km']}")
        print(f"       Wire Dia: {wire_dia:.1f}mm | Stagger Dev: {stagger:.1f}mm | Sub-Div: {seg['sub_division']}")
        idx += 1
        time.sleep(interval)


def stream_smms(interval=1.0):
    print("\n" + "=" * 70)
    print("  🚦 [LIVE SIMULATOR] SIM_SMMS — Signalling Maintenance & Point Machines")
    print("=" * 70 + "\n")
    gears = generate_smms_gears()
    
    idx = 0
    while True:
        g = gears[idx % len(gears)]
        ts = datetime.now().strftime("%H:%M:%S")
        turnout = g["turnout_number"]
        throw_time = g["motor_throw_time_sec"]
        current = g["motor_operating_current_amp"]
        obs_test = g["obstruction_test_5mm_passed"]
        print(f"[{ts}] 🚦 GEAR {g['gear_id']:<16} ({turnout}) @ {g['station_code']} ({g['corridor_id']})")
        print(f"       Throw: {throw_time}s | Motor Current: {current}A | 5mm Obstruction Test: {obs_test}")
        idx += 1
        time.sleep(interval)


def stream_tmms(interval=1.2):
    print("\n" + "=" * 70)
    print("  🚜 [LIVE SIMULATOR] SIM_TMMS — Track Machine Fleet & Kinematics")
    print("=" * 70 + "\n")
    machines = generate_tmms_inventory()
    
    idx = 0
    while True:
        m = machines[idx % len(machines)]
        ts = datetime.now().strftime("%H:%M:%S")
        crew = m["crew_hoer_state"]
        wear = m["wear_and_consumables"]
        print(f"[{ts}] 🚜 MACHINE {m['machine_id']} ({m['machine_type']}) Base: {m['base_depot']}")
        print(f"       Tine Wear: {wear['tamping_tine_wear_percent']}% | HSD Fuel: {wear['hsd_fuel_litres']}L | Crew Hours: {crew['continuous_duty_hours']}h/{crew['max_permissible_hours']}h")
        idx += 1
        time.sleep(interval)


def stream_icms(interval=1.0):
    print("\n" + "=" * 70)
    print("  ⚠️ [LIVE SIMULATOR] SIM_ICMS_TSR — Speed Restrictions & Caution Orders")
    print("=" * 70 + "\n")
    tsrs = generate_icms_restrictions()
    
    idx = 0
    while True:
        t = tsrs[idx % len(tsrs)]
        ts = datetime.now().strftime("%H:%M:%S")
        r_speed = t["restricted_speed_kmph"]
        norm_speed = t["normal_sectional_speed_kmph"]
        ch = t["chainage"]
        sec = t["station_section"]
        print(f"[{ts}] ⚠️ TSR #{t['caution_order_no']:<20} | {t['corridor_id']} [{ch['line']}] KM {ch['from_km']} -> {ch['to_km']}")
        print(f"       🛑 Imposed Speed: {r_speed} km/h (Normal: {norm_speed} km/h) | Section: {sec['from_station']}-{sec['to_station']} | Reason: {t['imposition_reason']}")
        idx += 1
        time.sleep(interval)


def stream_crt(interval=0.8):
    print("\n" + "=" * 70)
    print("  🌡️ [LIVE SIMULATOR] SIM_CRT_WEATHER — Continuous Rail Thermometry & Met")
    print("=" * 70 + "\n")
    records = generate_crt_weather()
    
    idx = 0
    while True:
        r = records[idx % len(records)]
        ts = datetime.now().strftime("%H:%M:%S")
        tr = r["rail_temp_celsius"]
        ta = r["ambient_temp_celsius"]
        precip = r["precipitation_rate_mm_hr"]
        wind = r["wind_velocity_kmph"]
        print(f"[{ts}] 🌡️ SENSOR {r['sensor_probe_id']} @ {r['station_code']} ({r['corridor_id']}) Hour {r['hour']:02d}:00")
        print(f"       Ta: {ta:.1f}°C | Tr: {tr:.1f}°C | Rain: {precip:.1f}mm/hr | Wind: {wind:.1f}km/h")
        idx += 1
        time.sleep(interval)


def stream_coa(interval=0.6):
    print("\n" + "=" * 70)
    print("  🚆 [LIVE SIMULATOR] SIM_COA — Passenger Streams & RTIS Real-Time Clock")
    print("=" * 70 + "\n")
    trains = generate_coa_streams()
    
    idx = 0
    while True:
        tr = trains[idx % len(trains)]
        ts = datetime.now().strftime("%H:%M:%S")
        traj = tr["stations_trajectory"]
        first = traj[0]
        last = traj[-1]
        delay = tr["current_delay_minutes"]
        print(f"[{ts}] 🚆 TRAIN {tr['train_no']} ({tr['train_name']}) | {tr['corridor_id']} [{tr['track_id']}] {tr['direction']} | MPS: {tr['max_permissible_speed_kmph']}km/h")
        print(f"       {first['station_code']} dep {first['dep_time_str']} -> {last['station_code']} arr {last['arr_time_str']} | Sched dep: {first['dep_scheduled']//60:02d}:{first['dep_scheduled']%60:02d} | Delay: {delay}min")
        idx += 1
        time.sleep(interval)


def stream_fois(interval=1.0):
    print("\n" + "=" * 70)
    print("  📦 [LIVE SIMULATOR] SIM_FOIS — Freight Operations & Loop Stabling Manifests")
    print("=" * 70 + "\n")
    rakes = generate_fois_manifests()
    
    idx = 0
    while True:
        rk = rakes[idx % len(rakes)]
        ts = datetime.now().strftime("%H:%M:%S")
        cfg = rk["rake_configuration"]
        print(f"[{ts}] 📦 RAKE {rk['rake_id']} | {cfg['wagon_type']} ({rk['commodity_group']}) | {rk['corridor_id']} [{rk['direction']}]")
        print(f"       {rk['origin_station']} -> {rk['destination_station']} | Wagons: {cfg['total_wagons']} | Tonnage: {cfg['gross_tonnage']}T | Length: {cfg['total_length_meters']}m")
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
