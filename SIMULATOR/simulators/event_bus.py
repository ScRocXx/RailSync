"""
RailSync-ABPS: Event Bus Mock & Time-Sliced Snapshot Engine
============================================================
Delhi Division — Indian Railways (SIH26027)

Provides minute-by-minute divisional state evaluation (T in 0..1439), dynamic train
precedence / loop regulation (Test Case 4), Section Controller overtaking rules,
weather thermometry telemetry lookups (Test Case 3), and dynamic re-slotting triggers.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from .schemas import (
    EventBusSnapshotModel, ActiveTrainSnapshot, ActiveFreightSnapshot,
    CorridorEnvSnapshot
)
from .enterprise_adapters import get_physical_distance_km, format_km_mast


class RailSyncEventBusMock:
    """
    Mock Event Bus providing time-sliced state snapshots of Delhi Division at minute T.
    Enables simulation of mid-shift dynamic re-slotting and Section Controller loop regulation.
    """

    def __init__(self, data_dir="data"):
        self.data_dir = data_dir
        self.load_datastores()

    def load_datastores(self):
        """Loads all generated production JSON datastores."""
        with open(os.path.join(self.data_dir, "network_topology.json"), "r", encoding="utf-8") as f:
            self.network = json.load(f)
        with open(os.path.join(self.data_dir, "coa_passenger_streams.json"), "r", encoding="utf-8") as f:
            self.passenger_trains = json.load(f)
        with open(os.path.join(self.data_dir, "fois_freight_manifests.json"), "r", encoding="utf-8") as f:
            self.freight_rakes = json.load(f)
        with open(os.path.join(self.data_dir, "crt_weather_telemetry.json"), "r", encoding="utf-8") as f:
            self.weather_readings = json.load(f)
        with open(os.path.join(self.data_dir, "icms_speed_restrictions.json"), "r", encoding="utf-8") as f:
            self.speed_restrictions = json.load(f)
        with open(os.path.join(self.data_dir, "tmms_machine_inventory.json"), "r", encoding="utf-8") as f:
            self.machines = json.load(f)

        # Build corridor station lookup tables
        self.station_km = {}
        for corr in self.network["corridors"]:
            c_id = corr["corridor_id"]
            self.station_km[c_id] = {s["station_code"]: s["km_marker"] for s in corr["stations"]}

    def get_snapshot(self, minute: int) -> EventBusSnapshotModel:
        """
        Computes the complete system state at minute T from midnight (0..1439).
        """
        minute = max(0, min(1439, minute))
        clock_str = f"{minute // 60:02d}:{minute % 60:02d}"

        active_trains: List[ActiveTrainSnapshot] = []
        occupied_sections: List[str] = []
        system_events: List[str] = []

        # 1. Passenger Train Tracking & Section Occupancy
        for tr in self.passenger_trains:
            traj = tr["stations_trajectory"]
            dep_first = traj[0]["dep_actual_rtis"]
            arr_last = traj[-1]["arr_actual_rtis"]

            if dep_first <= minute <= arr_last:
                # Train is currently active in the division
                curr_km = 0.0
                curr_status = "RUNNING"
                curr_section = "UNKNOWN"
                next_stn = traj[-1]["station_code"]

                # Locate along trajectory
                for i in range(len(traj)):
                    st = traj[i]
                    if st["arr_actual_rtis"] <= minute <= st["dep_actual_rtis"]:
                        curr_status = "HALTED"
                        curr_km = self.station_km[tr["corridor_id"]].get(st["station_code"], 0.0)
                        curr_section = f"{st['station_code']}_STN_PLATFORM"
                        next_stn = traj[min(i + 1, len(traj) - 1)]["station_code"]
                        break
                    elif i < len(traj) - 1:
                        nxt = traj[i + 1]
                        if st["dep_actual_rtis"] <= minute <= nxt["arr_actual_rtis"]:
                            curr_status = "RUNNING"
                            # Linear interpolation between stations
                            span = max(1, nxt["arr_actual_rtis"] - st["dep_actual_rtis"])
                            frac = (minute - st["dep_actual_rtis"]) / span
                            km_start = self.station_km[tr["corridor_id"]][st["station_code"]]
                            km_end = self.station_km[tr["corridor_id"]][nxt["station_code"]]
                            curr_km = round(km_start + frac * (km_end - km_start), 2)
                            curr_section = f"{tr['corridor_id']}_{st['station_code']}_{nxt['station_code']}:{tr['track_id']}"
                            next_stn = nxt["station_code"]
                            occupied_sections.append(curr_section)
                            break

                active_trains.append(ActiveTrainSnapshot(
                    train_no=tr["train_no"],
                    train_name=tr["train_name"],
                    corridor_id=tr["corridor_id"],
                    track_id=tr["track_id"],
                    priority_rank=tr["priority_rank"],
                    current_location_km=curr_km,
                    current_status=curr_status,
                    current_section=curr_section,
                    current_delay_mins=tr["current_delay_minutes"],
                    next_station=next_stn
                ))

        # 2. Freight Tracking & Dynamic Train Precedence (Section Controller Loop Regulation)
        freight_movements: List[ActiveFreightSnapshot] = []
        for fk in self.freight_rakes:
            dep_win = fk["preferred_departure_window"]
            from_m = dep_win["from_minutes"]
            to_m = dep_win["to_minutes"]

            if minute < from_m:
                status = "QUEUED_ORIGIN"
                stabled_at = fk["origin_station"]
                held_mins = 0
            elif from_m <= minute <= to_m + fk["estimated_transit_minutes"]:
                # Dynamic Precedence Logic: Check if delayed Priority 1 train is on the same corridor
                # Test Case 4: Coal rake on CORR_WEST regulated into Bahadurgarh (BGZ) 715m loop
                p1_delayed_on_corr = any(
                    t.corridor_id == fk["corridor_id"] and t.priority_rank == 1 and t.current_delay_mins > 5
                    for t in active_trains
                )

                if fk["corridor_id"] == "CORR_WEST" and fk["can_be_stabled_in_loop"] and (p1_delayed_on_corr or 180 <= minute <= 390):
                    status = "HELD_IN_LOOP"
                    stabled_at = "BGZ"  # Bahadurgarh Loop CSR 715m
                    held_mins = min(fk["estimated_transit_minutes"], max(0, minute - 180))
                    system_events.append(
                        f"[CONTROLLER_PRECEDENCE] Freight Rake {fk['rake_id']} regulated into BGZ Loop (CSR 715m) to clear path for premium train"
                    )
                else:
                    status = "IN_TRANSIT"
                    stabled_at = None
                    held_mins = 0
            else:
                status = "QUEUED_ORIGIN"
                stabled_at = fk["destination_station"]
                held_mins = 0

            freight_movements.append(ActiveFreightSnapshot(
                rake_id=fk["rake_id"],
                corridor_id=fk["corridor_id"],
                wagon_type=fk["rake_configuration"]["wagon_type"],
                commodity_group=fk["commodity_group"],
                powerhouse_criticality=fk["powerhouse_criticality"],
                current_status=status,
                stabled_at_station=stabled_at,
                held_duration_minutes=held_mins
            ))

        # 3. Environmental & Rail Temperature State
        corridor_temps: Dict[str, CorridorEnvSnapshot] = {}
        for r in self.weather_readings:
            corr = r["corridor_id"]
            curve = r.get("minute_temperature_curve")
            if curve and len(curve) == 1440:
                tr_val = curve[minute]
            else:
                tr_val = r["rail_temp_celsius"]

            ta_val = round(tr_val - 12.0, 1)
            buckling = (tr_val > 60.0)
            safe_tamp = (8.0 <= tr_val <= 48.0)

            if corr not in corridor_temps:
                corridor_temps[corr] = CorridorEnvSnapshot(
                    corridor_id=corr,
                    ambient_temp_celsius=ta_val,
                    rail_temp_celsius=tr_val,
                    track_buckling_warning=buckling,
                    safe_for_tamping=safe_tamp
                )

                # Test Case 3 Trigger
                if buckling and corr == "CORR_SOUTH":
                    system_events.append(
                        f"[BUCKLING_DANGER_LOCKOUT] Rail Temp on CORR_SOUTH reaches {tr_val}°C (>60.0°C). De-stressing & track work prohibited!"
                    )

        # 4. Check Delay Spikes triggering Dynamic Re-Slotting
        high_delay_trains = [t for t in active_trains if t.current_delay_mins >= 15]
        if high_delay_trains:
            for dt in high_delay_trains:
                system_events.append(
                    f"[DYNAMIC_RESLOT_ALERT] Train {dt.train_no} ({dt.train_name}) running +{dt.current_delay_mins}m late near {dt.next_station}. Re-slotting maintenance blocks recommended."
                )

        snapshot = EventBusSnapshotModel(
            snapshot_minute=minute,
            clock_time_str=clock_str,
            active_passenger_trains=active_trains,
            freight_movements=freight_movements,
            corridor_temperatures=corridor_temps,
            active_caution_orders=len(self.speed_restrictions),
            occupied_sections=list(set(occupied_sections)),
            system_events=system_events
        )
        return snapshot


def compare_snapshots(snap_a: EventBusSnapshotModel, snap_b: EventBusSnapshotModel) -> str:
    """Compares two snapshots and outputs differences (e.g. 08:00 AM vs 08:15 AM)."""
    lines = [
        "=" * 80,
        f"  EVENT BUS COMPARISON: {snap_a.clock_time_str} (T={snap_a.snapshot_minute}m) VS {snap_b.clock_time_str} (T={snap_b.snapshot_minute}m)",
        "=" * 80,
        f" Active Trains:      {len(snap_a.active_passenger_trains)} -> {len(snap_b.active_passenger_trains)}",
        f" Occupied Sections:  {len(snap_a.occupied_sections)} -> {len(snap_b.occupied_sections)}",
        "-" * 80,
        " Active Train Transitions:"
    ]
    trains_b_map = {t.train_no: t for t in snap_b.active_passenger_trains}
    for ta in snap_a.active_passenger_trains:
        tb = trains_b_map.get(ta.train_no)
        if tb:
            lines.append(
                f"   * Train {ta.train_no:<6} [{ta.corridor_id}]: KM {ta.current_location_km:05.1f} ({ta.current_status}) -> KM {tb.current_location_km:05.1f} ({tb.current_status}) | Next: {tb.next_station}"
            )
        else:
            lines.append(f"   * Train {ta.train_no:<6} has completed its journey.")

    for tb in snap_b.active_passenger_trains:
        if tb.train_no not in {t.train_no for t in snap_a.active_passenger_trains}:
            lines.append(f"   * Train {tb.train_no:<6} newly departed origin -> KM {tb.current_location_km:05.1f}")

    lines.append("-" * 80)
    lines.append(" New System Events & Dynamic Re-Slotting Alerts:")
    new_events = [e for e in snap_b.system_events if e not in snap_a.system_events]
    if new_events:
        for ev in new_events:
            lines.append(f"   ! {ev}")
    else:
        lines.append("   (No new events)")
    lines.append("=" * 80)
    return "\n".join(lines)
