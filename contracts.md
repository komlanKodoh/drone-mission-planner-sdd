# Project 2 API and Module Contracts

All operations receive `AppContext`, which injects the operator ID, UTC clock, transactional records store, and synthetic aircraft adapter. Contract failures reject with a field-specific or requirement-specific domain error; the initial implementation instead raises `NotImplementedError`. No contract performs aircraft operation in this skeleton.

## Public module functions

| Module and exact signature | Success result | Failure conditions | Spec rule | Injected dependencies |
| --- | --- | --- | --- | --- |
| `Interface.renderMissionView(context: AppContext, request: InterfaceRequest): Promise<InterfaceState>` | Current view model for the named mission and view. | Unknown mission/view; operator action not allowed in current state. | FR-001–FR-011; NFR-004, NFR-007 | clock, records, aircraft, operator ID |
| `Equipment.recommendConfigurations(context: AppContext, request: RecommendationRequest): Promise<Record<string, unknown>>` | Candidate configurations with supplier/source dates, eligibility, and blocking reasons. | Missing/invalid need or unavailable records; no candidate is still a successful empty result. | FR-001, FR-002; AC-001 | clock, records, operator ID |
| `Equipment.selectConfiguration(context: AppContext, request: ConfigurationSelection): Promise<Record<string, unknown>>` | Saved mission/configuration IDs and new revision reference. | Missing candidate, insufficient limits, incompatible or undocumented compatibility, stale source record. | FR-001, FR-002; AC-001 | clock, records, operator ID |
| `Missions.saveRevision(context: AppContext, request: SaveRevisionRequest): Promise<Record<string, unknown>>` | New immutable revision ID, exact saved values, and `Draft` status. | Invalid waypoint/period/limit, unsupported task, or mission currently Uploading/Active. Rejection leaves the last valid revision unchanged. | FR-003; AC-002 | clock, records, operator ID |
| `Validation.validateMission(context: AppContext, request: ValidationRequest): Promise<Record<string, unknown>>` | Validation ID, revision/input references, and every pass/block finding. | Unknown revision or missing required policy/configuration. Blocking findings return Draft; no aircraft command is sent. | FR-004; AC-003 | clock, records, operator ID |
| `Missions.confirmPreflight(context: AppContext, request: PreflightRequest): Promise<Record<string, unknown>>` | Confirmation ID tied to operator, timestamp, revision, and validation. | Validation/input versions stale, blocked, or mismatched. | FR-005; AC-004 | clock, records, operator ID |
| `Missions.startMission(context: AppContext, request: StartRequest): Promise<Record<string, unknown>>` | Upload command ID and `Uploading`; later aircraft evidence determines Active. | Stale validation/evidence, missing confirmation, conflicting reservation, or unresolved start. Competing requests cannot both reserve one aircraft. | FR-006; AC-005 | clock, records transaction, aircraft adapter, operator ID |
| `Aircraft.getTelemetry(context: AppContext, request: TelemetryRequest): Promise<Record<string, unknown>>` | Matching current observations with observation timestamps, ages, and alerts. | Wrong mission/aircraft context or unavailable observation. | FR-007; AC-006 | clock, records, aircraft adapter, operator ID |
| `Aircraft.requestManualMode(context: AppContext, request: ManualModeRequest): Promise<Record<string, unknown>>` | Correlated command ID and requested outcome; direct-control gate remains closed until fresh manual-mode telemetry. | Mission not Active, wrong aircraft, stale telemetry, or unsupported mode. | FR-008; AC-007 | clock, records, aircraft adapter, operator ID |
| `Aircraft.reconcileCommand(context: AppContext, request: ReconcileRequest): Promise<Record<string, unknown>>` | Updated matching command outcome and appended event history. | Unmatched/stale aircraft status or command identity mismatch; does not change the target command. | FR-009; AC-008 | clock, records, aircraft adapter, operator ID |
| `Aircraft.requestSafeAction(context: AppContext, request: SafeActionRequest): Promise<Record<string, unknown>>` | Correlated action command in requested state. | Unsupported action or wrong mission/aircraft; rejection sends no command. Completion requires confirmed landing. | FR-010; AC-009 | clock, records, aircraft adapter, operator ID |
| `Records.getMissionRecord(context: AppContext, request: MissionRecordRequest): Promise<Record<string, unknown>>` | Mission revisions and append-only evidence, confirmations, alerts, commands, and outcomes. | Unknown mission or persistence read failure. | FR-011; AC-010 | clock, records, operator ID |

## REST API contracts

Every route is served by the local Node.js process. Each route invokes the public contract listed below; until implemented, the server returns HTTP `501` with JSON `{ "error": "not_implemented", "message": "..." }`. Unknown paths return 404. Successful response fields follow the module result above; rejected requests must not create a revision, reservation, command, or record beyond any explicit rejection audit event required by the spec.

| Method and path | Requirement | Public function | Request / expected success |
| --- | --- | --- | --- |
| `POST /api/recommendations` | FR-001 | `Equipment.recommendConfigurations` | Mission needs with units / eligible candidates and reasons. |
| `PUT /api/missions/{missionId}/configuration` | FR-002 | `Equipment.selectConfiguration` | Configuration ID / saved configuration reference. |
| `PUT /api/missions/{missionId}/revisions` | FR-003 | `Missions.saveRevision` | Ordered waypoints and operation period / immutable Draft revision. |
| `POST /api/missions/{missionId}/validations` | FR-004 | `Validation.validateMission` | Revision ID / findings and current planner status. |
| `POST /api/missions/{missionId}/preflight` | FR-005 | `Missions.confirmPreflight` | Revision and validation IDs / revision-bound confirmation. |
| `POST /api/missions/{missionId}/start` | FR-006 | `Missions.startMission` | Current revision ID / Uploading and correlated upload command. |
| `GET /api/missions/{missionId}/telemetry` | FR-007 | `Aircraft.getTelemetry` | Aircraft ID query / timestamped observations and alerts. |
| `POST /api/missions/{missionId}/manual-mode` | FR-008 | `Aircraft.requestManualMode` | Aircraft ID / tracked mode request. |
| `POST /api/commands/{commandId}/reconcile` | FR-009 | `Aircraft.reconcileCommand` | Fresh aircraft status / correlated outcome. |
| `POST /api/missions/{missionId}/safe-actions` | FR-010 | `Aircraft.requestSafeAction` | Aircraft ID and supported action / tracked action request. |
| `GET /api/missions/{missionId}/record` | FR-011 | `Records.getMissionRecord` | None / complete reviewable record. |

## Run commands

- Start the local skeleton: `npm start` (serves `127.0.0.1:3000`; set `PORT` to change it).
- Run the contract and acceptance tests: `npm test`.
- Node.js 22.6 or newer is required; the project uses Node's built-in TypeScript stripping and test runner, so no install step is needed.
