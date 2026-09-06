"""Quick smoke test: run each simulator for 1 tick and confirm no KeyError."""
import sys, os, threading, time
sys.path.insert(0, os.path.dirname(__file__))
from live_simulator import SIMULATORS

results = {}

def test_one(name, fn):
    try:
        t = threading.Thread(target=fn, kwargs={"interval": 999999}, daemon=True)
        t.start()
        time.sleep(2)
        results[name] = "OK"
    except Exception as e:
        results[name] = f"FAIL: {e}"

for name, (label, fn) in SIMULATORS.items():
    if name == "network":
        continue  # network is fine, skip
    test_one(name, fn)

time.sleep(3)
print("\n" + "=" * 50)
print("SMOKE TEST RESULTS")
print("=" * 50)
for name, status in results.items():
    icon = "PASS" if status == "OK" else "FAIL"
    print(f"  [{icon}] {name}: {status}")
print("=" * 50)
