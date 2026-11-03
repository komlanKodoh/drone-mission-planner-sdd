# Architecture

## 1. Overview

The planner is a local TypeScript application: one Node.js process serves a simple browser interface, handles mission decisions, and talks to an aircraft adapter. One SQLite database stores mission records; there are no separate services, cloud deployment, queues, or caches. The initial adapter is a simulator so the specified behavior can be checked without flying an aircraft.

References below use the named sections and IDs in `spec.md`.

## 2. Modules

These are folders in one application, not independently deployed components. A module may use only the dependencies listed below; dependencies on the language runtime are omitted.

| Module | Responsibility | May depend on |
| --- | --- | --- |
| Interface | Present equipment selection, mission editing, validation, supervision, and record review; pass operator actions to the application. | Equipment, Missions, Validation, Aircraft, Records |
| Equipment | Determine which documented configurations satisfy the operator's needs and compatibility rules. | Records |
| Missions | Enforce plan revisions, preflight, lifecycle transitions, and exclusive aircraft use. | Equipment, Validation, Aircraft, Records |
| Validation | Evaluate a saved revision against its limits, policies, and versioned evidence, returning all blocking findings. | Records |
| Aircraft | Translate supported requests and incoming aircraft messages into correlated command outcomes and timestamped observations. | Records |
| Records | Persist and retrieve the mission data and history in SQLite with atomic transactions. | None |

Equipment is needed by FR-001–FR-002; Missions by FR-003, FR-005–FR-006 and FR-010; Validation by FR-004–FR-005; Aircraft by FR-006–FR-010; Records by FR-011 and NFR-002–NFR-005. Interface provides the operator-visible behavior in FR-001–FR-011. The Aircraft module exposes events that Missions receives through the application's startup wiring; it does not call back into Missions or decide lifecycle transitions itself.

## 3. Request flow

The main scenario is preparing and starting a mission, then supervising it until landing.

1. The operator enters mission needs. Equipment checks finite positive quantities and units, compares locally imported supplier/configuration records, excludes incompatible candidates, and marks missing compatibility evidence as blocked. Interface shows source dates and reasons; Missions saves only a qualifying selection (FR-001–FR-002, AC-001).
2. The operator saves a route. Missions checks waypoint ordering, coordinates, tasks, speed, supported limits, and offset-bearing operation times before Records commits a new immutable revision. Invalid edits report field-specific reasons and retain the previous revision. Uploading and Active revisions cannot be edited (FR-003, AC-002).
3. The operator imports airspace records and records external authorization evidence. Records keeps versions rather than replacing evidence used by an earlier validation. Validation evaluates the whole route and operation period against range/reserve, coverage, freshness, limits, and any required authorization. It returns all blocking findings, including missing policies; missing information never counts as a pass (FR-004, AC-003).
4. Missions applies a validation result only if the current revision and input versions still match. It marks a passing mission Ready; otherwise it returns Draft. The operator's preflight confirmation records the exact revision and validation. An edit, evidence update, policy change, or expiry invalidates readiness and preflight; freshness is checked on every launch action as well as during the displayed readiness updates (FR-005, AC-004).
5. When Start is selected, Missions rechecks the approved inputs. In one Records transaction, it checks the current state, claims the aircraft using a unique aircraft reservation, changes the mission to Uploading, and records the upload request. A competing or duplicate request fails before any aircraft message is sent (FR-006, AC-005).
6. After that commit, Aircraft sends the recorded upload once. On matched upload acknowledgement, Missions rechecks evidence and preflight again before recording and sending a separate start request. If evidence expired or changed, it sends no start request and requires revalidation and renewed preflight. Any unresolved upload is still reconciled before another launch is allowed.
7. A matched acceptance updates the command history but does not establish execution. Only fresh aircraft status identifying the intended mission revision makes Missions set Active. A confirmed rejection returns Ready only if validation remains current, otherwise Draft; the reservation is released when non-execution is established. A timeout retains Uploading, the reservation, and an unconfirmed warning. Dismissing the warning changes none of those gates. Fresh status must establish execution or non-execution; the latter releases the reservation and requires renewed preflight (AC-005).
8. Aircraft filters observations by aircraft and mission context, retains observation timestamps, and rejects older observations from the current display. Interface shows position, battery, reported mode, progress, and age. A local timer detects configured stale/lost-link intervals and route/battery deviations, saves alerts, and marks uncertainty without inventing a landing (FR-007, AC-006).
9. Manual-mode and supported safe-action requests pass through Missions to Aircraft. Direct control is allowed only while the mission is Active and fresh matching telemetry reports manual mode; this gate is checked on the server for every request. Requested, accepted, rejected, and unknown outcomes remain separate from observed mode. Unknown flight commands are never automatically retried (FR-008–FR-010, AC-007–AC-009).
10. Fresh matching landing status makes Missions atomically mark Completed, release the reservation, and record the event, regardless of which screen is open. Interface then permits returning to the editor; loss of telemetry cannot complete the mission. Records can reopen all saved revisions and decision history (AC-009–AC-010).

## 4. Design decisions

| Decision | Reason |
| --- | --- |
| Use TypeScript for the browser and local Node.js application, with ordinary HTML forms and a basic supervision page. | Preference: the project owner prefers TypeScript or Rust; one language keeps this student implementation manageable. A graphical map is not required for the coordinate-based waypoint editor in FR-003. |
| Run one application on the ground-station computer and bind it to loopback. | Preference: the Description requires one operator per mission and does not require remote access. Cloud hosting and account registration would add work without satisfying another acceptance criterion. |
| Use SQLite and simple tables for missions, revisions, configurations, evidence versions, validations, confirmations, reservations, commands, and history. | NFR-002–NFR-003 require atomic reservations and durable records. A unique aircraft reservation and a database transaction enforce exclusivity even when requests arrive together. Earlier versions and history are retained for FR-011. |
| Record commands before sending and record outcomes separately. Never automatically replay a pending command on restart. | FR-009 and NFR-003 require conservative handling of uncertain outcomes. SQLite and the aircraft cannot share a transaction: a crash between recording, sending, and receiving a response can leave delivery unknown. Such records keep the aircraft reserved pending reconciliation. |
| Use one local clock source with an injectable test clock. Persist UTC instants; use elapsed time for live timers. | Domain Model time rules, FR-005, FR-007, and NFR-006 require consistent expiry and repeatable tests. Restart or an untrusted clock cannot make cached readiness or old telemetry fresh; fresh validation/status is required. |
| Import supplier and airspace records as local files and enter external authorization evidence through a form. | FR-001 and FR-004 need records, source dates, coverage, and evidence, but no live provider API. Input checks reject incomplete formats; validation blocks missing coverage or freshness rules. |
| Put aircraft protocol details behind a small adapter and implement the simulator first. | The Acceptance Criteria and NFR-006 explicitly allow synthetic data. The adapter must expose upload, start, mode, direct-control and supported safe-action requests, acknowledgements, and observations. Real flight-control logic and autopilot failsafes remain on the aircraft, as required by the Description. |
| Correlate responses by command, aircraft, mission, and revision where applicable. | FR-006 and FR-009 require correct identity. The adapter maps protocol identifiers to local command IDs. Duplicate acknowledgements update the same record without sending another action; late outcomes preserve the earlier timeout in history (AC-008). |
| Use ordinary HTTP actions and one server event stream for supervision, including a one-second heartbeat. | Preference: this is enough for the required status updates without another service. NFR-004 sets the visible uncertainty target. A lost stream marks the browser disconnected and disables flight controls; server-side gates remain authoritative. |
| Record the local operator ID on confirmations and actions; do not add a login system for the local MVP. | FR-011 requires operator context; it does not require identity verification. This is a trusted single-user-machine assumption, not proof of pilot eligibility or tamper-resistant identity. |

## 5. Constraints and known limits

The fixed implementation choice is TypeScript. The proposed deployment is one trusted local computer with Node.js, a browser, and SQLite; no paid service or external server is needed. The user supplies aircraft limits, supported tasks/actions, data freshness and reserve policies, and timing/deviation thresholds. Validation blocks operation when required values are absent. Numerical test settings in the specification remain test fixtures, not real flight limits.

Database commits complete before a successful save is displayed. Revision, lifecycle, reservation, and history changes share a transaction. A database failure rejects the action and prevents new sends; an already sent command stays uncertain until it can be reconciled. On restart, the app restores unresolved reservations and history, invalidates preflight for a new start, and requests fresh aircraft status without resending flight commands. SQLite protects normal transactional recovery; disk destruction and deliberate edits by a local administrator are outside this MVP.

The server evaluates timers while an operator is using another screen; the browser shows stale/disconnected state when its stream is lost. Stale telemetry disables direct control, but it does not cause a flight command or a completion transition. The autopilot remains responsible for flight control and configured failsafes. A stopped computer cannot continue supervision, and this design makes no real-time or certification claim.

Real hardware integration requires an adapter that can establish revision execution, non-execution, landing, and response identity reliably. Protocol behavior must be checked before enabling that adapter. Until then, the deliverable is an architecture for a simulator-backed planner, not a claim that the app can fly an aircraft.

If remote users or multiple computers are added, local operator identity, loopback access, database ownership, and aircraft reservation scope must be redesigned together. Adding another data supplier requires its format and coverage/freshness rules; adding another aircraft requires its capabilities and adapter mapping. None is implemented speculatively.

### Acceptance-criterion ownership and review

| Criterion | Module enforcing it | Supporting modules / review result |
| --- | --- | --- |
| AC-001 | Equipment | Missions saves approved selection; Interface presents dates and blocked reasons. |
| AC-002 | Missions | Records preserves the last valid revision; Interface labels invalid fields. |
| AC-003 | Validation | Missions applies Ready/Draft; Interface lists every finding and labels external decisions separately. |
| AC-004 | Missions | Validation supplies input references; stale results cannot approve a newer revision. |
| AC-005 | Missions | Records enforces exclusive reservation; Aircraft correlates upload/start/status and timeout events. |
| AC-006 | Aircraft | Timer checks observation age/deviation; Interface shows stale observations and alerts; Records retains alerts. |
| AC-007 | Missions | Aircraft supplies fresh reported mode; both Interface and server gate direct control. |
| AC-008 | Aircraft | Records retains correlated outcomes, late responses, and timeouts without duplicate actions. |
| AC-009 | Missions | Aircraft supplies supported actions and fresh landing status; Interface keeps supervision available. |
| AC-010 | Records | Missions and Aircraft supply timestamps, identities, input references, and append-only history. |

Reviewing the design against AC-001–AC-010 left no criterion without an owner and no module without a requirement. NFR-001 is enforced by Validation/Missions; NFR-002–NFR-003 and NFR-005 by Records and the recorded-command flow; NFR-004 and NFR-007 by Interface/Aircraft/Missions; NFR-006 by the simulator and controllable clock. These are design coverage findings, not passing implementation tests.

## 6. Out of scope

From the specification's Description: purchasing, aircraft manufacture, payload targeting, multi-pilot delegation, automatic legal authorization, and a direct authorization-service API are outside the MVP. Pilot eligibility, weather suitability, and physical aircraft condition are not established by the planner. Low-level flight control and aircraft failsafes belong to the autopilot.

## Spec issues

- The specification does not identify an aircraft protocol or explain how it proves execution of a particular revision, non-execution, or landing. The simulator can represent these states explicitly; a hardware adapter must resolve this before real operation.
- Supplier/airspace input formats, coverage interpretation, freshness rules, reserve policy, and actual aircraft thresholds are not supplied. They remain required configuration and adapter inputs; this architecture does not invent operational values.
- Operator identity is required for history but authentication and multi-computer coordination are unspecified. This design assumes one trusted local installation; broader deployment requires revisiting those requirements.

Generated with the help of GPT-6 (Codex).
