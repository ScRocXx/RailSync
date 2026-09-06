import json
import random
from pathlib import Path

from .schemas import FOISFreightRakeModel

def generate_fois_manifests(seed=42, output_dir="data"):
    """Generates freight rake manifests for RailSync-ABPS FOIS integration."""
    random.seed(seed)
    
    # Distribution of rakes
    # CORR_NORTH: ~3
    # CORR_EAST: ~3
    # CORR_SOUTH: ~3
    # CORR_WEST: ~3
    
    # 12 rakes total
    # 5 BOXNHL, 4 BTPN, 3 BLC
    
    rakes = []
    
    corridors = ["CORR_NORTH", "CORR_EAST", "CORR_SOUTH", "CORR_WEST"]
    rake_index = 0
    
    # Pre-define the 12 types
    types = [
        {"type": "BOXNHL", "commodity": "COAL_THERMAL", "wagons": 58, "tonnage": 4850.0, "len": 680.0, "spd": 50},
        {"type": "BOXNHL", "commodity": "COAL_THERMAL", "wagons": 58, "tonnage": 4850.0, "len": 680.0, "spd": 50},
        {"type": "BOXNHL", "commodity": "COAL_THERMAL", "wagons": 58, "tonnage": 4850.0, "len": 680.0, "spd": 50},
        {"type": "BOXNHL", "commodity": "COAL_THERMAL", "wagons": 58, "tonnage": 4850.0, "len": 680.0, "spd": 50},
        {"type": "BOXNHL", "commodity": "COAL_THERMAL", "wagons": 58, "tonnage": 4850.0, "len": 680.0, "spd": 50},
        
        {"type": "BTPN", "commodity": "POL_PETROLEUM", "wagons": 42, "tonnage": 2940.0, "len": 490.0, "spd": 55},
        {"type": "BTPN", "commodity": "POL_PETROLEUM", "wagons": 42, "tonnage": 2940.0, "len": 490.0, "spd": 55},
        {"type": "BTPN", "commodity": "POL_PETROLEUM", "wagons": 42, "tonnage": 2940.0, "len": 490.0, "spd": 55},
        {"type": "BTPN", "commodity": "POL_PETROLEUM", "wagons": 42, "tonnage": 2940.0, "len": 490.0, "spd": 55},
        
        {"type": "BLC", "commodity": "CONTAINER_CONCOR", "wagons": 45, "tonnage": 2700.0, "len": 530.0, "spd": 60},
        {"type": "BLC", "commodity": "CONTAINER_CONCOR", "wagons": 45, "tonnage": 2700.0, "len": 530.0, "spd": 60},
        {"type": "BLC", "commodity": "CONTAINER_CONCOR", "wagons": 45, "tonnage": 2700.0, "len": 530.0, "spd": 60}
    ]
    
    # Test case 4 specific rake must be in CORR_WEST
    # Let's handle it first
    tc4_rake = {
        "rake_id": "BOXNHL-COAL-NR-901",
        "corridor_id": "CORR_WEST",
        "commodity_group": "COAL_THERMAL",
        "direction": "UP",
        "origin_station": "ROK",
        "destination_station": "DLI",
        "rake_configuration": {
            "wagon_type": "BOXNHL",
            "total_wagons": 58,
            "gross_tonnage": 4850.0,
            "total_length_meters": 680.0
        },
        "speed_potential_kmph": 50,
        "powerhouse_criticality": "NORMAL",
        "can_be_stabled_in_loop": True,
        "preferred_departure_window": {
            "from_minutes": 120,
            "to_minutes": 360,
            "from_time_str": "02:00",
            "to_time_str": "06:00"
        },
        "estimated_transit_minutes": 180
    }
    rakes.append(tc4_rake)
    
    types.pop(0) # Remove one BOXNHL
    
    super_critical_count = 2
    
    for i in range(11):
        corr = corridors[i % 4]
        t = types[i]
        
        direction = random.choice(["UP", "DN"])
        
        # Dummy stations based on corridor and direction
        # Just simple names
        if corr == "CORR_NORTH":
            orig, dest = ("PNP", "DLI") if direction == "UP" else ("DLI", "PNP")
        elif corr == "CORR_EAST":
            orig, dest = ("MTC", "GZB") if direction == "UP" else ("GZB", "MTC")
        elif corr == "CORR_SOUTH":
            orig, dest = ("PWL", "NZM") if direction == "UP" else ("NZM", "PWL")
        else:
            orig, dest = ("ROK", "DLI") if direction == "UP" else ("DLI", "ROK")
            
        is_super = False
        if t["type"] == "BOXNHL" and super_critical_count > 0:
            if random.random() < 0.5 or super_critical_count > (4 - i):
                is_super = True
                super_critical_count -= 1
                
        # stabling logic: all these can be stabled if loop is standard, BGZ is 715 so yes, but some shorter ones can always stable
        # For simplicity, if len <= 715, it can fit, but in our logic BOXNHL 680 fits in 715 but not 686. 
        # The prompt says: "can_be_stabled_in_loop: True if length <= station CSR".
        can_stable = True if t["len"] <= 715 else False
        
        start_min = random.randint(0, 1000)
        end_min = min(1439, start_min + 240)
        
        rakes.append({
            "rake_id": f"{t['type']}-{t['commodity'][:4]}-NR-{902+i}",
            "corridor_id": corr,
            "commodity_group": t["commodity"],
            "direction": direction,
            "origin_station": orig,
            "destination_station": dest,
            "rake_configuration": {
                "wagon_type": t["type"],
                "total_wagons": t["wagons"],
                "gross_tonnage": t["tonnage"],
                "total_length_meters": t["len"]
            },
            "speed_potential_kmph": t["spd"],
            "powerhouse_criticality": "CRITICAL_SUPER" if is_super else "NORMAL",
            "can_be_stabled_in_loop": can_stable,
            "preferred_departure_window": {
                "from_minutes": start_min,
                "to_minutes": end_min,
                "from_time_str": f"{start_min // 60:02d}:{start_min % 60:02d}",
                "to_time_str": f"{end_min // 60:02d}:{end_min % 60:02d}"
            },
            "estimated_transit_minutes": random.randint(120, 300)
        })
    
    # Strict fail-fast Pydantic validation
    for r in rakes:
        FOISFreightRakeModel.model_validate(r)
        
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    out_file = Path(output_dir) / "fois_freight_manifests.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(rakes, f, indent=2, ensure_ascii=False)
        
    return rakes

if __name__ == "__main__":
    generate_fois_manifests()
