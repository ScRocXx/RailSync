"""
RailSync-ABPS: Real Indian Railways / CRIS Enterprise Adapters & Middleware
=============================================================================
Delhi Division — Indian Railways (SIH26027)

Provides enterprise payload ingestion, transformation, and normalization matching
the exact CRIS REST APIs, Oracle DB Views, Active MQs, and IoT sensor streams.
"""

from typing import Dict, Any, Optional, List, Tuple
from pydantic import BaseModel, Field, ConfigDict
from .schemas import (
    TMSDefectModel, TDMSCatenaryModel, SMMSSignallingModel, TMMSMachineModel,
    COAPassengerTrainModel, FOISFreightRakeModel, CRTWeatherRecordModel,
    CANONICAL_STATIONS
)


# ============================================================================
# 1. REAL OPERATIONS REALITY: EQUATION KILOMETERS & MAST NOTATION
# ============================================================================

# Historical track realignments cause equation kilometers in Delhi Division
EQUATION_KILOMETERS = {
    # (Corridor, KM_Marker): Physical length in meters (default is 1000m)
    ("CORR_NORTH", 42): 1080.0,
    ("CORR_NORTH", 75): 940.0,
    ("CORR_SOUTH", 38): 1060.0,
    ("CORR_WEST", 31): 920.0,
}

def parse_km_mast(km_mast_str: str) -> float:
    """
    Parses Indian Railways KM/Mast notation (e.g. '25/14') into decimal KM.
    Real Indian Railways standard: ~16 masts per KM (nominal 62.5m spacing).
    Formula: km = base_km + (mast_no - 1) / 16.0
    """
    if "/" not in km_mast_str:
        return float(km_mast_str)
    km_part, mast_part = km_mast_str.split("/", 1)
    base_km = float(km_part)
    mast_no = int(mast_part)
    return round(base_km + (mast_no - 1) / 16.0, 3)


def format_km_mast(km: float, corridor_id: Optional[str] = None) -> str:
    """
    Converts decimal KM to authentic Indian Railways KM/Mast notation.
    """
    base_km = int(km)
    remainder = km - base_km
    mast_no = int(remainder * 16) + 1
    return f"{base_km}/{mast_no}"


def get_physical_distance_km(corridor_id: str, from_km: float, to_km: float) -> float:
    """
    Calculates exact physical distance taking Equation Kilometers into account.
    """
    base_dist = to_km - from_km
    # Check if any equation kilometer falls within the range
    for (corr, eq_km), physical_m in EQUATION_KILOMETERS.items():
        if corr == corridor_id and from_km <= eq_km <= to_km:
            delta_km = (physical_m - 1000.0) / 1000.0
            base_dist += delta_km
    return round(base_dist, 3)


# ============================================================================
# 2. RAW CRIS ENTERPRISE PAYLOAD DEFINITIONS
# ============================================================================

class CRISTMSPayload(BaseModel):
    """TMS: CRIS REST API / Oracle DB View format."""
    model_config = ConfigDict(extra="ignore")

    Defect_ID: str
    Section_Code: str
    Track_Code: str
    KM_From: float
    Mast_From: str
    KM_To: float
    Mast_To: str
    Defect_Type: str
    TRC_Peak_Val: float
    TGI_Val: float
    USFD_Flaw_Classification: str
    Status: str
    Action_Required: str
    Overdue_Days: int


class CRISTDMSPayload(BaseModel):
    """TDMS: Web Service / Daily Export format."""
    model_config = ConfigDict(extra="ignore")

    Demand_No: str
    Sub_Sector: str
    Elementary_Section: str
    Isolator_IDs: List[str]
    Line_Affected: str
    Work_Type: str
    Adjacent_Line_Restriction: bool
    Earthing_Locations: List[str]
    Contact_Wire_Dia_MM: float
    KM_Start: float
    KM_End: float
    Priority: str


class CRISSMMSPayload(BaseModel):
    """SMMS: CRIS Web Portal / Event Queue format."""
    model_config = ConfigDict(extra="ignore")

    Station_Code: str
    Gear_Type: str
    Gear_ID: str
    Interlocking_Table_Ref: str
    Disconnection_Type: str
    Routes_Involved: List[str]
    Failure_Timestamp: str
    Operating_Time_Sec: float
    Operating_Current_Amp: float
    Status: str


class CRISTMMSPayload(BaseModel):
    """TMMS: Equipment Registry Feed format."""
    model_config = ConfigDict(extra="ignore")

    Machine_No: str
    Machine_Type: str
    Base_Depot: str
    Current_Station: str
    Current_Line_ID: str
    Fitness_Status: str
    Driver_Crew_ID: str
    Max_Haul_Speed: int
    POH_Due: str
    IOH_Due: str


class CRISCOAPayload(BaseModel):
    """COA: Active Message Queue (COA Enterprise Bus) format."""
    model_config = ConfigDict(extra="ignore")

    Train_No: str
    Loco_No: str
    Current_Location_KM: float
    Late_Mins: int
    Next_Station: str
    Expected_Arrival: str
    Section_Occupancy_Status: str
    Corridor_Code: str
    Direction: str


class CRISFOISPayload(BaseModel):
    """FOIS: Real-Time Transaction Queue format."""
    model_config = ConfigDict(extra="ignore")

    Rake_ID: str
    Stock_Type: str
    Total_Loads: int
    Total_Empties: int
    Gross_Weight: float
    Current_Station: str
    Destination: str
    Loop_Fit_Flag: bool
    Total_Length_M: float
    Commodity: str
    Transit_Hours: float


class CRTIoTPayload(BaseModel):
    """CRT: Field Sensor MQTT / HTTPS Stream format."""
    model_config = ConfigDict(extra="ignore")

    Device_EUI: str
    Station_Ref: str
    KM_Location: float
    Rail_Temp_C: float
    Ambient_Temp_C: float
    Timestamp: str
    Buckling_Alert: bool


# ============================================================================
# 3. BIDIRECTIONAL ADAPTERS & NORMALIZERS
# ============================================================================

class EnterpriseMiddlewareAdapter:
    """
    Normalizes authentic CRIS and IoT feeds into RailSync typed models,
    and serializes RailSync state back into CRIS enterprise payloads.
    """

    @staticmethod
    def cris_tms_to_internal(cris_rec: CRISTMSPayload) -> Dict[str, Any]:
        """Converts raw CRIS TMS REST record into RailSync internal TMS model dict."""
        tgi = cris_rec.TGI_Val
        pri = "CRITICAL" if tgi < 36.0 else ("URGENT" if tgi <= 50.0 else "AVERAGE")
        
        # Estimate TGI components if entering from CRIS Oracle view
        ui = round(tgi * 1.5, 1)
        ti = round(tgi * 1.2, 1)
        gi = round(tgi * 0.8, 1)
        ai = round(max(0.5, (tgi * 10 - 2 * ui - ti - gi) / 6.0), 1)
        comp_tgi = round((2 * ui + ti + gi + 6 * ai) / 10.0, 1)

        return {
            "inspection_id": cris_rec.Defect_ID,
            "corridor_id": cris_rec.Section_Code,
            "track_id": cris_rec.Track_Code,
            "chainage": {
                "from_km": cris_rec.KM_From,
                "to_km": cris_rec.KM_To,
                "from_mast": cris_rec.Mast_From,
                "to_mast": cris_rec.Mast_To,
            },
            "track_structure": {
                "rail_weight": "60KG",
                "sleeper_type": "PSC_MONOBLOCK",
                "sleeper_density": 1660,
                "gmt_carried": 200.0,
            },
            "tgi_breakdown": {
                "ui": ui,
                "ti": ti,
                "gi": gi,
                "ai": ai,
                "composite_tgi": comp_tgi,
            },
            "usfd_flaw": {
                "flaw_code": cris_rec.USFD_Flaw_Classification if cris_rec.USFD_Flaw_Classification in ["IMR", "IMRW", "OBS", "OBSW"] else "NONE",
                "defect_type": cris_rec.Defect_Type if cris_rec.Defect_Type in ["TRANSVERSE_FATIGUE", "HORIZONTAL_SPLIT", "WELD_CRACK", "BOLT_HOLE_CRACK"] else "NONE",
                "action_timeline_hours": 24 if cris_rec.USFD_Flaw_Classification == "IMR" else 0,
            },
            "ballast_cushion_depth_mm": 150,
            "required_action": cris_rec.Action_Required,
            "overdue_days": cris_rec.Overdue_Days,
            "priority": pri,
        }

    @staticmethod
    def internal_tms_to_cris(tms_rec: Dict[str, Any]) -> CRISTMSPayload:
        """Exports RailSync internal TMS model to raw CRIS Oracle DB View format."""
        return CRISTMSPayload(
            Defect_ID=tms_rec["inspection_id"],
            Section_Code=tms_rec["corridor_id"],
            Track_Code=tms_rec["track_id"],
            KM_From=tms_rec["chainage"]["from_km"],
            Mast_From=tms_rec["chainage"]["from_mast"],
            KM_To=tms_rec["chainage"]["to_km"],
            Mast_To=tms_rec["chainage"]["to_mast"],
            Defect_Type=tms_rec["usfd_flaw"]["defect_type"],
            TRC_Peak_Val=round(tms_rec["tgi_breakdown"]["ui"], 1),
            TGI_Val=tms_rec["tgi_breakdown"]["composite_tgi"],
            USFD_Flaw_Classification=tms_rec["usfd_flaw"]["flaw_code"],
            Status=tms_rec["priority"],
            Action_Required=tms_rec["required_action"],
            Overdue_Days=tms_rec["overdue_days"],
        )

    @staticmethod
    def internal_tdms_to_cris(tdms_rec: Dict[str, Any]) -> CRISTDMSPayload:
        """Exports RailSync internal TDMS model to CRIS Web Service format."""
        return CRISTDMSPayload(
            Demand_No=tdms_rec["demand_id"],
            Sub_Sector=tdms_rec["catenary_segment"]["sub_division"],
            Elementary_Section=tdms_rec["electrical_topology"]["elementary_section_no"],
            Isolator_IDs=tdms_rec["electrical_topology"]["isolator_switches_to_open"],
            Line_Affected="UP_MAIN" if "UP" in tdms_rec["electrical_topology"]["elementary_section_no"] else "DN_MAIN",
            Work_Type=tdms_rec["power_block_type"],
            Adjacent_Line_Restriction=tdms_rec["electrical_topology"]["adjacent_line_isolation_required"],
            Earthing_Locations=[tdms_rec["electrical_topology"]["feeding_post_id"], tdms_rec["electrical_topology"]["sub_sectioning_post_id"]],
            Contact_Wire_Dia_MM=tdms_rec["contact_wire_diameter_mm"],
            KM_Start=tdms_rec["catenary_segment"]["from_km"],
            KM_End=tdms_rec["catenary_segment"]["to_km"],
            Priority=tdms_rec["priority"],
        )

    @staticmethod
    def internal_smms_to_cris(smms_rec: Dict[str, Any]) -> CRISSMMSPayload:
        """Exports internal SMMS to CRIS Web Portal / Event Queue payload."""
        return CRISSMMSPayload(
            Station_Code=smms_rec["station_code"],
            Gear_Type="POINT_MACHINE" if "POINT" in smms_rec["gear_id"] else "TRACK_CIRCUIT",
            Gear_ID=smms_rec["gear_id"],
            Interlocking_Table_Ref=f"EIX-{smms_rec['station_code']}-TAB01",
            Disconnection_Type="ST-103" if smms_rec["disconnection_notice_required"] else "NONE",
            Routes_Involved=smms_rec["interlocked_routes_affected"],
            Failure_Timestamp="2026-09-06T08:00:00+05:30",
            Operating_Time_Sec=smms_rec["motor_throw_time_sec"],
            Operating_Current_Amp=smms_rec["motor_operating_current_amp"],
            Status=smms_rec["health_status"],
        )

    @staticmethod
    def internal_tmms_to_cris(tmms_rec: Dict[str, Any]) -> CRISTMMSPayload:
        """Exports internal TMMS to Equipment Registry Feed format."""
        return CRISTMMSPayload(
            Machine_No=tmms_rec["machine_id"],
            Machine_Type=tmms_rec["machine_type"],
            Base_Depot=tmms_rec["base_depot"],
            Current_Station=tmms_rec["current_stabling_location"]["station_code"],
            Current_Line_ID=tmms_rec["current_stabling_location"]["siding_id"],
            Fitness_Status=tmms_rec["fitness_certificate"]["status"],
            Driver_Crew_ID=tmms_rec["crew_hoer_state"]["crew_id"],
            Max_Haul_Speed=tmms_rec["max_operating_speed_kmph"],
            POH_Due=tmms_rec["fitness_certificate"]["poh_due_date"],
            IOH_Due=tmms_rec["fitness_certificate"]["ioh_due_date"],
        )

    @staticmethod
    def internal_fois_to_cris(fois_rec: Dict[str, Any]) -> CRISFOISPayload:
        """Exports internal FOIS to Real-Time Transaction Queue format."""
        return CRISFOISPayload(
            Rake_ID=fois_rec["rake_id"],
            Stock_Type=fois_rec["rake_configuration"]["wagon_type"],
            Total_Loads=fois_rec["rake_configuration"]["total_wagons"],
            Total_Empties=0,
            Gross_Weight=fois_rec["rake_configuration"]["gross_tonnage"],
            Current_Station=fois_rec["origin_station"],
            Destination=fois_rec["destination_station"],
            Loop_Fit_Flag=fois_rec["can_be_stabled_in_loop"],
            Total_Length_M=fois_rec["rake_configuration"]["total_length_meters"],
            Commodity=fois_rec["commodity_group"],
            Transit_Hours=round(fois_rec["estimated_transit_minutes"] / 60.0, 1),
        )

    @staticmethod
    def internal_crt_to_iot(crt_rec: Dict[str, Any]) -> CRTIoTPayload:
        """Exports internal CRT reading to Field Sensor MQTT stream format."""
        return CRTIoTPayload(
            Device_EUI=crt_rec["sensor_probe_id"],
            Station_Ref=crt_rec["station_code"],
            KM_Location=30.0,
            Rail_Temp_C=crt_rec["rail_temp_celsius"],
            Ambient_Temp_C=crt_rec["ambient_temp_celsius"],
            Timestamp=crt_rec["timestamp"],
            Buckling_Alert=crt_rec["track_buckling_warning"],
        )
