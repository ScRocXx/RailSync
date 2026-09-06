# RailSync — Delhi Division Section Controller Dashboard

An operations board for the Section Controller (SCR) of Delhi Division, Northern
Railway. It reads the RailSync simulator feeds and presents them in the visual
language a controller actually works in: a string chart, a schematic, a demand
queue, and a block-approval drawer.

Every number on screen is derived from `../SIMULATOR/data` — nothing is mocked.

---

## Running it

```bash
npm install        # once — installs TypeScript
npm run data       # compile the simulator feeds into js/railsync-data.js
npm run build      # compile src/*.ts into js/dashboard.js
```

Then open `index.html`. It works straight off the filesystem (classic script
tags, no fetch, no modules), or serve it if you prefer:

```bash
npm run serve
```

`npm run watch` recompiles the TypeScript on save.

---

## Architecture

The heavy joins happen once, in Python, at build time; the browser is a pure
rendering layer over the result.

```
../SIMULATOR/data/*.json          9 raw departmental feeds
        │
        │  build_data.py          path geometry · urgency scoring
        │                         conflict engine · block planning
        ▼
js/railsync-data.js               one typed bundle (~200 KB)
        │
        │  src/*.ts               strict TypeScript, namespaces
        │  tsc --outFile
        ▼
js/dashboard.js                   single classic script
```

`src/types.ts` is the contract between the two halves. If you change a field in
`build_data.py`, change it there too — `tsc` will then point at every call site
that needs updating.

### Source layout

| File | Role |
|---|---|
| `build_data.py` | Joins the feeds, scores demands, plans blocks, writes the bundle |
| `src/types.ts` | Shape of the bundle and of app state |
| `src/core.ts` | State, division clock, geometry, conflict maths, DOM helpers |
| `src/marey.ts` | (i) Master time–distance string chart |
| `src/network.ts` | (ii) Schematic track network map |
| `src/queue.ts` | (iii) Ingestion feed, scorer queue, proposal shortlist |
| `src/drawer.ts` | (iv) Block approval & recommendation drawer |
| `src/analytics.ts` | (v) Reports and (vii) decision log |
| `src/fleet.ts` | (vi) Fleet & crew HOER tracker — mobile resources |
| `src/app.ts` | Division health banner, clock, view switching |

---

## Layout

```
LIVE TELEMETRY RIBBON   clock · punctuality · rail Tr vs td · trains · backlog · active TSR
├── PRIMARY WORKSPACE                    ├── DECISION & INTERVENTION PANEL
│   [Time–Distance Chart]  chart + synced schematic  │   Recommended blocks (urgency scored)
│   [Corridor Track Map]   main lines vs loops       │   [Ingestion Feed] [Rejection Audit]
│   [Fleet & Crew HOER]    plant + duty hours        │   → approval drawer
```

Continuous telemetry lives in the ribbon, not behind an analytics menu: a
controller needs rail temperature and active caution orders in view *while*
approving a block. Hovering the TSR chip lists the caution orders in force.

The string chart and the schematic share one workspace tab because that is what
makes cursor synchronisation useful — hovering a train path or a block window on
the chart lights the same train marker and the same track segments on the
schematic in the same instant, and hovering a marker on the schematic works in
reverse. The Corridor Track Map tab is the same schematic given full height for
reading loops and sidings.

Item (iii) covers **fixed track assets** (geometry, catenary, point motors);
item (vi) covers **mobile resources** (where plant is stabled, what duty its
crew has left). They do not overlap.

---

## The five foundational views

**1. Master string chart (Marey diagram).** Time on X, chainage on Y with
km 0 at the bottom, so UP trains (km increasing) slope upward and DN trains
slope downward. Paths are coloured by priority — gold Premium, blue Mail/
Express, green suburban EMU, dashed brown freight. A delayed train also draws
its booked path faintly behind the actual, so lost time is visible as the gap.
Maintenance blocks are hatched rectangles in time–distance space; TSRs are red
bands across the chainage they restrict. Hover a path for train detail, click a
block for its work permit. 24h / 8h / 4h zoom, drag to pan.

**2. Schematic track network.** One horizontal lane per running line **plus a
dedicated loop lane**, stations at true chainage, corridor switcher across the
four trunks (DLI–PNP, GZB–MTC, NZM–PWL, DLI–ROK). Each block section is coloured
by live state — green clear, red occupied, amber hatched under a maintenance
block. Trains are directional chevrons at their interpolated kilometre mark; a
standing train gets a red dot. Machine depots show fit/total plant.

Loops carry their clear standing room (CSR) and turn brown with a rake drawn in
them while freight is regulated during a block, so the controller can see the
regulation rather than infer it.

**3. Ingestion feed & scorer.** All 80 fixed-asset demands from TMS (P-Way),
TDMS (TRD) and SMMS (S&T) in one queue, with the raw telemetry the score is
built from — composite TGI, contact wire diameter, point throw time — plus days
overdue and the 0–100 urgency score. Filter by department, urgency band, or
corridor.

Hovering a row opens **"Why this score?"**: the physical drivers first
(*Composite TGI 26.8 → +33.0*, *USFD flaw IMR → +20.0*, *25 days overdue →
+25.0*, *11 trains/day → +15.0*), then the component totals, then the score.
Controllers distrust a bare number; the parameters come before the verdict. The
same driver chips appear on each task card in the drawer.

**4. Block approval drawer.** The work permit for a proposal, opening with the
**work-vs-window split** — a stacked bar showing protection, OHE earthing,
machine ramp and the physical work inside the granted window (e.g. 290 min
granted for 240 min of work). Then the **joint savings callout** (*"Bundling
TDMS + TMS into one possession saves 160 minutes of independent line possession
— 480 min as 2 separate blocks vs 320 min bundled"*), bundled tasks with their
score drivers, allocated plant, impact metrics, freight regulation, overrun
risk, and the post-work TSR.

Three actions — Approve, Reject/Defer, Shift Time Slot. Dragging the slot
re-scores impact live against the same conflict engine the planner used.

**5. Division health banner.** Punctuality index, division clock with
play/pause and 1×/8×/60× speeds, rail temperature against the de-stressing
temperature t\_d, trains on section, backlog, blocks approved, active TSR count.

**6. Fleet & crew HOER tracker.** Depot roll-up of where every machine is
stabled, then a card per machine: the HOER red-line badge, tine wear, fuel,
IOH/POH dates, and the blocks it is booked to today. Click a booked block to
open it.

**7. Logs & history.** Every approval, rejection, shift and bundling decision,
with private numbers on approvals and the structured reason code on rejections.
The **Rejection Audit** tab in the decision panel is the register view of the
same record.

---

## Four additions for the control office

**1. Private Number & control order generator.** A block is not granted by
clicking a button — the controller dictates a formal authorisation over the
control phone and exchanges a Private Number with the Station Master, and with
the Traction Power Controller when OHE is isolated. Approving issues a
copyable Standard Control Order carrying block section, chainage, granted
window, physical work time, protection and earthing, isolation and isolators,
each machine with its reporting time and crew, freight regulation, the
post-work TSR to impose, and the private numbers themselves. PNs run in
sequence through the shift and appear in the decision log.

**2. Overrun burst-buffer estimator.** A 240-minute block spilling to 270 is
routine. The `On time / +15 / +30` toggle projects the hand-back late and lists
the paths that would then be held, with the delay each takes. Blocks with a
genuine buffer say so; where it bites, it names the train (*BLK-E-012: hand back
30 min late at 21:40 and EMU 86569 is held +18 min*). Only paths not already
inside the booked window count, so it measures the knock-on, not the block.

**3. Crew HOER red line.** Under Hours of Employment Regulations a machine crew
cannot work past its continuous-duty limit; a block that outruns it strands the
machine on the running line. Every machine card carries a badge — *Crew duty
remaining 2h 45m · Safe for this 290 min block* — which turns red when the
possession exceeds what the crew has left, counting hours already worked **and**
hours the machine is already committed to earlier in the plan. The Fleet tab
shows the same red line across the whole fleet.

**4. Post-work TSR projection.** Track work does not end when the block clears:
tamping and deep screening leave a speed restriction until the bed consolidates.
Each proposal states the fallout — *30 km/h over 6.2 km for 24 h ⟹ +9.0 min
runtime per train* — and multiplies it by the morning-peak paths that actually
run that chainage on those lines.

---

## How the scoring and planning work

**Urgency (0–100)** is built from four named components rather than one opaque
number, so the drawer can justify it:

| Component | Max | Driven by |
|---|---|---|
| condition | 40 | TGI, contact wire wear, point throw time |
| overdue | 25 | days past due |
| safety | 20 | USFD flaw class, obstruction test, isolation scope |
| exposure | 15 | how many trains actually run over the defect that day |

A departmental priority floor keeps anything the department already called
CRITICAL from scoring low.

**Block planning** bundles demands that one possession could clear — same
corridor, same running lines, chainages within 6 km — then scans the day in
10-minute steps for a window that is both traffic-free and plant-available.
Preference order: fewest trains blocked, then least unsourced plant, then a
night slot, then earliest.

**A window is work plus overheads**, not just work: 10 min to set protection and
10 to withdraw it, 15 min to earth the OHE and 15 to de-earth where traction is
isolated, and the machine ramp on and off the section. The saving from bundling
is measured against what the same tasks would cost as separate possessions, each
paying those overheads again.

Two details matter for the numbers to mean anything:

- *Off-track assets are mapped to the running line they sit over.* A TDMS
  elementary section `ES-GZB-UP-04` and an S&T route `R-SZM-UP-04` both encode
  the line. Without this, OHE and points blocks are checked against no trains at
  all and their "0 minutes delay" is vacuous. Where TDMS requires adjacent-line
  isolation, the block occupies both roads.
- *Machines are reusable resources, not one-shot tokens.* A tamper is
  unavailable only while committed to an overlapping possession, including its
  transit and ramp time. This is what lets one CSM serve two blocks on the same
  night.

Where a job outruns the crew's remaining HOER hours the machine is still
allocated but flagged **CREW RELIEF**, because that is the controller's call,
not a reason to hide the plant. Where no fit machine of a type is free at all,
the block reports a **plant shortfall** rather than silently claiming a manual
gang.

**Freight regulation is checked against real loop capacity.** A rake is only
"regulated into a loop" if some loop on the corridor has clear standing room for
its length plus signal overlap — a 700 m loop takes a 680 m rake, a 600 m one
does not. Where nothing fits, the block says so instead of pretending the rake
has somewhere to stand.

**A rejection needs a reason code.** A Section Controller cannot refuse an
engineering demand without an operational justification, so the drawer offers
codes generated from this block's actual state — `PRECEDENCE` (naming the
highest-ranked path that would be held, e.g. *Precedence to Rajdhani Express
44741, runs this section at 18:28*), `LOOP_CAPACITY`, `FREIGHT_CONGESTION`,
`RAKE_TURNAROUND`, `CREW_HOER`, `PLANT_UNAVAILABLE`, `WEATHER` (rail temperature
outside the tamping envelope), and `DEFER`. The code and its justification go to
the Rejection Audit register and the decision log.

All 14 generated proposals currently achieve zero induced passenger delay, and
each one is dodging 4–12 real train paths on its lines — the windows are earned,
not empty.

---

## Regenerating

The bundle is a build artefact. After changing the simulator data or the
scoring model:

```bash
npm run data && npm run build
```

`build_data.py` prints a summary — corridor count, train paths, demands,
proposals, how many achieved zero delay, punctuality and TSR count — which is
the quickest check that a change did what you meant.
