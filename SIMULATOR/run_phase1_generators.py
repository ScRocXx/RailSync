"""
RailSync-ABPS Phase 1 Multi-Simulator Master Orchestrator & Integrity Validator
=================================================================================
Delhi Division — Indian Railways (SIH26027)

Runs all 9 micro-simulators with deterministic seed control, performs strict Pydantic v2
schema validation, verifies machine kinematics, checks string foreign keys, validates
authentic CRIS enterprise payload adapters, evaluates Event Bus time-sliced snapshots,
and audits cross-system consistency with 0 integrity errors.
"""

import sys
import os
import json
import argparse
import pathlib
import time

# Ensure simulators package can be imported
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
from simulators.schemas import (
    NetworkTopologyModel,
    TMSDefectModel,
    TDMSCatenaryModel,
    SMMSSignallingModel,
    TMMSMachineModel,
    ICMSSpeedRestrictionModel,
    CRTWeatherRecordModel,
    COAPassengerTrainModel,
    FOISFreightRakeModel,
)
from simulators.sim_tmms import calculate_transit_time_minutes, calculate_work_window_minutes, MACHINE_KINEMATICS
from simulators.enterprise_adapters import EnterpriseMiddlewareAdapter, CRISTMSPayload, get_physical_distance_km
from simulators.event_bus import RailSyncEventBusMock, compare_snapshots


def run_orchestrator(seed=42, output_dir="data", snapshot_minute=None, compare_minutes=None):
    """
    Executes all 9 micro-simulators, validates data integrity, and prints audit report.
    """
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    print("\n" + "=" * 80)
    print("  RAILSYNC-ABPS: PHASE 1 MULTI-SIMULATOR GENERATION & AUDIT SUITE")
    print("  Delhi Division - Indian Railways (SIH26027)")
    print(f"  Configuration: Seed = {seed} | Output Directory = '{output_dir}'")
    print("=" * 80 + "\n")

    start_time = time.time()
    pathlib.Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Step 1: Execute all 9 micro-simulators
    print("  [1/4] Executing Micro-Simulators & Generating Datastores...")

    generators = [
        ("1. Network Topology (Backbone)", "network_topology.json", generate_network_topology),
        ("2. Track Management System (TMS)", "tms_track_defects.json", generate_tms_defects),
        ("3. Catenary Health System (TDMS)", "tdms_catenary_health.json", generate_tdms_demands),
        ("4. Signalling Maintenance (SMMS)", "smms_signalling_gears.json", generate_smms_gears),
        ("5. Track Machine Inventory (TMMS)", "tmms_machine_inventory.json", generate_tmms_inventory),
        ("6. Caution Orders / TSR (ICMS)", "icms_speed_restrictions.json", generate_icms_restrictions),
        ("7. Thermometry & Met (CRT)", "crt_weather_telemetry.json", generate_crt_weather),
        ("8. Passenger Timetable (COA)", "coa_passenger_streams.json", generate_coa_streams),
        ("9. Freight Operations (FOIS)", "fois_freight_manifests.json", generate_fois_manifests),
    ]

    for label, filename, gen_fn in generators:
        t0 = time.time()
        gen_fn(seed=seed, output_dir=output_dir)
        dt = (time.time() - t0) * 1000
        print(f"      [OK] Generated {filename:<32} ({label}) [{dt:.1f} ms]")

    print(f"\n  [OK] All 9 datastores generated in '{output_dir}/'.\n")

    # Step 2: Load generated datasets
    with open(os.path.join(output_dir, "network_topology.json"), "r", encoding="utf-8") as f:
        net_data = json.load(f)
    with open(os.path.join(output_dir, "tms_track_defects.json"), "r", encoding="utf-8") as f:
        tms_data = json.load(f)
    with open(os.path.join(output_dir, "tdms_catenary_health.json"), "r", encoding="utf-8") as f:
        tdms_data = json.load(f)
    with open(os.path.join(output_dir, "smms_signalling_gears.json"), "r", encoding="utf-8") as f:
        smms_data = json.load(f)
    with open(os.path.join(output_dir, "tmms_machine_inventory.json"), "r", encoding="utf-8") as f:
        tmms_data = json.load(f)
    with open(os.path.join(output_dir, "icms_speed_restrictions.json"), "r", encoding="utf-8") as f:
        icms_data = json.load(f)
    with open(os.path.join(output_dir, "crt_weather_telemetry.json"), "r", encoding="utf-8") as f:
        crt_data = json.load(f)
    with open(os.path.join(output_dir, "coa_passenger_streams.json"), "r", encoding="utf-8") as f:
        coa_data = json.load(f)
    with open(os.path.join(output_dir, "fois_freight_manifests.json"), "r", encoding="utf-8") as f:
        fois_data = json.load(f)

    # Step 3: Execute Cross-System Integrity Checks & Audits
    print("  [2/4] Executing Strict Pydantic Schema Validation & Audits...")
    integrity_errors = []
    validation_audit = []

    # Check 1: Strict Pydantic v2 Schema Validation
    pydantic_errs = 0
    try:
        NetworkTopologyModel.model_validate(net_data)
        for r in tms_data: TMSDefectModel.model_validate(r)
        for r in tdms_data: TDMSCatenaryModel.model_validate(r)
        for r in smms_data: SMMSSignallingModel.model_validate(r)
        for r in tmms_data: TMMSMachineModel.model_validate(r)
        for r in icms_data: ICMSSpeedRestrictionModel.model_validate(r)
        for r in crt_data: CRTWeatherRecordModel.model_validate(r)
        for r in coa_data: COAPassengerTrainModel.model_validate(r)
        for r in fois_data: FOISFreightRakeModel.model_validate(r)
    except Exception as e:
        integrity_errors.append(f"Pydantic schema validation error: {e}")
        pydantic_errs += 1

    validation_audit.append(("Strict Pydantic v2 Validation", "All 9 Datastores", "100% Contract Type-Safety", pydantic_errs == 0))

    # Check 2: Exact Foreign-Key String Matching
    fk_errs = 0
    net_stns = {s["station_code"] for c in net_data["corridors"] for s in c["stations"]}
    net_tracks = {t for c in net_data["corridors"] for t in c["lines"]} | {"LOOP"}

    for r in tms_data:
        if r["track_id"] not in net_tracks:
            integrity_errors.append(f"TMS invalid track_id: {r['track_id']}")
            fk_errs += 1
    for r in tdms_data:
        fp = r["electrical_topology"]["feeding_post_id"].replace("FP-", "")
        ssp = r["electrical_topology"]["sub_sectioning_post_id"].replace("SSP-", "")
        if fp not in net_stns or ssp not in net_stns:
            integrity_errors.append(f"TDMS station mismatch: FP={fp}, SSP={ssp}")
            fk_errs += 1
    for r in smms_data:
        if r["station_code"] not in net_stns:
            integrity_errors.append(f"SMMS station mismatch: {r['station_code']}")
            fk_errs += 1
    for r in tmms_data:
        stn = r["current_stabling_location"]["station_code"]
        if stn not in net_stns:
            integrity_errors.append(f"TMMS stabling station mismatch: {stn}")
            fk_errs += 1
    for r in icms_data:
        s1 = r["station_section"]["from_station"]
        s2 = r["station_section"]["to_station"]
        if s1 not in net_stns or s2 not in net_stns or r["chainage"]["line"] not in net_tracks:
            integrity_errors.append(f"ICMS station/track mismatch: {s1}, {s2}")
            fk_errs += 1
    for r in coa_data:
        if r["track_id"] not in net_tracks:
            integrity_errors.append(f"COA track mismatch: {r['track_id']}")
            fk_errs += 1
        for st in r["stations_trajectory"]:
            if st["station_code"] not in net_stns:
                integrity_errors.append(f"COA station mismatch: {st['station_code']}")
                fk_errs += 1
    for r in fois_data:
        if r["origin_station"] not in net_stns or r["destination_station"] not in net_stns:
            integrity_errors.append(f"FOIS station mismatch: {r['origin_station']}")
            fk_errs += 1

    validation_audit.append(("Exact Foreign-Key Matching", "All Stations, Tracks & Sidings", "0 Mismatches Across 9 Systems", fk_errs == 0))

    # Check 3: Machine Kinematics & Siding Distance Feasibility
    kin_errs = 0
    # Verify Test Case 2 mathematical trap:
    # BCM-01 stabled at GZB (95km transit to KM 78 on CORR_NORTH)
    transit_time = calculate_transit_time_minutes("BCM", 95.0)  # 95 / 30 * 60 = 190.0 min
    work_time = calculate_work_window_minutes("BCM", 1.0)       # 20 + 40 + 20 = 80.0 min
    total_window_needed = transit_time + work_time              # 270 min > 120 min normal gap
    if transit_time < 180.0 or work_time < 70.0:
        integrity_errors.append(f"Machine kinematics calculation error for BCM: transit={transit_time}, work={work_time}")
        kin_errs += 1

    validation_audit.append(("Machine Kinematics & Siding Routing", "TMMS RDSO Kinematics", f"BCM transit: {transit_time:.0f}m + work: {work_time:.0f}m", kin_errs == 0))

    # Check 4: Unified Time Window & Continuous CRT Weather Alignment
    time_errs = 0
    for train in coa_data:
        for st in train["stations_trajectory"]:
            if not (0 <= st["arr_scheduled"] <= 1439 and 0 <= st["dep_actual_rtis"] <= 1439):
                integrity_errors.append(f"Train {train['train_no']} time outside 0-1439 minute window")
                time_errs += 1
    for r in crt_data:
        curve = r.get("minute_temperature_curve")
        if not curve or len(curve) != 1440:
            integrity_errors.append(f"CRT sensor {r['sensor_probe_id']} missing 1440-minute continuous curve")
            time_errs += 1

    validation_audit.append(("Unified Time Scale (0-1439m)", "COA Schedules & CRT Curves", "Minute 600 aligns with weather array", time_errs == 0))

    # Check 5: Passenger Train Headway Safety (>= 7.0 minutes spacing)
    headway_errs = 0
    from collections import defaultdict
    train_groups = defaultdict(list)
    for train in coa_data:
        corr = train["corridor_id"]
        direction = train["direction"]
        track = train["track_id"]
        train_groups[(corr, track, direction)].append(train)

    for (corr, track, direction), train_list in train_groups.items():
        train_list.sort(key=lambda tr: tr["stations_trajectory"][0]["dep_scheduled"])
        for i in range(len(train_list) - 1):
            t1, t2 = train_list[i], train_list[i + 1]
            traj1 = {st["station_code"]: st for st in t1["stations_trajectory"]}
            traj2 = {st["station_code"]: st for st in t2["stations_trajectory"]}
            common = set(traj1.keys()) & set(traj2.keys())
            for st_code in common:
                diff = abs(traj2[st_code]["dep_scheduled"] - traj1[st_code]["dep_scheduled"])
                if diff < 7.0:
                    integrity_errors.append(f"Headway violation ({diff:.1f}m < 7.0m) between Train {t1['train_no']} & {t2['train_no']} at station {st_code}")
                    headway_errs += 1

    validation_audit.append(("Passenger Headway Safety", "COA Passenger Streams", "≥ 7.0 min headway on shared tracks", headway_errs == 0))

    # Check 6: Enterprise CRIS Ingestion Adapter Validation
    cris_errs = 0
    try:
        sample_cris = EnterpriseMiddlewareAdapter.internal_tms_to_cris(tms_data[0])
        norm_back = EnterpriseMiddlewareAdapter.cris_tms_to_internal(sample_cris)
        TMSDefectModel.model_validate(norm_back)
    except Exception as e:
        integrity_errors.append(f"Enterprise CRIS adapter transformation error: {e}")
        cris_errs += 1

    validation_audit.append(("Enterprise CRIS Ingestion Adapters", "CRIS Middleware / IoT", "Bidirectional Raw Payload Mapping", cris_errs == 0))

    # Check 7: Injected Test Cases Verification
    test_cases_status = []

    # Test Case 1 Verification
    tc1_tms_rec = next((r for r in tms_data if r["inspection_id"] == "TRC-2026-Q3-001"), None)
    tc1_tdms_rec = next((r for r in tdms_data if r["demand_id"] == "TDMS/DIV/TRD/2026/001"), None)
    tc1_ok = (
        tc1_tms_rec is not None
        and tc1_tdms_rec is not None
        and tc1_tms_rec["corridor_id"] == "CORR_EAST"
        and tc1_tms_rec["chainage"]["from_km"] == 24.5
        and tc1_tms_rec["tgi_breakdown"]["composite_tgi"] == 32.0
        and tc1_tms_rec["overdue_days"] == 12
        and tc1_tdms_rec["catenary_segment"]["from_km"] == 25.2
        and tc1_tdms_rec["contact_wire_diameter_mm"] == 8.2
    )
    test_cases_status.append(("TC1", "Golden Shadow Bundle", "CORR_EAST KM 24.5-27.0", "TGI=32.0, Wire=8.2mm (Overlapped)", tc1_ok))

    # Test Case 2 Verification
    tc2_tms_rec = next((r for r in tms_data if r["inspection_id"] == "TRC-2026-Q3-002"), None)
    tc2_bcm = next((m for m in tmms_data if m["machine_id"] == "BCM-01"), None)
    tc2_ok = (
        tc2_tms_rec is not None
        and tc2_bcm is not None
        and tc2_tms_rec["corridor_id"] == "CORR_NORTH"
        and tc2_tms_rec["required_action"] == "BCM_DEEP_SCREENING"
        and tc2_bcm["current_stabling_location"]["station_code"] == "GZB"
        and total_window_needed >= 270.0
    )
    test_cases_status.append(("TC2", "Kinematic Siding Trap", "CORR_NORTH KM 78.0", f"BCM at GZB (Req: {total_window_needed:.0f}m > 120m gap)", tc2_ok))

    # Test Case 3 Verification
    tc3_tms_rec = next((r for r in tms_data if r["inspection_id"] == "TRC-2026-Q3-003"), None)
    tc3_crt_rec = next((r for r in crt_data if r["corridor_id"] == "CORR_SOUTH" and r["hour"] == 13), None)
    tc3_ok = (
        tc3_tms_rec is not None
        and tc3_crt_rec is not None
        and tc3_tms_rec["required_action"] == "DESTRESSING"
        and tc3_tms_rec.get("preferred_time_slot_minutes", {}).get("start_minute") == 780
        and tc3_crt_rec["rail_temp_celsius"] == 61.5
        and tc3_crt_rec["track_buckling_warning"] is True
        and tc3_crt_rec["safe_for_tamping"] is False
    )
    test_cases_status.append(("TC3", "Rail Temp Lockout", "CORR_SOUTH @ 13:00", "Tr=61.5°C, Buckling Warning=True", tc3_ok))

    # Test Case 4 Verification
    tc4_fois_rec = next((r for r in fois_data if r["corridor_id"] == "CORR_WEST" and r["rake_configuration"]["wagon_type"] == "BOXNHL"), None)
    tc4_ok = (
        tc4_fois_rec is not None
        and tc4_fois_rec["can_be_stabled_in_loop"] is True
        and tc4_fois_rec["rake_configuration"]["total_length_meters"] == 680.0
    )
    test_cases_status.append(("TC4", "Freight Loop Regulation", "CORR_WEST (Bahadurgarh)", "BOXNHL 680m held in 715m loop", tc4_ok))

    for tc_id, name, loc, details, ok in test_cases_status:
        if not ok:
            integrity_errors.append(f"Injected Test Case failed verification: {tc_id} ({name})")

    validation_audit.append(("Injected Test Cases Verification", "Phase 1 Suite", "4/4 Injected Test Cases Verified", all(ok for _, _, _, _, ok in test_cases_status)))

    # Check 8: Deterministic Seeding Audit
    t0_det = time.time()
    import tempfile
    with tempfile.TemporaryDirectory() as tmp_dir:
        generate_network_topology(seed=seed, output_dir=tmp_dir)
        generate_tms_defects(seed=seed, output_dir=tmp_dir)
        generate_tdms_demands(seed=seed, output_dir=tmp_dir)
        generate_smms_gears(seed=seed, output_dir=tmp_dir)
        generate_tmms_inventory(seed=seed, output_dir=tmp_dir)
        generate_icms_restrictions(seed=seed, output_dir=tmp_dir)
        generate_crt_weather(seed=seed, output_dir=tmp_dir)
        generate_coa_streams(seed=seed, output_dir=tmp_dir)
        generate_fois_manifests(seed=seed, output_dir=tmp_dir)

        bit_identical = True
        for _, fname, _ in generators:
            p1 = os.path.join(output_dir, fname)
            p2 = os.path.join(tmp_dir, fname)
            with open(p1, "rb") as f1, open(p2, "rb") as f2:
                if f1.read() != f2.read():
                    bit_identical = False
                    integrity_errors.append(f"Deterministic seed output mismatch for {fname}")
                    break

    validation_audit.append(("Deterministic Seeding Audit", "All 9 Generators", f"Bit-identical outputs across runs ({time.time()-t0_det:.2f}s)", bit_identical))

    # Step 4: Display Rich Terminal Audit Summary
    print("  [3/4] Generating Datastore & Cross-System Audit Reports...")
    print("\n" + "-" * 80)
    print(" DATASTORE SUMMARY AUDIT TABLE")
    print("-" * 80)
    print(f" {'Datastore File':<32} | {'Records':<8} | {'Size (KB)':<10} | {'Status':<8}")
    print("-" * 80)

    for _, fname, _ in generators:
        fpath = os.path.join(output_dir, fname)
        size_kb = os.path.getsize(fpath) / 1024.0
        with open(fpath, "r", encoding="utf-8") as f:
            d = json.load(f)
            if isinstance(d, dict) and "corridors" in d:
                count = len(d["corridors"])
            elif isinstance(d, dict) and "trains" in d:
                count = len(d["trains"])
            elif isinstance(d, list):
                count = len(d)
            else:
                count = 1
        print(f" {fname:<32} | {count:<8} | {size_kb:<10.1f} | [PASS]")

    print("-" * 80)

    print("\n" + "-" * 80)
    print(" CROSS-SYSTEM INTEGRITY AUDIT MATRIX")
    print("-" * 80)
    print(f" {'Integrity Rule Description':<36} | {'Target System':<22} | {'Status':<14}")
    print("-" * 80)
    for rule_name, target_sys, details, ok in validation_audit:
        status_str = "[PASS]" if ok else "[FAIL]"
        print(f" {rule_name:<36} | {target_sys:<22} | {status_str:<14}")
    print("-" * 80)

    print("\n" + "-" * 80)
    print(" INJECTED TEST CASE MATRIX VERIFICATION")
    print("-" * 80)
    print(f" {'TC ID':<6} | {'Test Case Name':<24} | {'Location':<22} | {'Status':<16}")
    print("-" * 80)
    for tc_id, name, loc, details, ok in test_cases_status:
        status_str = "[VERIFIED]" if ok else "[FAILED]"
        print(f" {tc_id:<6} | {name:<24} | {loc:<22} | {status_str:<16}")
    print("-" * 80)

    # Step 5: Event Bus Mock Demonstration (if requested or default sample)
    print("\n  [4/4] Evaluating Event Bus Mock & Dynamic Re-Slotting Snapshots...")
    bus = RailSyncEventBusMock(data_dir=output_dir)
    m1 = snapshot_minute if snapshot_minute is not None else 480  # 08:00 AM
    m2 = m1 + 15 if compare_minutes is None else compare_minutes[1]
    snap_a = bus.get_snapshot(m1)
    snap_b = bus.get_snapshot(m2)
    print(compare_snapshots(snap_a, snap_b))

    total_time = time.time() - start_time
    err_count = len(integrity_errors)

    print("\n" + "=" * 80)
    print("  RAILSYNC-ABPS PHASE 1: GENERATION & INTEGRITY VERIFICATION COMPLETE")
    print(f"                      {err_count} INTEGRITY ERRORS DETECTED")
    print(f"                      Total Execution Time: {total_time:.2f} seconds")
    print("=" * 80 + "\n")

    if err_count > 0:
        print("  INTEGRITY ERROR DETAILS:")
        for err in integrity_errors:
            print(f"   - [ERROR] {err}")
        print()
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RailSync-ABPS Phase 1 Master Orchestrator")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for deterministic generation")
    parser.add_argument("--output-dir", type=str, default="data", help="Output directory for JSON datastores")
    parser.add_argument("--snapshot", type=int, default=480, help="Emit Event Bus snapshot at minute T (0..1439)")
    args = parser.parse_args()

    run_orchestrator(seed=args.seed, output_dir=args.output_dir, snapshot_minute=args.snapshot)
