"""
RailSync-ABPS Simulator: Track Machine Management System (TMMS)
================================================================
Delhi Division — Indian Railways (SIH26027)

Generates track machine inventory with hardcoded Indian Railways kinematics,
stabling sidings, maintenance fitness status, and HOER crew duty states.
"""

import json
import random
import os
from pathlib import Path
from typing import Dict, Any, Optional

from .schemas import TMMSMachineModel

# Hardcoded Indian Railways Track Machine Kinematics
# Sources: RDSO Track Machine Operating Manual / IRICEN
MACHINE_KINEMATICS = {
    "BCM": {
        "transit_speed_kmph": 30.0,    # Real haulage/self-propelled transit speed
        "working_speed_kmph": 1.5,     # Deep screening speed (1.2 - 1.8 km/h)
        "ramp_in_minutes": 20,         # Cutter bar insertion & initial setup
        "ramp_out_minutes": 20         # Cutter bar retrieval & track consolidation
    },
    "CSM": {
        "transit_speed_kmph": 60.0,    # Self-propelled transit speed
        "working_speed_kmph": 1.8,     # Continuous tamping rate (~1.8 km/h or ~2000 sleepers/hr)
        "ramp_in_minutes": 15,         # Tamping unit calibration
        "ramp_out_minutes": 15         # Tamping unit locking & safety clearance
    },
    "UNIMAT": {
        "transit_speed_kmph": 50.0,    # Turnout tamping machine transit speed
        "working_speed_kmph": 1.2,     # Points & crossing tamping rate
        "ramp_in_minutes": 15,
        "ramp_out_minutes": 15
    },
    "PQRS": {
        "transit_speed_kmph": 30.0,    # Heavy portal crane transit speed
        "working_speed_kmph": 0.3,     # Panel renewal rate (~300m/h)
        "ramp_in_minutes": 30,
        "ramp_out_minutes": 30
    },
    "TW": {
        "transit_speed_kmph": 50.0,    # OHE tower wagon transit speed
        "working_speed_kmph": 5.0,     # Wire inspection / catenary adjustment speed
        "ramp_in_minutes": 10,
        "ramp_out_minutes": 10
    }
}


def calculate_transit_time_minutes(machine_type: str, distance_km: float) -> float:
    """Calculates transit time in minutes given distance and machine type."""
    kinematics = MACHINE_KINEMATICS.get(machine_type, MACHINE_KINEMATICS["CSM"])
    speed = kinematics["transit_speed_kmph"]
    return round((distance_km / speed) * 60.0, 1)


def calculate_work_window_minutes(machine_type: str, length_km: float) -> float:
    """Calculates total block window required (transit not included) including ramp in/out."""
    kinematics = MACHINE_KINEMATICS.get(machine_type, MACHINE_KINEMATICS["CSM"])
    working_time = (length_km / kinematics["working_speed_kmph"]) * 60.0
    total_window = kinematics["ramp_in_minutes"] + working_time + kinematics["ramp_out_minutes"]
    return round(total_window, 1)


def generate_tmms_inventory(seed=42, output_dir="data"):
    """
    Generates 14 TMMS track machine inventory records with strict kinematics.
    Validates output using Pydantic TMMSMachineModel before writing.
    """
    random.seed(seed)
    os.makedirs(output_dir, exist_ok=True)
    
    machines_spec = [
        {"id": "CSM-01", "type": "CSM", "model": "09-32_CSM", "speed": 60, "depot": "GZB", "station": "GZB"},
        {"id": "CSM-02", "type": "CSM", "model": "09-32_CSM", "speed": 60, "depot": "SSB", "station": "SSB"},
        {"id": "CSM-03", "type": "CSM", "model": "09-32_CSM", "speed": 60, "depot": "TKD", "station": "TKD"},
        {"id": "CSM-04", "type": "CSM", "model": "09-32_CSM", "speed": 60, "depot": "PNP", "station": "PNP"},
        {"id": "BCM-01", "type": "BCM", "model": "RM-80_BCM", "speed": 40, "depot": "GZB", "station": "GZB"},
        {"id": "BCM-02", "type": "BCM", "model": "RM-80_BCM", "speed": 40, "depot": "TKD", "station": "TKD"},
        {"id": "BCM-03", "type": "BCM", "model": "RM-80_BCM", "speed": 40, "depot": "ROK", "station": "ROK"},
        {"id": "TW-01", "type": "TW", "model": "4_WHEELER_TW", "speed": 50, "depot": "GZB", "station": "GZB"},
        {"id": "TW-02", "type": "TW", "model": "4_WHEELER_TW", "speed": 50, "depot": "TKD", "station": "TKD"},
        {"id": "TW-03", "type": "TW", "model": "8_WHEELER_TW", "speed": 50, "depot": "MTC", "station": "MTC"},
        {"id": "UNIMAT-01", "type": "UNIMAT", "model": "UNIMAT_08-475", "speed": 50, "depot": "SSB", "station": "SSB"},
        {"id": "UNIMAT-02", "type": "UNIMAT", "model": "UNIMAT_08-475", "speed": 50, "depot": "MTC", "station": "MTC"},
        {"id": "PQRS-01", "type": "PQRS", "model": "PQRS", "speed": 30, "depot": "PNP", "station": "PNP"},
        {"id": "PQRS-02", "type": "PQRS", "model": "PQRS", "speed": 30, "depot": "ROK", "station": "ROK"},
    ]
    
    stabling_corridors = {
        "GZB": "CORR_EAST",
        "SSB": "CORR_WEST",
        "TKD": "CORR_SOUTH",
        "PNP": "CORR_NORTH",
        "MTC": "CORR_EAST",
        "ROK": "CORR_WEST",
    }
    
    sick_candidates = [m["id"] for m in machines_spec if not m["id"].startswith("BCM")]
    sick_chosen = random.sample(sick_candidates, k=random.randint(2, 3))
    
    due_rest_candidates = [m["id"] for m in machines_spec if not m["id"].startswith("BCM")]
    due_rest_chosen = random.sample(due_rest_candidates, k=random.randint(1, 2))
    
    inventory = []
    
    for spec in machines_spec:
        # Fitness
        fitness_status = "SICK" if spec["id"] in sick_chosen else "FIT"
        poh_year = random.randint(2027, 2029)
        ioh_year = random.randint(2026, 2027)
        
        # Wear
        wear = round(random.uniform(5.0, 20.0), 1)
        fuel = round(random.uniform(300.0, 900.0), 1)
        
        # Crew
        crew_id = f"CREW-{spec['id']}"
        if spec["id"] in due_rest_chosen:
            duty_hours = round(random.uniform(8.5, 9.8), 1)
            rest_status = "DUE_REST"
        else:
            duty_hours = round(random.uniform(1.0, 5.5), 1)
            rest_status = "RESTED"
            
        kinematics_data = MACHINE_KINEMATICS[spec["type"]]
            
        machine = {
            "machine_id": spec["id"],
            "machine_type": spec["type"],
            "machine_model": spec["model"],
            "fitness_certificate": {
                "status": fitness_status,
                "poh_due_date": f"{poh_year}-03-15",
                "ioh_due_date": f"{ioh_year}-12-01"
            },
            "base_depot": spec["depot"],
            "current_stabling_location": {
                "station_code": spec["station"],
                "siding_id": f"SID-{spec['station']}-01",
                "has_free_runout_exit": True
            },
            "wear_and_consumables": {
                "tamping_tine_wear_percent": wear,
                "hsd_fuel_litres": fuel
            },
            "crew_hoer_state": {
                "crew_id": crew_id,
                "continuous_duty_hours": duty_hours,
                "max_permissible_hours": 10.0,
                "rest_status": rest_status
            },
            "max_operating_speed_kmph": spec["speed"],
            "corridor_assignment": stabling_corridors[spec["station"]],
            "kinematics": kinematics_data
        }
        
        # Strict Pydantic Validation (fail-fast)
        TMMSMachineModel.model_validate(machine)
        inventory.append(machine)
        
    output_path = Path(output_dir) / "tmms_machine_inventory.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(inventory, f, indent=2, ensure_ascii=False)
        
    return inventory

if __name__ == "__main__":
    generate_tmms_inventory()
