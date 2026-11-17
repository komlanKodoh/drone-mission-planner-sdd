# Project 2 Implementation Plan

**Status:** all 11 planned slices implemented in the local branch; both the contract and focused implementation suites pass. The acceptance test fixtures were corrected after the user explicitly requested updates; original failure output remains in `baseline-npm-test.txt`.  
**Baseline:** `npm test` run 2026-11-16 in this directory. Exit code 1; 22 tests total, 12 pass, 10 fail, 0 skipped. Full unedited stdout/stderr: [`baseline-npm-test.txt`](./baseline-npm-test.txt). All 12 runnable HTTP skeleton checks pass (11 mapped routes return 501; unknown route returns 404). AT-01–AT-10 fail at their intentional `NotImplementedError` stubs.

This plan implements the Autonomous Drone Mission Planner in ordered vertical slices. The implementation adds typed records access for configurations, missions, and validation inputs; `SQLiteRecords` persists data and `MemoryRecords` supports deterministic fixtures. It uses only configured local fixtures and a synthetic aircraft adapter; missing required policy/evidence blocks readiness and launch. A passing simulator is not evidence of real aircraft operation.

## Slice sequence

The AT-01–AT-10 assertions now run against deterministic `AppContext` fixtures with a fixed clock, `MemoryRecords`, evidence, and a synthetic aircraft adapter. Their returned states and persisted effects are checked. The route-map checks still verify the no-context fallback; implemented behavior is exercised with injected contexts. The local HTTP test is skipped when the sandbox denies localhost binding.

| Slice / status | Goal and exact source sections | Exact test mapping | Source sections and dependencies |
|---|---|---|---|
| **1. Recommend a configuration — implemented; focused tests pass** | AC-001 recommendation behavior; FR-001–FR-002; `spec.md` Domain Model constraints and AC-001; `architecture.md` §§2–3; `contracts.md` Equipment + `POST /api/recommendations`. | Existing `AT-01 selects a qualifying configuration and blocks unknown compatibility` (recommendation assertion only); add a route behavior check replacing the 501 check for `POST /api/recommendations`. | `src/equipment/index.ts::recommendConfigurations`, `src/server.ts` recommendation route, Records fixture/port. Depends on an approved fixture and request/error/result shapes. |
| **2. Save a qualifying selection — implemented; focused tests pass** | AC-001 selection behavior; FR-001–FR-002; same sources as Slice 1, Equipment selection contract + `PUT /api/missions/{missionId}/configuration`. | Add focused selection assertions for eligible, unknown/incompatible and stale candidates (AT-01 is already owned by Slice 1); add configuration-route behavior check replacing 501. | `src/equipment/index.ts::selectConfiguration`, configuration route, Records transaction. Depends on Slice 1 and approved selection/version schema. |
| **3. Save immutable route revisions — implemented; focused tests pass** | AC-002; FR-003; `spec.md` AC-002; `architecture.md` §§2–3; Missions revision contract + `PUT /api/missions/{missionId}/revisions`. | `AT-02 saves a valid ordered route revision`; route behavior check replacing 501. | `src/missions/index.ts::saveRevision`, revision route, Records. Depends on selected configuration and agreed revision persistence. |
| **4. Validate evidence and feasibility — implemented; focused tests pass** | AC-003; FR-004; `spec.md` AC-003; `architecture.md` §§2–3; Validation contract + `POST /api/missions/{missionId}/validations`. | `AT-03 validates the current route and records evidence references`; route behavior check replacing 501. | `src/validation/index.ts::validateMission`, validation route, Records. Depends on Slice 3 and fixtures for config, airspace/coverage, authorization, range/reserve, freshness. |
| **5. Confirm revision-bound preflight — implemented; focused tests pass** | AC-004; FR-005; `spec.md` AC-004; `architecture.md` §3; Missions preflight contract + `POST /api/missions/{missionId}/preflight`. | `AT-04 binds preflight confirmation to the current validation`; route behavior check replacing 501. | `src/missions/index.ts::confirmPreflight`, preflight route, Records. Depends on Slice 4 and version checks. |
| **6. Start once and preserve uncertainty — implemented; focused tests pass** | AC-005; FR-006; `spec.md` AC-005; `architecture.md` §§3–4; Missions start contract + `POST /api/missions/{missionId}/start`. | `AT-05 reserves an aircraft once and waits for execution confirmation`; route behavior check replacing 501. | `src/missions/index.ts::startMission`, start route, Records transaction, Aircraft simulator/events. Depends on Slice 5 and agreed reservation + simulator event contracts. |
| **7. Correlate command outcomes — implemented; focused tests pass** | AC-008; FR-009; `spec.md` AC-008; `architecture.md` §§2–4; Aircraft reconcile contract + `POST /api/commands/{commandId}/reconcile`. | `AT-08 correlates command outcomes without retrying uncertain commands`; route behavior check replacing 501. | `src/aircraft/index.ts::reconcileCommand`, reconcile route, Records and simulator. Depends on Slice 6 command identities/history. |
| **8. Show telemetry and uncertainty — implemented; focused tests pass** | AC-006; FR-007; `spec.md` AC-006; `architecture.md` §§2–3; Aircraft telemetry contract + `GET /api/missions/{missionId}/telemetry`. | `AT-06 returns timestamped telemetry and stale-data alerts`; route behavior check replacing 501. | `src/aircraft/index.ts::getTelemetry`, telemetry route, Records, clock and simulator. Depends on defined observations and configured thresholds. |
| **9. Gate manual mode and direct control — implemented; focused tests pass** | AC-007; FR-008; `spec.md` AC-007; `architecture.md` §§2–3; Aircraft manual-mode contract + `POST /api/missions/{missionId}/manual-mode`. | `AT-07 gates direct control on fresh confirmed manual mode`; route behavior check replacing 501. | `src/aircraft/index.ts::requestManualMode`, manual-mode route, Records, clock and simulator. Depends on Slices 6–8 and mode/observation contract. |
| **10. Track safe actions and landing — implemented; focused tests pass** | AC-009; FR-010; `spec.md` AC-009; `architecture.md` §§2–3; Aircraft safe-action contract + `POST /api/missions/{missionId}/safe-actions`. | `AT-09 records safe actions and completes only after confirmed landing`; route behavior check replacing 501. | `src/aircraft/index.ts::requestSafeAction`, safe-actions route, Records, clock and simulator. Depends on Slices 6–8 and supported action/status fixtures. |
| **11. Reopen decision history and present state — implemented; focused tests pass** | AC-010; FR-011; NFR-005 and NFR-007; `spec.md` AC-010; `architecture.md` §§2–3; Records + Interface contracts and `GET /api/missions/{missionId}/record`. | `AT-10 retrieves an append-only mission decision history`; record-route behavior check replacing 501. Add Interface assertions for distinct Ready/approval/requested/observed labels as an NFR-007 check. | `src/records/index.ts::getMissionRecord`, `src/interface/index.ts::renderMissionView`, record route, durable Records. Depends on Slices 1–10 and persistence/reopen behavior. |

## Test and implementation rules

- Preserve all current tests until an explicit test-contract decision is recorded. Do not keep implemented routes at 501 just to retain passing skeleton checks; replace those checks with actual route behavior once authorized.
- After each slice, run `npm test`, preserve actual output, and ensure the slice’s acceptance behavior and route pass without regressing prior behavior. Record the exact result and update that slice’s status.
- Before each slice, create a branch for that slice. Finish at least Slices 1 and 2 for the assignment minimum if contract questions are resolved. Use the project’s requested commit, push, and pull-request workflow for completed slices.
- Never invent aircraft limits, airspace policy, compatibility, route requirements, response fields, or safety thresholds. Missing required policy/evidence must block launch. Keep all equipment/aircraft activity local and simulated.

## Design questions / blockers to resolve before Slice 1

1. **Test contract:** `tests/contracts.test.ts` requires every mapped route to return 501, which conflicts with the slice requirement that implemented routes work. Approve replacing each route skeleton check with behavior assertions as its slice is implemented.
2. **Acceptance fixtures — resolved:** the tests now seed the mission, configuration, revision, current policy/evidence, clock, and aircraft adapter needed by each behavior. Assertions were retained and strengthened; see `test-fixture-change-notes.md`.
3. **Records port/schema:** `RecordsPort` (`src/contracts.ts`) exposes only `transaction(work)` and cannot read/write configurations, mission state, evidence, versions, history, or reservations. Architecture §4 calls for SQLite and durable/versioned records. Decide the minimum typed operations/schema needed by Slice 1 and the later persistence slices.
4. **Aircraft simulator/events:** `AircraftPort` exposes only `send(command)` and has no observation/status/event subscription. Architecture §§2–4 require simulator observations and event wiring. Define the local simulator interface and event correlation before Slice 6; decide whether Slice 1 needs only configuration fixture operations.
5. **HTTP shapes/errors:** `contracts.md` describes route payloads/results at a high level; exact recommendation/selection request, response, field-error, status-code, and version-reference shapes are open. Approve the minimum shapes required for Slices 1–2 before wiring them.
6. **Policy inputs:** supplier/configuration fixture format and source-date provenance are unspecified. AC-001 needs documented capacity and compatibility; recommend only from supplied records. Later slices also need airspace import/coverage format, expiry-boundary semantics, and explicit configured freshness/reserve limits.

## Coverage check

All acceptance criteria are assigned exactly once: AC-001 to Slices 1–2 as the same feature (recommendation assertion belongs to Slice 1; new selection assertion to Slice 2); AC-002 to Slice 3; AC-003 to Slice 4; AC-004 to Slice 5; AC-005 to Slice 6; AC-006 to Slice 8; AC-007 to Slice 9; AC-008 to Slice 7; AC-009 to Slice 10; AC-010 to Slice 11. Each existing failing test AT-01–AT-10 appears exactly once in the test mapping. Every public module function and mapped route, including `Interface.renderMissionView`, has a slice.

## Implementation result

- Slice 1–2 focused tests: `tests/implementation.test.ts`; 4 pass. Its HTTP integration case skips because the sandbox rejects local listener binding with `EPERM`.
- Slice 3: `tests/revisions.test.ts`; 4 pass.
- Slice 4: `tests/validation.test.ts`; 2 pass.
- Slice 5: `tests/preflight.test.ts`; 3 pass.
- Slice 6: `tests/start.test.ts`; 6 pass.
- Slices 7–10: `tests/aircraft.test.ts`; 4 pass.
- Slice 11: `tests/interface.test.ts`; 2 pass.
- Durable storage: `tests/records.test.ts`; 2 pass.
- `npm run test:implementation` passes all 8 test files. SQLite emits Node's experimental-feature warning.
- `npm test` passes 22/22 after the AT test fixture correction. The earlier 12/22 baseline remains in `baseline-npm-test.txt`; the latest exact output is in `original-suite-output.txt`.
- Runnable synthetic browser demo: `npm start`, then open `http://127.0.0.1:3000`. The sandbox does not permit opening a local listener; run it outside this sandbox to record the required video.
- Canvas submission draft is in `canvas-submission-draft.md`; paste actual test output and add the YuJa link before submitting. A timed recording storyboard is in `recording-storyboard.md`.

**Next action:** run `npm start` outside the restricted sandbox, record the synthetic API workflow in YuJa, and add its share link to the Canvas submission.
