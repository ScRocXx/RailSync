"""
RailSync-ABPS: Strict Pydantic Data Contracts & Schemas
=======================================================
Delhi Division — Indian Railways (SIH26027)

Provides 100% type-safe Pydantic v2 validation models for all 8 micro-simulator contracts
plus Network Topology, Machine Kinematics, and Event Bus Snapshots.
"""

from typing import List, Dict, Optional, Literal, Any
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict

# ============================================================================
# CANONICAL CATALOGS & ENUMS
# ============================================================================

CANONICAL_STATIONS = {
    "CORR_NORTH": ["DLI", "SZM", "ANDI", "NUR", "SNP", "GNU", "SMK", "PNP"],
    "CORR_EAST": ["GZB", "GZN", "MUD", "MDNR", "MUZ", "MTC"],
    "CORR_SOUTH": ["NZM", "OKA", "TKD", "FDB", "BVH", "AST", "PWL"],
    "CORR_WEST": ["DLI", "DEE", "SSB", "NNO", "BGZ", "SPZ", "ROK"],
}

ALL_VALID_STATION_CODES = {
    "DLI", "SZM", "ANDI", "NUR", "SNP", "GNU", "SMK", "PNP",
    "GZB", "GZN", "MUD", "MDNR", "MUZ", "MTC",
    "NZM", "OKA", "TKD", "FDB", "BVH", "AST", "PWL",
    "DEE", "SSB", "NNO", "BGZ", "SPZ", "ROK"
}

VALID_TRACK_IDS = {"UP_MAIN", "DN_MAIN", "3RD_LINE", "4TH_LINE", "LOOP"}

STABLING_STATIONS = {"GZB", "SSB", "TKD", "PNP", "MTC", "ROK"}

CorridorIDType = Literal["CORR_NORTH", "CORR_EAST", "CORR_SOUTH", "CORR_WEST"]
TrackIDType = Literal["UP_MAIN", "DN_MAIN", "3RD_LINE", "4TH_LINE", "LOOP"]
MachineTypeLiteral = Literal["CSM", "BCM", "TW", "UNIMAT", "PQRS"]
FitnessStatusLiteral = Literal["FIT", "SICK"]
PriorityLiteral = Literal["CRITICAL", "URGENT", "AVERAGE", "GOOD", "ROUTINE"]
USFDFlawLiteral = Literal["IMR", "IMRW", "OBS", "OBSW", "NONE"]
DefectTypeLiteral = Literal[
    "TRANSVERSE_FATIGUE", "HORIZONTAL_SPLIT", "WELD_CRACK", "BOLT_HOLE_CRACK", "NONE"
]
RequiredActionLiteral = Literal[
    "CSM_TAMPING", "BCM_DEEP_SCREENING", "TRT_RENEWAL", "MANUAL_PACKING", "DESTRESSING"
]


# ============================================================================
# 1. NETWORK TOPOLOGY SCHEMAS
# ============================================================================

class StationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    station_code: str
    station_name: str
    km_marker: float = Field(ge=0.0)
    has_platform_loop: bool = True
    loop_csr_meters: Optional[int] = Field(default=None, ge=500, le=1000)
    siding_ids: List[str] = Field(default_factory=list)
    crossover_switches: List[str] = Field(default_factory=list)
    platforms: int = Field(ge=1, le=16)

    @field_validator("station_code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        if v not in ALL_VALID_STATION_CODES:
            raise ValueError(f"Station code '{v}' is not in Delhi Division canonical station catalog")
        return v


class BlockSectionModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    section_id: str
    from_station: str
    to_station: str
    distance_km: float = Field(gt=0.0)
    lines: List[TrackIDType]

    @field_validator("from_station", "to_station")
    @classmethod
    def validate_stn(cls, v: str) -> str:
        if v not in ALL_VALID_STATION_CODES:
            raise ValueError(f"Station code '{v}' is not in Delhi Division catalog")
        return v


class CorridorModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    corridor_id: CorridorIDType
    corridor_name: str
    lines: List[TrackIDType]
    max_speed_kmph: int = Field(ge=60, le=200)
    total_length_km: float = Field(gt=0.0)
    stations: List[StationModel]
    block_sections: List[BlockSectionModel]


class NetworkTopologyMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    division: str = "Delhi"
    zone: str = "Northern Railway"
    generated_at: str
    seed: int


class NetworkTopologyModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    metadata: NetworkTopologyMetadata
    corridors: List[CorridorModel]


# ============================================================================
# 2. TRACK MANAGEMENT SYSTEM (TMS) SCHEMAS
# ============================================================================

class MastChainageModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_km: float = Field(ge=0.0)
    to_km: float = Field(ge=0.0)
    from_mast: str
    to_mast: str

    @model_validator(mode="after")
    def check_km_order(self) -> "MastChainageModel":
        if self.to_km < self.from_km:
            raise ValueError(f"to_km ({self.to_km}) cannot be less than from_km ({self.from_km})")
        return self


class TrackStructureModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rail_weight: Literal["60KG", "52KG"]
    sleeper_type: Literal["PSC_MONOBLOCK", "STEEL_TROUGH"]
    sleeper_density: int = Field(ge=1400, le=1800)
    gmt_carried: float = Field(ge=0.0)


class TGIBreakdownModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ui: float = Field(ge=0.0)
    ti: float = Field(ge=0.0)
    gi: float = Field(ge=0.0)
    ai: float = Field(ge=0.0)
    composite_tgi: float = Field(ge=0.0)

    @model_validator(mode="after")
    def verify_rdso_formula(self) -> "TGIBreakdownModel":
        # RDSO standard formula: (2*UI + TI + GI + 6*AI) / 10
        expected = (2.0 * self.ui + self.ti + self.gi + 6.0 * self.ai) / 10.0
        if abs(expected - self.composite_tgi) > 0.5:
            raise ValueError(
                f"composite_tgi ({self.composite_tgi}) does not match RDSO formula result ({expected:.1f})"
            )
        return self


class USFDFlawModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    flaw_code: USFDFlawLiteral
    defect_type: DefectTypeLiteral
    action_timeline_hours: int = Field(ge=0)


class TimeSlotMinutesModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=0, le=1439)


class TMSDefectModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    inspection_id: str
    corridor_id: CorridorIDType
    track_id: TrackIDType
    chainage: MastChainageModel
    track_structure: TrackStructureModel
    tgi_breakdown: TGIBreakdownModel
    usfd_flaw: USFDFlawModel
    ballast_cushion_depth_mm: int = Field(ge=50, le=400)
    required_action: RequiredActionLiteral
    overdue_days: int = Field(ge=0)
    priority: PriorityLiteral
    preferred_time_slot: Optional[str] = None
    preferred_time_slot_minutes: Optional[TimeSlotMinutesModel] = None


# ============================================================================
# 3. TRACTION DISTRIBUTION MANAGEMENT SYSTEM (TDMS) SCHEMAS
# ============================================================================

class CatenarySegmentModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_km: float = Field(ge=0.0)
    to_km: float = Field(ge=0.0)
    sub_division: str


class ElectricalTopologyModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    feeding_post_id: str
    sub_sectioning_post_id: str
    elementary_section_no: str
    isolator_switches_to_open: List[str]
    adjacent_line_isolation_required: bool


class TDMSCatenaryModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    demand_id: str
    corridor_id: CorridorIDType
    catenary_segment: CatenarySegmentModel
    electrical_topology: ElectricalTopologyModel
    contact_wire_diameter_mm: float = Field(ge=5.0, le=15.0)
    stagger_deviation_mm: float = Field(ge=0.0, le=100.0)
    sparking_severity: Literal["NONE", "LIGHT", "HEAVY_EROSION"]
    power_block_type: Literal["LOCAL_ISOLATION", "LONGITUDINAL_FEED", "EMERGENCY_SHUTDOWN"]
    overdue_days: int = Field(ge=0)
    priority: PriorityLiteral


# ============================================================================
# 4. SIGNALLING MAINTENANCE MANAGEMENT SYSTEM (SMMS) SCHEMAS
# ============================================================================

class SMMSSignallingModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    gear_id: str
    corridor_id: CorridorIDType
    station_code: str
    station_name: str
    turnout_number: str
    motor_throw_time_sec: float = Field(ge=1.0, le=15.0)
    motor_operating_current_amp: float = Field(ge=0.5, le=10.0)
    obstruction_test_5mm_passed: bool
    disconnection_notice_required: bool
    disconnection_memo_no: Optional[str] = None
    interlocked_routes_affected: List[str]
    health_status: Literal["HEALTHY", "DEGRADED", "CRITICAL"]

    @field_validator("station_code")
    @classmethod
    def check_stn(cls, v: str) -> str:
        if v not in ALL_VALID_STATION_CODES:
            raise ValueError(f"Station code '{v}' is invalid in SMMS")
        return v


# ============================================================================
# 5. TRACK MACHINE MANAGEMENT SYSTEM (TMMS) SCHEMAS
# ============================================================================

class MachineKinematicsModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    transit_speed_kmph: float = Field(gt=0.0, le=100.0)
    working_speed_kmph: float = Field(gt=0.0, le=20.0)
    ramp_in_minutes: int = Field(ge=5, le=45)
    ramp_out_minutes: int = Field(ge=5, le=45)


class FitnessCertificateModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: FitnessStatusLiteral
    poh_due_date: str
    ioh_due_date: str


class StablingLocationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    station_code: str
    siding_id: str
    has_free_runout_exit: bool

    @field_validator("station_code")
    @classmethod
    def check_stabling_stn(cls, v: str) -> str:
        if v not in STABLING_STATIONS:
            raise ValueError(f"Station '{v}' is not a valid stabling station")
        return v


class WearAndConsumablesModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tamping_tine_wear_percent: float = Field(ge=0.0, le=100.0)
    hsd_fuel_litres: float = Field(ge=0.0)


class CrewHoerStateModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    crew_id: str
    continuous_duty_hours: float = Field(ge=0.0, le=14.0)
    max_permissible_hours: float = Field(default=10.0, le=12.0)
    rest_status: Literal["RESTED", "DUE_REST"]


class TMMSMachineModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    machine_id: str
    machine_type: MachineTypeLiteral
    machine_model: str
    fitness_certificate: FitnessCertificateModel
    base_depot: str
    current_stabling_location: StablingLocationModel
    wear_and_consumables: WearAndConsumablesModel
    crew_hoer_state: CrewHoerStateModel
    max_operating_speed_kmph: int = Field(ge=20, le=80)
    corridor_assignment: CorridorIDType
    kinematics: Optional[MachineKinematicsModel] = None


# ============================================================================
# 6. CAUTION ORDERS / TEMPORARY SPEED RESTRICTIONS (ICMS) SCHEMAS
# ============================================================================

class StationSectionModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_station: str
    to_station: str

    @field_validator("from_station", "to_station")
    @classmethod
    def check_stn(cls, v: str) -> str:
        if v not in ALL_VALID_STATION_CODES:
            raise ValueError(f"Station '{v}' invalid in TSR")
        return v


class TSRChainageModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_km: float = Field(ge=0.0)
    to_km: float = Field(ge=0.0)
    line: TrackIDType

    @model_validator(mode="after")
    def check_km_order(self) -> "TSRChainageModel":
        if self.to_km <= self.from_km:
            raise ValueError(f"to_km ({self.to_km}) must be greater than from_km ({self.from_km})")
        return self


class ICMSSpeedRestrictionModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    caution_order_no: str
    corridor_id: CorridorIDType
    station_section: StationSectionModel
    chainage: TSRChainageModel
    restricted_speed_kmph: int = Field(ge=10, le=60)
    normal_sectional_speed_kmph: int = Field(ge=80, le=160)
    imposition_reason: Literal[
        "POST_TAMPING_CONSOLIDATION",
        "RAIL_FRACTURE_FISHPLATED",
        "BALLAST_DEFICIENCY",
        "DEEP_SCREENING_RECOVERY"
    ]
    imposition_date: str
    estimated_removal_date: str


# ============================================================================
# 7. CONTINUOUS RAIL THERMOMETRY & METEOROLOGY (CRT) SCHEMAS
# ============================================================================

class SafeTampingEnvelopeModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    min_temp: float = Field(default=8.0)
    max_temp: float = Field(default=48.0)


class CRTWeatherRecordModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sensor_probe_id: str
    corridor_id: CorridorIDType
    station_code: str
    hour: int = Field(ge=0, le=23)
    minute_from_midnight: Optional[int] = Field(default=None, ge=0, le=1439)
    timestamp: str
    ambient_temp_celsius: float
    rail_temp_celsius: float
    de_stressing_temp_celsius: float = 38.0
    safe_tamping_envelope: SafeTampingEnvelopeModel
    track_buckling_warning: bool
    safe_for_tamping: bool
    precipitation_rate_mm_hr: float = Field(ge=0.0)
    wind_velocity_kmph: float = Field(ge=0.0)


class CRTCorridorWeatherProfile(BaseModel):
    """Corridor profile containing 1440-minute continuous temperature curve arrays."""
    model_config = ConfigDict(extra="ignore")

    corridor_id: CorridorIDType
    sensor_probe_id: str
    station_code: str
    km_marker: float
    hourly_readings: List[CRTWeatherRecordModel]
    minute_ambient_temp: List[float] = Field(description="Length 1440 array of Ta from minute 0 to 1439")
    minute_rail_temp: List[float] = Field(description="Length 1440 array of Tr from minute 0 to 1439")


# ============================================================================
# 8. PASSENGER OPERATIONS (COA) SCHEMAS
# ============================================================================

class StationTrajectoryPointModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    station_code: str
    arr_scheduled: int = Field(ge=0, le=1439)
    dep_scheduled: int = Field(ge=0, le=1439)
    arr_actual_rtis: int = Field(ge=0, le=1439)
    dep_actual_rtis: int = Field(ge=0, le=1439)
    arr_time_str: Optional[str] = None  # HH:MM
    dep_time_str: Optional[str] = None  # HH:MM
    action: Literal["HALT", "PASS"]

    @field_validator("station_code")
    @classmethod
    def check_stn(cls, v: str) -> str:
        if v not in ALL_VALID_STATION_CODES:
            raise ValueError(f"Station '{v}' is invalid in train trajectory")
        return v


class COAPassengerTrainModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    train_no: str
    train_name: str
    corridor_id: CorridorIDType
    track_id: TrackIDType
    priority_rank: int = Field(ge=1, le=3)
    direction: Literal["UP", "DN"]
    max_permissible_speed_kmph: int = Field(ge=60, le=160)
    stations_trajectory: List[StationTrajectoryPointModel]
    current_delay_minutes: int = Field(ge=0)


# ============================================================================
# 9. FREIGHT OPERATIONS (FOIS) SCHEMAS
# ============================================================================

class RakeConfigurationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    wagon_type: Literal["BOXNHL", "BTPN", "BLC", "BCNHL"]
    total_wagons: int = Field(ge=10, le=65)
    gross_tonnage: float = Field(gt=500.0, le=6000.0)
    total_length_meters: float = Field(gt=200.0, le=800.0)


class PreferredDepartureWindowModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_minutes: int = Field(ge=0, le=1439)
    to_minutes: int = Field(ge=0, le=1439)
    from_time_str: Optional[str] = None
    to_time_str: Optional[str] = None


class FOISFreightRakeModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rake_id: str
    corridor_id: CorridorIDType
    commodity_group: Literal[
        "COAL_THERMAL", "POL_PETROLEUM", "CONTAINER_CONCOR", "IRON_ORE", "FOODGRAINS", "EMPTY_STOCK"
    ]
    direction: Literal["UP", "DN"]
    origin_station: str
    destination_station: str
    rake_configuration: RakeConfigurationModel
    speed_potential_kmph: int = Field(ge=30, le=100)
    powerhouse_criticality: Literal["CRITICAL_SUPER", "NORMAL"]
    can_be_stabled_in_loop: bool
    preferred_departure_window: PreferredDepartureWindowModel
    estimated_transit_minutes: int = Field(ge=30, le=600)


# ============================================================================
# 10. EVENT BUS SNAPSHOT SCHEMAS
# ============================================================================

class ActiveTrainSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    train_no: str
    train_name: str
    corridor_id: CorridorIDType
    track_id: TrackIDType
    priority_rank: int
    current_location_km: float
    current_status: Literal["RUNNING", "HALTED", "REGULATED_IN_LOOP"]
    current_section: str
    current_delay_mins: int
    next_station: str


class ActiveFreightSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rake_id: str
    corridor_id: CorridorIDType
    wagon_type: str
    commodity_group: str
    powerhouse_criticality: str
    current_status: Literal["IN_TRANSIT", "HELD_IN_LOOP", "QUEUED_ORIGIN"]
    stabled_at_station: Optional[str] = None
    held_duration_minutes: int = 0


class CorridorEnvSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    corridor_id: CorridorIDType
    ambient_temp_celsius: float
    rail_temp_celsius: float
    track_buckling_warning: bool
    safe_for_tamping: bool


class EventBusSnapshotModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    snapshot_minute: int = Field(ge=0, le=1439)
    clock_time_str: str  # HH:MM
    active_passenger_trains: List[ActiveTrainSnapshot]
    freight_movements: List[ActiveFreightSnapshot]
    corridor_temperatures: Dict[str, CorridorEnvSnapshot]
    active_caution_orders: int
    occupied_sections: List[str]
    system_events: List[str]
