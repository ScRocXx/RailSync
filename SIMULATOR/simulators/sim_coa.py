import json
import random
import math
import os
from pathlib import Path

from .schemas import COAPassengerTrainModel

# Corridor definitions
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
            ("GZB", 0.0), ("GZN", 5.0), ("MUD", 18.0), ("MDNR", 30.0),
            ("MUZ", 45.0), ("MTC", 48.0)
        ]
    },
    "CORR_SOUTH": {
        "max_speed": 160,
        "stations": [
            ("NZM", 0.0), ("OKA", 4.0), ("TKD", 11.0), ("FDB", 22.0),
            ("BVH", 30.0), ("AST", 46.0), ("PWL", 59.0)
        ],
        "tracks": ["UP_MAIN", "DN_MAIN", "3RD_LINE", "4TH_LINE"]
    },
    "CORR_WEST": {
        "max_speed": 110,
        "stations": [
            ("DLI", 0.0), ("DEE", 4.0), ("SSB", 11.0), ("NNO", 17.0),
            ("BGZ", 31.0), ("SPZ", 49.0), ("ROK", 71.0)
        ]
    }
}

def generate_trains_for_corridor(corridor_id, num_trains, counts_by_priority):
    corr = CORRIDORS[corridor_id]
    max_corr_speed = corr["max_speed"]
    stations = corr["stations"]
    
    trains = []
    
    # We will track occupied times at each station per (track, direction) to ensure 7.0 min headway
    occupied = {} # (track, direction, station) -> list of departure/arrival times
    
    # Distribute trains across the day (1440 minutes)
    # Peak hours: 360-600 (06:00-10:00) and 960-1320 (16:00-22:00)
    
    priorities = []
    for p, c in counts_by_priority.items():
        priorities.extend([p] * c)
    random.shuffle(priorities)
    
    for i, priority in enumerate(priorities):
        direction = "UP" if random.choice([True, False]) else "DN"
        track_id = "UP_MAIN" if direction == "UP" else "DN_MAIN"
        if corridor_id == "CORR_SOUTH":
            if direction == "UP":
                track_id = random.choice(["UP_MAIN", "3RD_LINE"])
            else:
                track_id = random.choice(["DN_MAIN", "4TH_LINE"])
        
        # Train type setup
        train_no = f"{random.randint(10000, 99999)}"
        if priority == 1:
            if random.random() < 0.33:
                t_name = f"Vande Bharat Express"
                max_train_speed = 160
            elif random.random() < 0.5:
                t_name = f"Shatabdi Express"
                max_train_speed = 150
            else:
                t_name = f"Rajdhani Express"
                max_train_speed = 130
        elif priority == 2:
            t_name = f"Mail/Express"
            max_train_speed = random.choice([110, 120, 130])
        else:
            t_name = f"Suburban EMU"
            max_train_speed = 80
            
        max_speed = min(max_train_speed, max_corr_speed)
        
        # Train speed multiplier
        if priority == 1:
            avg_speed = 0.75 * max_speed
            delay_max = 8
        elif priority == 2:
            avg_speed = 0.7 * max_speed
            delay_max = 20
        else:
            avg_speed = 0.5 * max_speed
            delay_max = 35
            
        # Determine start time that respects headway
        # We try random times and check for collisions
        start_time_found = False
        start_time = 0
        attempts = 0
        while not start_time_found and attempts < 1000:
            attempts += 1
            if random.random() < 0.6: # Peak preference
                if random.random() < 0.5:
                    start_time = random.randint(360, 600)
                else:
                    start_time = random.randint(960, 1240)
            else:
                start_time = random.randint(0, 1240)
                
            # Simulate trajectory
            current_time = start_time
            traj = []
            
            st_list = stations if direction == "UP" else list(reversed(stations))
            conflict = False
            
            for j, (st_code, km) in enumerate(st_list):
                if j == 0:
                    arr_sched = current_time
                    dep_sched = current_time + random.randint(2, 5) if priority > 1 else current_time + 2
                    action = "HALT"
                else:
                    prev_km = st_list[j-1][1]
                    dist = abs(km - prev_km)
                    travel_time = math.ceil((dist / avg_speed) * 60)
                    current_time += travel_time
                    arr_sched = current_time
                    
                    if priority == 3 or j == len(st_list)-1 or (priority == 2 and random.random() < 0.3):
                        halt_time = random.randint(1, 5)
                        dep_sched = arr_sched + halt_time
                        action = "HALT"
                    else:
                        dep_sched = arr_sched
                        action = "PASS"
                
                if dep_sched + delay_max > 1439:
                    conflict = True
                    break
                    
                # Check headway
                key = (track_id, direction, st_code)
                if key in occupied:
                    for ext_arr, ext_dep in occupied[key]:
                        # Must be at least 7 minutes apart
                        if not (dep_sched + 7 <= ext_arr or arr_sched - 7 >= ext_dep):
                            conflict = True
                            break
                if conflict:
                    break
                    
                traj.append({
                    "station_code": st_code,
                    "arr_scheduled": arr_sched,
                    "dep_scheduled": dep_sched,
                    "action": action
                })
                current_time = dep_sched
            
            if not conflict:
                start_time_found = True
                
                # Register occupied
                delay_offset = random.randint(0, delay_max)
                for t in traj:
                    key = (track_id, direction, t["station_code"])
                    if key not in occupied:
                        occupied[key] = []
                    occupied[key].append((t["arr_scheduled"], t["dep_scheduled"]))
                    
                    t["arr_actual_rtis"] = t["arr_scheduled"] + delay_offset
                    t["dep_actual_rtis"] = t["dep_scheduled"] + delay_offset
                    t["arr_time_str"] = f"{t['arr_scheduled'] // 60:02d}:{t['arr_scheduled'] % 60:02d}"
                    t["dep_time_str"] = f"{t['dep_scheduled'] // 60:02d}:{t['dep_scheduled'] % 60:02d}"
                    
                trains.append({
                    "train_no": train_no,
                    "train_name": t_name,
                    "corridor_id": corridor_id,
                    "track_id": track_id,
                    "priority_rank": priority,
                    "direction": direction,
                    "max_permissible_speed_kmph": max_speed,
                    "stations_trajectory": traj,
                    "current_delay_minutes": delay_offset
                })
    return trains


def generate_coa_streams(seed=42, output_dir="data"):
    """Generates passenger train streams for RailSync-ABPS COA integration."""
    random.seed(seed)
    
    # 36 total:
    # CORR_NORTH: 9
    # CORR_EAST: 9
    # CORR_SOUTH: 10
    # CORR_WEST: 8
    
    trains = []
    trains.extend(generate_trains_for_corridor("CORR_NORTH", 9, {1: 1, 2: 5, 3: 3}))
    trains.extend(generate_trains_for_corridor("CORR_EAST", 9, {1: 1, 2: 5, 3: 3}))
    trains.extend(generate_trains_for_corridor("CORR_SOUTH", 10, {1: 2, 2: 5, 3: 3}))
    trains.extend(generate_trains_for_corridor("CORR_WEST", 8, {1: 2, 2: 3, 3: 3}))
    
    # Strict fail-fast Pydantic validation
    for t in trains:
        COAPassengerTrainModel.model_validate(t)
        
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    out_file = Path(output_dir) / "coa_passenger_streams.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(trains, f, indent=2, ensure_ascii=False)
        
    return trains

if __name__ == "__main__":
    generate_coa_streams()
