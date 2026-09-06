@echo off
title RailSync Multi-Simulator Launcher
echo =====================================================================
echo  RailSync-ABPS: Spawning All 8 Simulators in Separate Live Terminals
echo =====================================================================

start "RailSync - COA Passenger Timetable" cmd /k "python live_simulator.py --sim coa --interval 0.8"
start "RailSync - FOIS Freight Rakes" cmd /k "python live_simulator.py --sim fois --interval 1.0"
start "RailSync - CRT Rail Thermometry" cmd /k "python live_simulator.py --sim crt --interval 0.8"
start "RailSync - TMS Track Geometry" cmd /k "python live_simulator.py --sim tms --interval 1.0"
start "RailSync - TDMS Catenary Wire" cmd /k "python live_simulator.py --sim tdms --interval 1.0"
start "RailSync - SMMS Point Machines" cmd /k "python live_simulator.py --sim smms --interval 1.0"
start "RailSync - TMMS Track Machines" cmd /k "python live_simulator.py --sim tmms --interval 1.2"
start "RailSync - ICMS Speed Restrictions" cmd /k "python live_simulator.py --sim icms --interval 1.0"

echo.
echo [DONE] All 8 raw-telemetry simulator windows spawned!
echo.
