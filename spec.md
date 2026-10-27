# Description

The Autonomous Drone Mission Planner helps a drone operator select a compatible aircraft configuration, prepare a mission, and supervise its execution from a ground station. This specification converts the Project 1 SRS into a text specification for AI-assisted development. The MVP supports civilian, supervised small-UAS missions with one operator and one aircraft per active mission. It uses supplier records, map and airspace data, externally obtained authorization evidence, and an aircraft link. The operator approves the flight; the aircraft autopilot performs flight control and its configured failsafes. Purchasing, aircraft manufacture, payload targeting, multi-pilot delegation, automatic legal authorization, and a direct authorization-service API are outside the MVP.

# Goals

1. **G-001 — Select suitable equipment.** Help the operator compare aircraft configurations and identify supported component combinations. (Project 1: G1/G11.)
2. **G-002 — Prepare a feasible, authorized route.** Check a saved plan against aircraft limits and relevant airspace and authorization evidence before pilot approval. (Project 1: G2/G21.)
3. **G-003 — Supervise flight and retain pilot control.** Show current observations, alert the operator to uncertainty, and distinguish requested actions from confirmed aircraft behavior. (Project 1: G3/G31/G4.)
4. **G-004 — Keep mission decisions reviewable.** Preserve the plan, evidence, operator confirmations, alerts, and command outcomes used during a mission. (Project 1: G0.)

# Domain Model

## Actors

- **Drone operator / remote pilot in command (PIC):** selects equipment, edits plans, records external evidence, confirms preflight, and supervises flight. The planner cannot establish pilot eligibility, weather suitability, or physical aircraft condition by itself.
- **Component supplier:** provides component, compatibility, availability, and source-date records through existing catalogs. No supplier-facing editor is included.
- **Airspace authority:** issues external authorization decisions. The planner records those decisions; it cannot issue them.
- **Aircraft autopilot:** accepts or rejects supported mission/control requests and reports aircraft state through the aircraft link. A sent request is not confirmation of execution.

## Objects

| Object | Meaning and essential data |
| --- | --- |
| DroneOperator | Responsible person; operator ID attached to confirmations and actions. |
| Aircraft | Physical aircraft with an ID and selected AircraftConfiguration. |
| AircraftConfiguration | Component combination, supported limits, source date, range estimate, and reserve policy. Unknown limits do not count as passed checks. |
| Component / Supplier | Hardware record, supplier reference, compatibility evidence, and source date. Missing compatibility evidence is distinct from confirmed incompatibility. |
| MissionPlan | Mission ID, responsible operator, aircraft, operation period, current saved revision, and lifecycle status. Each revision identifies its configuration and ordered waypoints. |
| Waypoint | Unique order within a revision; latitude, longitude, altitude AGL, speed, and a supported flight task. Units must be explicit. |
| AirspaceVolume | Geographic and altitude extent with time applicability and data-source freshness/coverage metadata. |
| AuthorizationDecision | External issuer, reference, status, geographic/altitude scope, and validity period. An approval must cover the planned operation where authorization is required. |
| ValidationResult | Saved revision and input references, pass/block findings, and evidence applicability. Ready describes a planner result, not permission to fly. |
| PreflightConfirmation | Operator, timestamp, and the exact revision and validation result confirmed. |
| TelemetrySample | Aircraft ID, observation timestamp, position, battery, reported mode, and mission progress. Observation age is distinct from display time. |
| Alert | Mission, type, timestamp, and reason: for example deviation, stale telemetry, or uncertain command outcome. |
| ControlCommand | Unique local ID, mission, aircraft, requested action, timestamp, and outcome: requested, accepted, rejected, or unknown. Acceptance does not prove execution. |
| MissionRecord | Saved revisions, evidence references, confirmations, alerts, and command/outcome history. |

**Constraints and interpretation**

- A mission has exactly one responsible operator and one aircraft. An aircraft cannot have two active missions in the planner. All commands and observations must match the intended aircraft and mission context.
- A revision needs at least one waypoint with unique ordering, valid coordinates, positive speed, and values within the selected aircraft's supported limits. Invalid input is rejected with a field-specific reason; the last valid saved revision is retained.
- Validation must establish coverage for the whole route and operation period. Missing or stale coverage, unknown required limits, or unsuitable required authorization evidence blocks Ready. External data freshness rules and the reserve policy must be configured explicitly; absence of a policy blocks validation.
- Plan status is Draft → Validating → Ready → Uploading → Active → Completed. Failed validation returns Draft. A prelaunch edit invalidates Ready and preflight confirmation. Ready may expire when evidence expires. Active requires aircraft confirmation; Completed requires landing confirmation. An uncertain start is shown as unconfirmed and blocks another start until aircraft state is reconciled.
- Route editing is disabled during Uploading and Active. Manual control changes the aircraft mode, not the saved plan revision. Missing telemetry does not mean the aircraft landed.
- Telemetry stale interval, lost-link interval, command acknowledgement timeout, and deviation thresholds must be configured for the supported aircraft before operation. The stale interval is shorter than the lost-link interval. These are explicit MVP configuration requirements, not measured performance claims. Tests use a controllable clock and synthetic aircraft data.

# Functional Requirements

| ID | User story | Goals | Project 1 source |
| --- | --- | --- | --- |
| **FR-001** | As an operator, I want to enter mission needs with units, compare configuration and supplier records with source dates, and select a configuration, so that I can choose suitable equipment. | G-001 | US01 |
| **FR-002** | As an operator, I want confirmed incompatible combinations excluded and missing compatibility evidence identified and blocked from selection, so that unknown compatibility is not treated as approval. | G-001 | FR02; clarified selection policy |
| **FR-003** | As an operator, I want to enter and save ordered waypoints, supported tasks, altitude, speed, and an operation period, so that I can prepare a mission using the selected aircraft. | G-002 | US02 |
| **FR-004** | As an operator, I want to record externally issued decisions and validate a saved route against range with reserve, airspace coverage, and required authorization scope/time, so that I can see every blocking reason before launch. | G-002 | FR04 |
| **FR-005** | As an operator, I want validation and preflight tied to the saved revision and invalidated by edits or expired evidence, so that I cannot start using obsolete findings. | G-002 | FR07 |
| **FR-006** | As an operator, I want Start to recheck current validation and preflight, upload the plan, and show Active only after aircraft start confirmation, so that a pending or failed request is not mistaken for flight. Duplicate starts and conflicting aircraft assignments must be blocked. | G-002, G-003 | FR08 |
| **FR-007** | As an operator, I want timestamped position, battery, reported mode, and mission progress with deviation, stale-data, and lost-link alerts, so that I can supervise flight with visible uncertainty. | G-003 | US03, FR09 |
| **FR-008** | As an operator, I want to request manual mode and send supported direct controls only after fresh aircraft confirmation of manual mode, so that I can retain pilot control without mistaking my request for a completed handoff. | G-003 | US04, FR10 |
| **FR-009** | As an operator, I want each command tied to the correct aircraft and mission with a visible requested/accepted/rejected/unknown outcome, so that I can judge whether further action is needed. Uncertain flight commands must not be retried automatically. | G-003 | FR10 |
| **FR-010** | As an operator, I want supported safe-action requests and a return to the editor only after landing confirmation, so that supervision remains visible until the flight has ended. | G-003 | S3 mini-spec/navigation |
| **FR-011** | As an operator, I want saved revisions, evidence references, confirmations, alerts, and command outcomes retained with timestamps and operator identity, so that mission decisions can be reviewed. | G-004 | FR11 |

# Acceptance Criteria

Each labeled Gherkin script tests the referenced requirements. Example aircraft A1, mission M1, and operator P1 are synthetic fixtures. Numerical values below are test settings, not new aircraft or regulatory limits. No live aircraft is required for acceptance testing.

## AC-001 — Configuration selection (FR-001, FR-002)

```gherkin
Feature: Select a supported aircraft configuration
  Scenario: Compare and select a compatible candidate
    Given P1 has entered valid mission needs with units
    And supplier records include a supported compatible candidate C1
    When P1 requests recommendations
    Then C1 is displayed with its supplier references and source dates
    When P1 selects C1
    Then C1 is saved as the mission configuration
    And the mission editor becomes available

  Scenario Outline: Do not approve unsuitable compatibility
    Given candidate C2 has <evidence>
    When P1 requests recommendations
    Then the planner applies <handling>
    And C2 cannot be selected for the mission
    Examples:
      | evidence                  | handling                              |
      | confirmed incompatibility | exclude C2 from recommendations       |
      | missing compatibility     | identify C2 as needing review         |

  Scenario: Needs are incomplete
    When P1 requests recommendations without a required mission need
    Then the missing field is identified
    And no new configuration selection is saved
```

## AC-002 — Save and validate route input (FR-003)

```gherkin
Feature: Save an ordered mission revision
  Scenario: Save a valid route
    Given M1 has selected aircraft A1 and configuration C1
    When P1 saves valid ordered waypoints, tasks, altitude, speed, and operation period
    Then a new saved revision contains exactly those values and C1's reference
    And its status is Draft

  Scenario Outline: Reject invalid plan input
    Given M1 has a valid saved revision R1
    When P1 attempts to save <input>
    Then the invalid field and reason are displayed
    And R1 remains the last valid saved revision
    Examples:
      | input                              |
      | no waypoints                       |
      | duplicate waypoint order indices   |
      | latitude outside -90 to 90 degrees  |
      | longitude outside -180 to 180 degrees |
      | nonpositive speed                  |
      | altitude above the configured limit |
      | an unsupported flight task         |
      | end time before start time         |

  Scenario Outline: Protect the executing revision
    Given M1 has status <status>
    When P1 attempts to edit its route
    Then the edit is blocked and the saved revision is unchanged
    Examples:
      | status    |
      | Uploading |
      | Active    |
```

## AC-003 — Validate evidence and feasibility (FR-004)

```gherkin
Feature: Validate a saved mission
  Scenario: All checks pass
    Given M1's saved revision R1 is within C1's range after its configured reserve
    And current airspace data covers its whole route and operation period
    And external approval evidence covers every part requiring authorization
    When P1 validates R1
    Then the planner records passing findings against R1 and its input references
    And M1 is Ready
    And the external authority decision is labeled separately from planner validation

  Scenario Outline: A blocking condition prevents readiness
    Given R1 has <condition>
    When P1 validates R1
    Then M1 is Draft and Start is disabled
    And the specific blocking reason is shown
    And no aircraft start command is sent
    Examples:
      | condition                            |
      | missing required authorization       |
      | denied authorization                 |
      | expired authorization                |
      | authorization outside route scope    |
      | authorization outside altitude scope |
      | authorization outside operation time |
      | stale airspace data                  |
      | incomplete route data coverage       |
      | range exceeded after reserve         |
      | unknown aircraft limit               |
      | missing reserve policy               |

  Scenario: Several checks fail
    Given R1 exceeds range and lacks required authorization
    When P1 validates R1
    Then both blocking findings are displayed
```

## AC-004 — Invalidate obsolete approval (FR-005)

```gherkin
Feature: Bind readiness to current inputs
  Scenario Outline: A prelaunch change invalidates readiness
    Given R1 is Ready and P1 has confirmed its preflight checklist
    When <change> occurs before upload
    Then the old findings and confirmation cannot authorize Start
    And M1 requires current validation and renewed preflight confirmation
    Examples:
      | change                              |
      | a waypoint is changed               |
      | a different configuration is selected |
      | the operation period is changed     |
      | required evidence expires           |

  Scenario: A stale validation result arrives
    Given validation began for R1
    And P1 has since saved R2
    When the result for R1 arrives
    Then it cannot mark R2 Ready
```

## AC-005 — Start once with aircraft confirmation (FR-006)

```gherkin
Feature: Start the current approved mission
  Scenario: Start succeeds
    Given R1 is Ready with current evidence and P1's preflight confirmation
    And A1 has no active or unresolved mission in the planner
    When P1 selects Start
    Then the planner rechecks R1 and its evidence and enters Uploading
    And sends R1 to A1
    When A1 acknowledges upload and confirms execution of R1
    Then M1 is Active and the live dashboard opens

  Scenario Outline: Start prerequisites are not met
    Given <condition>
    When P1 requests Start
    Then the request is blocked with a reason
    And no upload or start command is sent
    Examples:
      | condition                          |
      | preflight is unconfirmed           |
      | validation belongs to an old revision |
      | required evidence has expired      |
      | A1 has another active mission      |
      | A1 has an unresolved earlier start |

  Scenario: Duplicate Start during upload
    Given R1 is Uploading
    When P1 selects Start again
    Then no second upload or start command is sent

  Scenario Outline: Start is not confirmed
    Given R1 has been sent to A1
    When <response> occurs
    Then the editor shows Start not confirmed and the reason
    And the planner does not report Active or automatically open the dashboard
    And an uncertain outcome blocks another start until reconciled
    Examples:
      | response                         |
      | A1 rejects upload                |
      | A1 rejects start                 |
      | acknowledgement timeout expires |
      | upload is accepted but execution confirmation times out |
```

## AC-006 — Supervise current and stale observations (FR-007)

```gherkin
Feature: Show trustworthy flight observations
  Background:
    Given M1 is Active on A1
    And the test stale interval is 2 seconds and lost-link interval is 5 seconds

  Scenario: Receive fresh telemetry
    When a current A1 sample arrives
    Then the dashboard shows its timestamp, position, battery, reported mode, and progress
    And its mode is not replaced by an unconfirmed requested mode

  Scenario: Data stops arriving
    Given A1's last sample was observed at time T
    When more than 2 seconds pass without a newer observation
    Then the retained sample is marked stale with its timestamp
    When more than 5 seconds pass without a newer observation
    Then a lost-link alert is shown
    And M1 is not marked Completed

  Scenario: An observation is late or unrelated
    Given the dashboard has displayed A1's sample at time T
    When an older sample or a sample for another aircraft arrives
    Then it does not replace A1's current displayed observation

  Scenario: An observed deviation exceeds the configured threshold
    When fresh telemetry exceeds a configured route or battery alert threshold
    Then the dashboard identifies the deviation and affected mission
```

## AC-007 — Confirm manual handoff (FR-008)

```gherkin
Feature: Request and confirm manual control
  Scenario: Aircraft confirms manual mode
    Given M1 is Active and A1 reports autonomous mode
    When P1 requests manual mode
    Then a manual-mode command is recorded as requested
    And direct-control input remains disabled
    When fresh A1 telemetry confirms manual mode
    Then direct-control input is enabled
    And a supported direct-control request targets M1 and A1

  Scenario Outline: Manual control is not confirmed
    Given P1 requested manual mode
    When <response> occurs
    Then direct-control input remains disabled
    And the rejected or unknown outcome is visible
    Examples:
      | response                                     |
      | A1 rejects the mode request                   |
      | acknowledgement timeout expires              |
      | A1 accepts the command but still reports autonomous mode |

  Scenario: Confirmed mode becomes stale
    Given direct-control input was enabled after manual-mode confirmation
    When telemetry becomes stale or fresh telemetry reports another mode
    Then direct-control input is disabled until fresh manual-mode confirmation
```

## AC-008 — Correlate commands and avoid uncertain retries (FR-009)

```gherkin
Feature: Track control request outcomes
  Scenario Outline: Display the command outcome
    Given command K1 targets M1 and A1
    When <event> occurs
    Then K1 shows <outcome> with its timestamp
    Examples:
      | event                            | outcome   |
      | K1 is sent                       | requested |
      | A1 acknowledges acceptance of K1 | accepted  |
      | A1 rejects K1                    | rejected  |
      | K1's acknowledgement times out  | unknown   |

  Scenario: An uncertain flight command times out
    Given a sent flight command has an unknown outcome
    When its acknowledgement timeout expires
    Then it is not resent automatically
    And its uncertainty remains visible for operator reconciliation

  Scenario: An acknowledgement cannot be matched
    Given K1 targets A1
    When an acknowledgement for another aircraft or an unrelated command arrives
    Then K1's outcome is unchanged
    And the unmatched message does not establish a mode change
```

## AC-009 — Request a safe action and end supervision (FR-010)

```gherkin
Feature: Keep supervision until confirmed landing
  Scenario: Request an aircraft-supported safe action
    Given M1 is Active and A1 supports the selected safe action
    When P1 requests that action
    Then a tracked command is sent to A1
    And M1 is not marked Completed merely because the request was sent or accepted

  Scenario: Landing is confirmed
    Given fresh A1 status confirms landing
    When P1 chooses to return to the editor
    Then M1 is Completed and the editor opens

  Scenario: Landing is not confirmed
    Given M1 is Active and landing has not been confirmed
    When telemetry is lost or P1 requests a return to the editor
    Then the live supervision view remains available
    And missing telemetry does not cause completion

  Scenario: Safe action is unsupported
    When P1 requests an action A1 does not support
    Then the request is rejected with a reason and no command is sent
```

## AC-010 — Preserve the decision history (FR-011)

```gherkin
Feature: Review a mission record
  Scenario: Retain the mission history
    Given P1 saves R1, validates it, confirms preflight, and requests a command
    And a telemetry alert and command outcome are recorded
    When M1's saved mission record is reopened
    Then it contains R1 and its evidence references
    And the confirmation, alert, command, and outcome have timestamps and operator context
    And a later revision or outcome does not overwrite the earlier history
```

## Coverage

| Requirements | Acceptance scripts |
| --- | --- |
| FR-001, FR-002 | AC-001 |
| FR-003 | AC-002 |
| FR-004 | AC-003 |
| FR-005 | AC-004 |
| FR-006 | AC-005 |
| FR-007 | AC-006 |
| FR-008 | AC-007 |
| FR-009 | AC-008 |
| FR-010 | AC-009 |
| FR-011 | AC-010 |

Generated with the help of GPT-6 (Codex).
