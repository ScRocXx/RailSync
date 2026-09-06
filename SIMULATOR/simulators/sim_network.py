import json
import random
import os
from pathlib import Path
from datetime import datetime

def generate_network_topology(seed=42, output_dir="data"):
    """
    Generates the network topology for the RailSync-ABPS system.
    Defines 4 radiating corridors from the Delhi NCR hub.
    """
    random.seed(seed)
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    metadata = {
        "division": "Delhi",
        "zone": "Northern Railway",
        "generated_at": "2026-09-06T00:00:00Z",
        "seed": seed
    }
    
    stabling_stations = {"GZB", "SSB", "TKD", "PNP", "MTC", "ROK"}
    
    corridors_spec = [
        {
            "id": "CORR_NORTH",
            "name": "Delhi - Panipat (North)",
            "lines": ["UP_MAIN", "DN_MAIN"],
            "max_speed": 130,
            "stations": [
                ("DLI", "Delhi Junction", 0.0),
                ("SZM", "Sabzi Mandi", 3.0),
                ("ANDI", "Azadpur", 9.0),
                ("NUR", "Narela", 26.0),
                ("SNP", "Sonepat", 44.0),
                ("GNU", "Ganaur", 60.0),
                ("SMK", "Samalkha", 72.0),
                ("PNP", "Panipat", 89.0)
            ]
        },
        {
            "id": "CORR_EAST",
            "name": "Ghaziabad - Meerut City (East)",
            "lines": ["UP_MAIN", "DN_MAIN"],
            "max_speed": 110,
            "stations": [
                ("GZB", "Ghaziabad", 0.0),
                ("GZN", "Ghaziabad North", 5.0),
                ("MUD", "Murad Nagar", 18.0),
                ("MDNR", "Modinagar", 30.0),
                ("MUZ", "Muzzafarnagar", 45.0),
                ("MTC", "Meerut City", 48.0)
            ]
        },
        {
            "id": "CORR_SOUTH",
            "name": "Hazrat Nizamuddin - Palwal (South)",
            "lines": ["UP_MAIN", "DN_MAIN", "3RD_LINE", "4TH_LINE"],
            "max_speed": 160,
            "stations": [
                ("NZM", "Hazrat Nizamuddin", 0.0),
                ("OKA", "Okhla", 4.0),
                ("TKD", "Tughlakabad", 11.0),
                ("FDB", "Faridabad", 22.0),
                ("BVH", "Ballabgarh", 30.0),
                ("AST", "Asaoti", 46.0),
                ("PWL", "Palwal", 59.0)
            ]
        },
        {
            "id": "CORR_WEST",
            "name": "Delhi - Rohtak (West)",
            "lines": ["UP_MAIN", "DN_MAIN"],
            "max_speed": 110,
            "stations": [
                ("DLI", "Delhi Junction", 0.0),
                ("DEE", "Delhi Sarai Rohilla", 4.0),
                ("SSB", "Shakurbasti", 11.0),
                ("NNO", "Nangloi", 17.0),
                ("BGZ", "Bahadurgarh", 31.0),
                ("SPZ", "Sampla", 49.0),
                ("ROK", "Rohtak", 71.0)
            ]
        }
    ]
    
    corridors_output = []
    
    for spec in corridors_spec:
        corridor_stations = []
        block_sections = []
        
        stations = spec["stations"]
        for i, (code, name, km) in enumerate(stations):
            # Crossover at approximately every other station
            has_crossover = (i % 2 == 0)
            
            crossovers = []
            if has_crossover:
                crossovers = [f"XOVER-{code}-1", f"XOVER-{code}-2"]
                
            siding_ids = []
            if code in stabling_stations:
                siding_ids = [f"SID-{code}-01", f"SID-{code}-02"]
                
            loop_csr = random.choice([600, 650, 700])
            if code == "BGZ":
                loop_csr = 715
            elif code in stabling_stations:
                loop_csr = max(loop_csr, 700)
                
            is_major = code in stabling_stations or code in ["DLI", "NZM"]
            platforms = random.randint(3, 6) if is_major else random.randint(1, 3)
            
            station_obj = {
                "station_code": code,
                "station_name": name,
                "km_marker": float(km),
                "has_platform_loop": True,
                "loop_csr_meters": loop_csr,
                "siding_ids": siding_ids,
                "crossover_switches": crossovers,
                "platforms": platforms
            }
            corridor_stations.append(station_obj)
            
        for i in range(len(stations) - 1):
            from_code, _, from_km = stations[i]
            to_code, _, to_km = stations[i+1]
            dist = round(to_km - from_km, 2)
            
            section_id = f"{spec['id']}_{from_code}_{to_code}"
            
            block_section = {
                "section_id": section_id,
                "from_station": from_code,
                "to_station": to_code,
                "distance_km": dist,
                "lines": spec["lines"].copy()
            }
            block_sections.append(block_section)
            
        corridor_obj = {
            "corridor_id": spec["id"],
            "corridor_name": spec["name"],
            "lines": spec["lines"].copy(),
            "max_speed_kmph": spec["max_speed"],
            "total_length_km": float(stations[-1][2]),
            "stations": corridor_stations,
            "block_sections": block_sections
        }
        corridors_output.append(corridor_obj)
        
    topology_data = {
        "metadata": metadata,
        "corridors": corridors_output
    }
    
    output_file = os.path.join(output_dir, "network_topology.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(topology_data, f, indent=2, ensure_ascii=False)
        
    return topology_data

if __name__ == "__main__":
    data = generate_network_topology()
    print(f"Generated {len(data['corridors'])} corridors.")
    for c in data['corridors']:
        print(f" - {c['corridor_name']}: {len(c['stations'])} stations, {c['total_length_km']} km")
