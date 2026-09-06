import json
import random
import os
from pathlib import Path

from .schemas import SMMSSignallingModel

CORRIDORS = {
    "CORR_NORTH": [
        ("DLI", "Delhi Junction"), ("SZM", "Sabzi Mandi"), ("ANDI", "Azadpur"),
        ("NUR", "Narela"), ("SNP", "Sonepat"), ("GNU", "Ganaur"),
        ("SMK", "Samalkha"), ("PNP", "Panipat")
    ],
    "CORR_EAST": [
        ("GZB", "Ghaziabad"), ("GZN", "Ghaziabad North"), ("MUD", "Murad Nagar"),
        ("MDNR", "Modinagar"), ("MUZ", "Muzzafarnagar"), ("MTC", "Meerut City")
    ],
    "CORR_SOUTH": [
        ("NZM", "Hazrat Nizamuddin"), ("OKA", "Okhla"), ("TKD", "Tughlakabad"),
        ("FDB", "Faridabad"), ("BVH", "Ballabgarh"), ("AST", "Asaoti"),
        ("PWL", "Palwal")
    ],
    "CORR_WEST": [
        ("DLI", "Delhi Junction"), ("DEE", "Delhi Sarai Rohilla"), ("SSB", "Shakurbasti"),
        ("NNO", "Nangloi"), ("BGZ", "Bahadurgarh"), ("SPZ", "Sampla"),
        ("ROK", "Rohtak")
    ]
}

def generate_smms_gears(seed=42, output_dir="data"):
    """Generates SMMS signalling gears inventory."""
    random.seed(seed)
    os.makedirs(output_dir, exist_ok=True)
    
    gears = []
    gear_count = 0
    
    # 5 items per corridor
    for corridor_id, stations in CORRIDORS.items():
        for _ in range(5):
            station_code, station_name = random.choice(stations)
            gear_count += 1
            
            gear_type = random.choices(["POINT", "TC", "SSDAC"], weights=[60, 20, 20])[0]
            if gear_type == "POINT":
                gear_id = f"POINT-10{gear_count}{random.choice(['A', 'B'])}"
                turnout = random.choice(["1 in 12 Curved Switch", "1 in 8.5 Turnout"])
            elif gear_type == "TC":
                gear_id = f"TC-{100 + gear_count}T"
                turnout = "N/A"
            else:
                gear_id = f"SSDAC-AXLE-{10 + gear_count}"
                turnout = "N/A"
            
            # Health generation
            health_rand = random.random()
            if health_rand > 0.95 and len([g for g in gears if g.get("health_status") == "CRITICAL"]) < 2:
                health = "CRITICAL"
            elif health_rand > 0.8:
                health = "DEGRADED"
            else:
                health = "HEALTHY"
                
            if health == "HEALTHY":
                throw_time = round(random.uniform(3.5, 5.1), 1)
                current = round(random.uniform(1.5, 3.4), 1)
            elif health == "DEGRADED":
                if random.choice([True, False]):
                    throw_time = round(random.uniform(5.3, 6.8), 1)
                    current = round(random.uniform(1.5, 3.4), 1)
                else:
                    throw_time = round(random.uniform(3.5, 5.1), 1)
                    current = round(random.uniform(3.6, 3.8), 1)
            else: # CRITICAL
                throw_time = round(random.uniform(5.3, 6.8), 1)
                current = round(random.uniform(3.6, 3.8), 1)
                
            disc_req = random.choice([True, False])
            disc_memo = f"ST-103/2026/{random.randint(100, 999):03d}" if disc_req else None
            
            routes = [f"R-{station_code}-UP-{random.randint(1,4):02d}", f"R-{station_code}-DN-{random.randint(1,4):02d}"]
            
            gear = {
                "gear_id": gear_id,
                "corridor_id": corridor_id,
                "station_code": station_code,
                "station_name": station_name,
                "turnout_number": turnout,
                "motor_throw_time_sec": throw_time,
                "motor_operating_current_amp": current,
                "obstruction_test_5mm_passed": random.choice([True, True, True, False]) if health != "CRITICAL" else False,
                "disconnection_notice_required": disc_req,
                "disconnection_memo_no": disc_memo,
                "interlocked_routes_affected": routes,
                "health_status": health
            }
            gears.append(gear)
            
    # Strict fail-fast Pydantic validation
    for g in gears:
        SMMSSignallingModel.model_validate(g)
        
    output_path = Path(output_dir) / "smms_signalling_gears.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(gears, f, indent=2, ensure_ascii=False)
        
    return gears

if __name__ == "__main__":
    generate_smms_gears()
