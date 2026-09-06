"""
Simulator module for generating ICMS Temporary Speed Restrictions (TSR).
"""
import json
import random
import os
from pathlib import Path
from datetime import datetime, timedelta

from .schemas import ICMSSpeedRestrictionModel

CORRIDORS = {
    "CORR_NORTH": {
        "max_speed": 130,
        "stations": [
            ("DLI", 0.0), ("SZM", 3.0), ("ANDI", 9.0), ("NUR", 26.0),
            ("SNP", 44.0), ("GNU", 60.0), ("SMK", 72.0), ("PNP", 89.0)
        ]
    },
    "CORR_EAST": {
        "max_speed": 110,
        "stations": [
            ("GZB", 0.0), ("GZN", 5.0), ("MUD", 18.0),
            ("MDNR", 30.0), ("MUZ", 45.0), ("MTC", 48.0)
        ]
    },
    "CORR_SOUTH": {
        "max_speed": 160,
        "stations": [
            ("NZM", 0.0), ("OKA", 4.0), ("TKD", 11.0),
            ("FDB", 22.0), ("BVH", 30.0), ("AST", 46.0), ("PWL", 59.0)
        ]
    },
    "CORR_WEST": {
        "max_speed": 110,
        "stations": [
            ("DLI", 0.0), ("DEE", 4.0), ("SSB", 11.0),
            ("NNO", 17.0), ("BGZ", 31.0), ("SPZ", 49.0), ("ROK", 71.0)
        ]
    }
}

def generate_icms_restrictions(seed=42, output_dir="data"):
    """
    Generate active Temporary Speed Restrictions (TSRs).
    """
    random.seed(seed)
    
    dist = {
        "CORR_NORTH": 3,
        "CORR_EAST": 2,
        "CORR_SOUTH": 3,
        "CORR_WEST": 2
    }
    
    reasons = [
        "POST_TAMPING_CONSOLIDATION",
        "RAIL_FRACTURE_FISHPLATED",
        "BALLAST_DEFICIENCY",
        "DEEP_SCREENING_RECOVERY"
    ]
    
    results = []
    tsr_count = 1
    
    for corr_id, count in dist.items():
        corr_info = CORRIDORS[corr_id]
        stations = corr_info["stations"]
        max_speed = corr_info["max_speed"]
        
        for _ in range(count):
            idx = random.randint(0, len(stations) - 2)
            st1 = stations[idx]
            st2 = stations[idx+1]
            
            length = st2[1] - st1[1]
            from_km = round(st1[1] + random.uniform(0.1, length * 0.5), 2)
            to_km = round(from_km + random.uniform(0.5, 2.0), 2)
            if to_km > st2[1]:
                to_km = st2[1]
                
            reason = reasons[tsr_count % len(reasons)]
            
            imposition = datetime(2026, 9, 1) + timedelta(days=random.randint(0, 4))
            removal = datetime(2026, 9, 6) + timedelta(days=random.randint(5, 30))
            
            lines = ["UP_MAIN", "DN_MAIN"]
            if corr_id == "CORR_SOUTH":
                lines.extend(["3RD_LINE", "4TH_LINE"])
                
            line = random.choice(lines)
            
            rec = {
                "caution_order_no": f"TSR/DLI/2026/{tsr_count:03d}",
                "corridor_id": corr_id,
                "station_section": {
                    "from_station": st1[0],
                    "to_station": st2[0]
                },
                "chainage": {
                    "from_km": from_km,
                    "to_km": to_km,
                    "line": line
                },
                "restricted_speed_kmph": random.choice([20, 30, 45]),
                "normal_sectional_speed_kmph": max_speed,
                "imposition_reason": reason,
                "imposition_date": imposition.strftime("%Y-%m-%d"),
                "estimated_removal_date": removal.strftime("%Y-%m-%d")
            }
            results.append(rec)
            tsr_count += 1
            
    # Strict fail-fast Pydantic validation
    for r in results:
        ICMSSpeedRestrictionModel.model_validate(r)
        
    os.makedirs(output_dir, exist_ok=True)
    out_file = Path(output_dir) / "icms_speed_restrictions.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
    return results

if __name__ == "__main__":
    generate_icms_restrictions()
