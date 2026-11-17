# Canvas submission draft

**Repository:** https://github.com/komlanKodoh/drone-mission-planner-sdd

**Implemented:** All 11 planned slices cover configuration recommendation and selection, route revisions, validation, preflight, start/reconciliation, telemetry, manual mode, safe actions, landing, and mission history. `npm start` runs the synthetic browser demo; the fake aircraft adapter does not connect to hardware.

```sh
node --experimental-strip-types scripts/demo-slices-1-3.ts
```

**Verification:** `npm test` — 22 passed, 0 failed. `npm run test:implementation` — 8 test files passed, 0 failed. Paste the actual run output from `original-suite-output.txt` and `implementation-test-output.txt` into the Canvas textbox. The reason the acceptance fixture needed correction is documented in `test-fixture-change-notes.md`.

**Demo video (1–5 minutes):** [add the recording link before submission]. The local environment blocks opening a server listener, so record the demo on the local machine with `npm start`.

**Changes from Project 1:** Project 2 turns the SRS and architecture into a TypeScript planner with versioned local records, configuration recommendation, route validation, preflight, upload/start reconciliation, telemetry supervision, manual-mode and safe-action tracking, and a synthetic browser demo. It uses synthetic aircraft data only; it makes no claims about real flight capability.

**AI use:** GPT-6 Luna agents and GPT-6 Codex assisted with implementation, test design, and review. The code uses fixture-driven behavior and explicit configured limits; no hardware flight tests were performed.

Generated with the help of GPT-6 (Codex).
