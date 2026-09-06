"""
RailSync-ABPS Simulator: Continuous Rail Thermometry (CRT) & Meteorology
=========================================================================
Delhi Division — Indian Railways (SIH26027)

Generates 24-hour hourly field sensor telemetry and unified 0-1439 minute continuous
temperature arrays aligning directly with COA train schedules and Section Controller rules.
Enforces IRPWM/RDSO track buckling thresholds (Tr > 60°C lockout at 13:00 for Test Case 3).
"""

import json
import random
import math
import os
from pathlib import Path
from typing import List, Dict, Any

from .schemas import CRTWeatherRecordModel

def generate_crt_weather(seed=42, output_dir="data"):
    """
    Generates CRT weather telemetry with unified 0-1439 minute scale and hourly records.
    Coordinates Test Case 3 (Rail Temperature Lockout on CORR_SOUTH).
    """
    random.seed(seed)
    
    sensors = [
        {"corridor": "CORR_NORTH", "stn": "SNP", "km": 44},
        {"corridor": "CORR_EAST", "stn": "MDNR", "km": 30},
        {"corridor": "CORR_SOUTH", "stn": "BVH", "km": 30},
        {"corridor": "CORR_WEST", "stn": "BGZ", "km": 31}
    ]
    
    results = []
    
    for sensor in sensors:
        # Pre-compute continuous 0-1439 minute temperature curve
        minute_Ta = []
        minute_Tr = []
        
        for m in range(1440):
            hr_float = m / 60.0
            
            # Ambient temperature (Ta)
            if 5.0 <= hr_float <= 19.0:
                ta = 35.0 + 9.0 * math.sin(math.pi * (hr_float - 5.0) / 14.0)
            elif hr_float < 5.0:
                ta = 26.0 + 6.0 * (1.0 - hr_float / 5.0)
            else:
                ta = 35.0 - 5.0 * ((hr_float - 19.0) / 4.0)
                
            # Solar gain on rail (Tr)
            if 6.0 <= hr_float <= 18.0:
                solar_gain = 18.0 * math.sin(math.pi * (hr_float - 6.0) / 12.0)
                tr = ta + max(0.0, solar_gain)
            else:
                tr = ta + 2.0
                
            # Test Case 3 Injection on CORR_SOUTH
            if sensor["corridor"] == "CORR_SOUTH":
                if 720 <= m <= 840:  # 12:00 to 14:00 (includes 13:00 / minute 780)
                    if m == 780:     # Exactly 13:00
                        tr = 61.5
                    elif tr <= 60.0:
                        tr = 60.5
                elif 660 <= m <= 900: # 11:00 to 15:00
                    if tr <= 48.0:
                        tr = 49.0
                        
            minute_Ta.append(round(ta, 1))
            minute_Tr.append(round(tr, 1))
            
        for hr in range(24):
            m = hr * 60
            Ta = minute_Ta[m]
            Tr = minute_Tr[m]
            
            # Weather events
            precip = 0.0
            if random.random() < 0.1:
                precip = round(random.uniform(1.0, 3.0), 1)
            elif hr == 16 and random.random() < 0.3:
                precip = round(random.uniform(6.0, 8.0), 1)
                
            wind = round(random.uniform(5.0, 25.0), 1)
            if 12 <= hr <= 17:
                wind = round(random.uniform(15.0, 25.0), 1)
            
            td = 38.0
            min_temp = 8.0
            max_temp = 48.0
            
            safe_tamping = (8.0 <= Tr <= 48.0)
            buckling = (Tr > 60.0)
            
            dt_str = f"2026-09-06T{hr:02d}:00:00+05:30"
            sensor_id = f"CRT-{sensor['stn']}-KM{sensor['km']:02d}"
            
            rec = {
                "sensor_probe_id": sensor_id,
                "corridor_id": sensor["corridor"],
                "station_code": sensor["stn"],
                "hour": hr,
                "minute_from_midnight": m,
                "timestamp": dt_str,
                "ambient_temp_celsius": Ta,
                "rail_temp_celsius": Tr,
                "de_stressing_temp_celsius": td,
                "safe_tamping_envelope": {
                    "min_temp": min_temp,
                    "max_temp": max_temp
                },
                "track_buckling_warning": buckling,
                "safe_for_tamping": safe_tamping,
                "precipitation_rate_mm_hr": precip,
                "wind_velocity_kmph": wind,
                "minute_temperature_curve": minute_Tr  # Full 1440-minute aligned array
            }
            
            # Fail-fast Pydantic validation
            CRTWeatherRecordModel.model_validate(rec)
            results.append(rec)
            
    os.makedirs(output_dir, exist_ok=True)
    out_file = Path(output_dir) / "crt_weather_telemetry.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
    return results

if __name__ == "__main__":
    generate_crt_weather()
