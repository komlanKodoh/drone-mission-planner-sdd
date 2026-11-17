# Project 2 YuJa recording storyboard

Target length: about 2½ minutes. Record the app served by `npm start` so the page shows **Connected to demo API**. The browser-only preview is labeled **Browser preview · synthetic API** and should not be presented as a live server run. All aircraft values and responses are synthetic.

## 0:00–0:20 — Introduce the demo

**Show:** Mission Control heading, synthetic demo badge, route and mission summary.

**Say:** “This is my Project 2 drone mission planner. I implemented the workflow from configuration selection through mission monitoring. This demo uses synthetic data only and does not control real aircraft.”

## 0:20–0:50 — Select a configuration and save a route

**Click:** Recommend, Select, then Save route.

**Say:** “The planner compares mission needs against documented aircraft limits. It only recommends a compatible configuration with enough payload, range, and endurance. I select that configuration, then save an immutable route revision.”

## 0:50–1:25 — Validate and confirm preflight

**Click:** Validate, then Confirm.

**Say:** “Validation checks the saved revision against aircraft limits, airspace coverage, authorization, freshness, and reserve policy. The result records the evidence versions. Preflight confirmation is tied to this exact revision and validation.”

## 1:25–2:05 — Request upload and reconcile execution

**Click:** Request, Acknowledge, then Confirm start.

**Say:** “Starting first records an upload request and reserves the aircraft. Upload acceptance is reconciled separately; only then does the adapter send the start command. The mission becomes Active after execution is confirmed, so a requested command is not mistaken for an observed state.”

## 2:05–2:30 — Show telemetry and history

**Click:** Read telemetry, then Read mission record.

**Say:** “Telemetry is timestamped and checked for freshness. The mission record keeps the revision, validations, confirmations, and command outcomes so the decision history can be reviewed.”

## 2:30–2:45 — Close

**Show:** Activity response and 7/7 workflow status.

**Say:** “The implementation is covered by the focused behavior suite and the contract suite. All aircraft, airspace, and authorization details in this demonstration are fixtures; no real flight testing was performed.”

## Before recording

Run `npm start` in the project directory and open `http://127.0.0.1:3000`. Check that the header says **Connected to demo API**. If it says **Browser preview · synthetic API**, the Node server is not serving the page. Record in YuJa and add the resulting share link to the Canvas textbox.
