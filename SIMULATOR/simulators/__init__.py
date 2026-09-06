"""
RailSync-ABPS Phase 1 Multi-Simulator Suite
============================================
Delhi Division — Indian Railways (SIH26027)

8 independent micro-simulators mirroring real Indian Railways production systems:
  1. sim_network    — Delhi Division 4-corridor topology backbone
  2. sim_tms        — P-Way Track Geometry & USFD flaw generator
  3. sim_tdms       — TRD OHE catenary wear & Elementary Section generator
  4. sim_smms       — S&T Point machine & Disconnection generator
  5. sim_tmms       — Track machine health, sidings & HOER crew
  6. sim_icms_tsr   — Active caution orders & speed limits
  7. sim_crt_weather— Rail thermometer (Tr) & Met curves
  8. sim_coa        — WTT passenger trains & RTIS delay clock
  9. sim_fois       — Unscheduled freight flows & loop stabling

All generators are deterministic (seed-controlled) and use only Python stdlib.
"""

from .sim_network import generate_network_topology
from .sim_tms import generate_tms_defects
from .sim_tdms import generate_tdms_demands
from .sim_smms import generate_smms_gears
from .sim_tmms import generate_tmms_inventory
from .sim_icms_tsr import generate_icms_restrictions
from .sim_crt_weather import generate_crt_weather
from .sim_coa import generate_coa_streams
from .sim_fois import generate_fois_manifests

__all__ = [
    "generate_network_topology",
    "generate_tms_defects",
    "generate_tdms_demands",
    "generate_smms_gears",
    "generate_tmms_inventory",
    "generate_icms_restrictions",
    "generate_crt_weather",
    "generate_coa_streams",
    "generate_fois_manifests",
]

__version__ = "1.0.0"
