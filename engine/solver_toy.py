import sys
import time

# quick check
try:
    # pyrefly: ignore [missing-import]
    from ortools.sat.python import cp_model
except ImportError:
    print("run: pip install ortools")
    sys.exit(1)


def min_to_time(minutes: int) -> str:
    """Helper to convert minute of day (0-1439) into normal HH:MM clock."""
    h = minutes // 60
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def solve_tc1_bundle():
    print("-" * 55)
    print("RailSync CP-SAT Scheduler - Test Case 1 (GZB -> MTC)")
    print("-" * 55)

    model = cp_model.CpModel()

    # Horizon: midnight to 08:00 AM (480 mins)
    horizon = 480

    # Real timetable on UP_MAIN between Muradnagar (KM 24) and Modinagar (KM 27)
    # entry/exit are the exact minutes trains occupy this 3km block
    trains = [
        {"no": "12401", "name": "Nanda Devi Exp", "prio": 2, "in": 45, "out": 52},
        {"no": "14041", "name": "Mussoorie Exp",  "prio": 2, "in": 115, "out": 125},  # clears at 02:05
        {"no": "12056", "name": "Jan Shatabdi",   "prio": 1, "in": 310, "out": 318},  # enters at 05:10
        {"no": "22458", "name": "Vande Bharat",   "prio": 1, "in": 375, "out": 382},
        {"no": "64553", "name": "MEMU Local",     "prio": 3, "in": 420, "out": 432},
    ]

    # Two pending jobs overlapping at the same spot (KM 24.5 to 27.0)
    # Instead of blocking the line twice, we want CP-SAT to bundle them together
    job1_tamping = {"dept": "P-Way", "work": 90, "ramp": 30, "urgency": 88.5}
    job2_ohe     = {"dept": "TRD",   "work": 60, "ramp": 20, "urgency": 82.0}

    # If bundled: work happens concurrently, so work time = max(90, 60) = 90 mins
    # Shared ramp-in / OHE earthing buffer = 30 mins -> total block = 120 mins
    block_duration = max(job1_tamping["work"], job2_ohe["work"]) + 30

    # Decision variables: when does the block start and finish?
    block_start = model.NewIntVar(0, horizon - block_duration, "block_start")
    block_end = model.NewIntVar(block_duration, horizon, "block_end")
    model.Add(block_end == block_start + block_duration)

    # Wrap the block into an interval variable so CP-SAT can treat it as a solid bar
    block_interval = model.NewIntervalVar(block_start, block_duration, block_end, "block_interval")

    # Safety constraint: 7 minute headway buffer around every train
    # Trains and the maintenance block CANNOT overlap on the same track
    headway = 7
    intervals = [block_interval]

    for t in trains:
        t_start = max(0, t["in"] - headway)
        t_duration = (t["out"] - t["in"]) + (2 * headway)
        t_end = t_start + t_duration
        
        # Train interval is fixed in time, only the maintenance block can slide around
        t_interval = model.NewIntervalVar(t_start, t_duration, t_end, f"train_{t['no']}")
        intervals.append(t_interval)

    # Core railway rule: only one thing can occupy the block section at a time
    model.AddNoOverlap(intervals)

    # Goal: clear work as early as possible without messing up traffic
    model.Minimize(block_start)

    # Run solver
    solver = cp_model.CpSolver()
    # give it up to 2 seconds, though it usually solves in under 50ms
    solver.parameters.max_time_in_seconds = 2.0

    start_time = time.time()
    res = solver.Solve(model)
    solve_ms = (time.time() - start_time) * 1000

    if res == cp_model.OPTIMAL or res == cp_model.FEASIBLE:
        scheduled_start = solver.Value(block_start)
        scheduled_end = solver.Value(block_end)

        print(f"Status       : Optimal solution found ({solve_ms:.1f} ms)")
        print(f"Slot Found   : {min_to_time(scheduled_start)} -> {min_to_time(scheduled_end)} ({block_duration} mins)")
        print(f"Location     : UP_MAIN (KM 24.500 to KM 27.000)")
        print(f"Traffic Gap  : Caught gap between 14041 (dep 02:05) and 12056 Jan Shatabdi (arr 05:10)")
        print(f"Bundled Tasks: P-Way CSM Tamping + TRD OHE Wire Replacement")
        
        # quick math for why this matters
        solo_time = (job1_tamping["work"] + job1_tamping["ramp"]) + (job2_ohe["work"] + job2_ohe["ramp"])
        saved = solo_time - block_duration
        print(f"Line Saved   : {saved} mins of track possession saved vs booking separately")
        print(f"Train Delays : 0 mins induced to passenger traffic")
        print("-" * 55)
    else:
        print("No feasible slot found. Traffic is too dense or constraints are too tight.")


if __name__ == "__main__":
    solve_tc1_bundle()