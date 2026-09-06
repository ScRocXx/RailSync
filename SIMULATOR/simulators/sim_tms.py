"""
RailSync-ABPS Simulator: Track Management System (TMS)
Generates track defect records for simulation.
"""

import json
import random
import os
import pathlib

from .schemas import TMSDefectModel

def generate_tms_defects(seed=42, output_dir="data"):
    """
    Generates 35 distinct P-Way defect records and writes to tms_track_defects.json.
    """
    random.seed(seed)
    pathlib.Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    def get_mast(km):
        """
        Derives OHE mast reference from chainage KM.
        Format: "KM/MAST" where mast_no = int((km % 1) * 16) + 1.
        """
        mast_no = int((km % 1) * 16) + 1
        return f"{int(km)}/{mast_no}"
        
    records = []
    
    # Test Case 1 (Golden Shadow Bundle) - CORR_EAST
    # Reverse-engineered TGI components to hit composite_tgi = 32.0:
    # (2*60.0 + 50.0 + 30.0 + 6*20.0) / 10 = (120+50+30+120)/10 = 320/10 = 32.0
    tc1 = {
        "inspection_id": "TRC-2026-Q3-001",
        "corridor_id": "CORR_EAST",
        "track_id": "UP_MAIN",
        "chainage": {
            "from_km": 24.5,
            "to_km": 27.0,
            "from_mast": get_mast(24.5),
            "to_mast": get_mast(27.0)
        },
        "track_structure": {
            "rail_weight": "60KG",
            "sleeper_type": "PSC_MONOBLOCK",
            "sleeper_density": 1660,
            "gmt_carried": 245.5
        },
        "tgi_breakdown": {
            "ui": 60.0,
            "ti": 50.0,
            "gi": 30.0,
            "ai": 20.0,
            "composite_tgi": 32.0
        },
        "usfd_flaw": {
            "flaw_code": "NONE",
            "defect_type": "NONE",
            "action_timeline_hours": 0
        },
        "ballast_cushion_depth_mm": 120,
        "required_action": "CSM_TAMPING",
        "overdue_days": 12,
        "priority": "CRITICAL"
    }
    records.append(tc1)
    
    # Test Case 2 - CORR_NORTH
    tc2_ui, tc2_ti, tc2_gi, tc2_ai = 120.0, 50.0, 50.0, 30.0
    tc2_comp = (2*tc2_ui + tc2_ti + tc2_gi + 6*tc2_ai) / 10
    tc2 = {
        "inspection_id": "TRC-2026-Q3-002",
        "corridor_id": "CORR_NORTH",
        "track_id": "DN_MAIN",
        "chainage": {
            "from_km": 77.5,
            "to_km": 78.5,
            "from_mast": get_mast(77.5),
            "to_mast": get_mast(78.5)
        },
        "track_structure": {
            "rail_weight": "60KG",
            "sleeper_type": "PSC_MONOBLOCK",
            "sleeper_density": 1660,
            "gmt_carried": 300.0
        },
        "tgi_breakdown": {
            "ui": tc2_ui,
            "ti": tc2_ti,
            "gi": tc2_gi,
            "ai": tc2_ai,
            "composite_tgi": tc2_comp
        },
        "usfd_flaw": {
            "flaw_code": "NONE",
            "defect_type": "NONE",
            "action_timeline_hours": 0
        },
        "ballast_cushion_depth_mm": 140, # < 150 (dirty ballast)
        "required_action": "BCM_DEEP_SCREENING",
        "overdue_days": 5,
        "priority": "AVERAGE"
    }
    records.append(tc2)
    
    # Test Case 3 - CORR_SOUTH
    tc3_ui, tc3_ti, tc3_gi, tc3_ai = 150.0, 80.0, 70.0, 50.0
    tc3_comp = (2*tc3_ui + tc3_ti + tc3_gi + 6*tc3_ai) / 10
    tc3 = {
        "inspection_id": "TRC-2026-Q3-003",
        "corridor_id": "CORR_SOUTH",
        "track_id": "3RD_LINE",
        "chainage": {
            "from_km": 35.0,
            "to_km": 36.5,
            "from_mast": get_mast(35.0),
            "to_mast": get_mast(36.5)
        },
        "track_structure": {
            "rail_weight": "60KG",
            "sleeper_type": "PSC_MONOBLOCK",
            "sleeper_density": 1540,
            "gmt_carried": 150.0
        },
        "tgi_breakdown": {
            "ui": tc3_ui,
            "ti": tc3_ti,
            "gi": tc3_gi,
            "ai": tc3_ai,
            "composite_tgi": tc3_comp
        },
        "usfd_flaw": {
            "flaw_code": "NONE",
            "defect_type": "NONE",
            "action_timeline_hours": 0
        },
        "ballast_cushion_depth_mm": 250,
        "required_action": "DESTRESSING",
        "overdue_days": 2,
        "priority": "GOOD",
        "preferred_time_slot": "13:00-16:00",
        "preferred_time_slot_minutes": {
            "start_minute": 780,
            "end_minute": 960
        }
    }
    records.append(tc3)
    
    # Remaining 32 records
    # Distribution left: N: 8, E: 8, S: 8, W: 8
    corridors = [("CORR_NORTH", 89.0)] * 8 + [("CORR_EAST", 48.0)] * 8 + [("CORR_SOUTH", 59.0)] * 8 + [("CORR_WEST", 71.0)] * 8
    
    for i, (corr, max_km) in enumerate(corridors):
        km = round(random.uniform(0.0, max_km - 2.0), 1)
        ui = round(random.uniform(10.0, 150.0), 1)
        ti = round(random.uniform(10.0, 80.0), 1)
        gi = round(random.uniform(10.0, 80.0), 1)
        ai = round(random.uniform(5.0, 50.0), 1)
        
        comp = round((2*ui + ti + gi + 6*ai)/10, 1)
        
        if comp < 36.0: pri = "CRITICAL"
        elif comp <= 50.0: pri = "URGENT"
        elif comp <= 80.0: pri = "AVERAGE"
        else: pri = "GOOD"
        
        rec = {
            "inspection_id": f"TRC-2026-Q3-{(i+4):03d}",
            "corridor_id": corr,
            "track_id": random.choice(["UP_MAIN", "DN_MAIN"]),
            "chainage": {
                "from_km": km,
                "to_km": min(round(km + random.uniform(0.5, 2.0), 1), max_km),
                "from_mast": get_mast(km),
                "to_mast": ""
            },
            "track_structure": {
                "rail_weight": random.choice(["60KG", "52KG"]),
                "sleeper_type": random.choice(["PSC_MONOBLOCK", "STEEL_TROUGH"]),
                "sleeper_density": random.choice([1660, 1540]),
                "gmt_carried": round(random.uniform(50.0, 400.0), 1)
            },
            "tgi_breakdown": {
                "ui": ui,
                "ti": ti,
                "gi": gi,
                "ai": ai,
                "composite_tgi": comp
            },
            "usfd_flaw": {
                "flaw_code": random.choice(["IMR", "IMRW", "OBS", "OBSW", "NONE"]),
                "defect_type": random.choice(["TRANSVERSE_FATIGUE", "HORIZONTAL_SPLIT", "WELD_CRACK", "BOLT_HOLE_CRACK", "NONE"]),
                "action_timeline_hours": random.choice([0, 24, 48, 72])
            },
            "ballast_cushion_depth_mm": random.randint(150, 300),
            "required_action": random.choice(["CSM_TAMPING", "BCM_DEEP_SCREENING", "TRT_RENEWAL", "MANUAL_PACKING", "DESTRESSING"]),
            "overdue_days": random.randint(0, 30),
            "priority": pri
        }
        rec["chainage"]["to_mast"] = get_mast(rec["chainage"]["to_km"])
        records.append(rec)
        
    # Strict fail-fast Pydantic validation
    for r in records:
        TMSDefectModel.model_validate(r)
        
    out_file = os.path.join(output_dir, "tms_track_defects.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        
    return records

if __name__ == "__main__":
    generate_tms_defects()
