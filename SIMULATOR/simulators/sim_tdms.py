"""
RailSync-ABPS Simulator: Traction Distribution Management System (TDMS)
Generates TRD catenary demand records for simulation.
"""

import json
import random
import os
import pathlib

from .schemas import TDMSCatenaryModel

def generate_tdms_demands(seed=42, output_dir="data"):
    """
    Generates 25 TRD catenary demand records and writes to tdms_catenary_health.json.
    """
    random.seed(seed)
    pathlib.Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    def get_mast(km):
        mast_no = int((km % 1) * 16) + 1
        return f"{int(km)}/{mast_no}"
        
    records = []
    
    # Test Case 1 (Golden Shadow Bundle)
    tc1 = {
        "demand_id": "TDMS/DIV/TRD/2026/001",
        "corridor_id": "CORR_EAST",
        "catenary_segment": {
            "from_km": 25.2,
            "to_km": 26.0,
            "sub_division": "TDMS-GZB-SUBDIV"
        },
        "electrical_topology": {
            "feeding_post_id": "FP-GZB",
            "sub_sectioning_post_id": "SSP-MDNR",
            "elementary_section_no": "ES-GZB-UP-04",
            "isolator_switches_to_open": ["SM-104", "CB-102"],
            "adjacent_line_isolation_required": False
        },
        "contact_wire_diameter_mm": 8.2,
        "stagger_deviation_mm": 45.0,
        "sparking_severity": "HEAVY_EROSION",
        "power_block_type": "LOCAL_ISOLATION",
        "overdue_days": 6,
        "priority": "CRITICAL"
    }
    records.append(tc1)
    
    # Remaining 24 records
    corridors = [("CORR_NORTH", 89.0)] * 7 + [("CORR_EAST", 48.0)] * 5 + [("CORR_SOUTH", 59.0)] * 6 + [("CORR_WEST", 71.0)] * 6
    
    # Corridor station lookups for FP/SSP naming
    corridor_stations = {
        "CORR_NORTH": ["DLI", "SZM", "ANDI", "NUR", "SNP", "GNU", "SMK", "PNP"],
        "CORR_EAST": ["GZB", "GZN", "MUD", "MDNR", "MUZ", "MTC"],
        "CORR_SOUTH": ["NZM", "OKA", "TKD", "FDB", "BVH", "AST", "PWL"],
        "CORR_WEST": ["DLI", "DEE", "SSB", "NNO", "BGZ", "SPZ", "ROK"]
    }
    
    for i, (corr, max_km) in enumerate(corridors):
        km = round(random.uniform(0.0, max_km - 2.0), 1)
        wire_dia = round(random.uniform(7.5, 12.0), 2)
        
        if wire_dia <= 8.25: pri = "CRITICAL"
        elif wire_dia <= 9.5: pri = "URGENT"
        elif wire_dia <= 10.5: pri = "AVERAGE"
        else: pri = "ROUTINE"
        
        stns = corridor_stations[corr]
        fp_stn = stns[random.randint(0, len(stns) - 1)]
        ssp_stn = stns[random.randint(0, len(stns) - 1)]
        es_num = random.randint(1, 12)
        line_tag = random.choice(["UP", "DN"])
        
        rec = {
            "demand_id": f"TDMS/DIV/TRD/2026/{(i+2):03d}",
            "corridor_id": corr,
            "catenary_segment": {
                "from_km": km,
                "to_km": min(round(km + random.uniform(0.5, 2.0), 1), max_km),
                "sub_division": f"TDMS-{fp_stn}-SUBDIV"
            },
            "electrical_topology": {
                "feeding_post_id": f"FP-{fp_stn}",
                "sub_sectioning_post_id": f"SSP-{ssp_stn}",
                "elementary_section_no": f"ES-{fp_stn}-{line_tag}-{es_num:02d}",
                "isolator_switches_to_open": [f"SM-{random.randint(100,199)}", f"CB-{random.randint(100,199)}"],
                "adjacent_line_isolation_required": random.choice([True, False])
            },
            "contact_wire_diameter_mm": wire_dia,
            "stagger_deviation_mm": round(random.uniform(10.0, 60.0), 1),
            "sparking_severity": random.choice(["NONE", "LIGHT", "HEAVY_EROSION"]),
            "power_block_type": random.choice(["LOCAL_ISOLATION", "LONGITUDINAL_FEED", "EMERGENCY_SHUTDOWN"]),
            "overdue_days": random.randint(0, 30),
            "priority": pri
        }
        records.append(rec)
        
    # Strict fail-fast Pydantic validation
    for r in records:
        TDMSCatenaryModel.model_validate(r)
        
    out_file = os.path.join(output_dir, "tdms_catenary_health.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        
    return records

if __name__ == "__main__":
    generate_tdms_demands()
