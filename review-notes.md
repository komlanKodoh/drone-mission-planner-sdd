# Specification review

Baseline: Project 1 SRS, including US01–US04, FR02/04/07–11, BDD01, and S1–S3 screen rules. Review performed with GPT-6 (Codex), October 27, 2026. These are specification checks, not results from running a flight system.

## Gaps grouped by operation

- **Selection:** How should missing compatibility evidence behave? It remains visible for review but cannot be selected. This tightens Project 1's warning-only language.
- **Planning:** What makes a saved route valid, and can the active route change? Input constraints now require valid coordinates, unique ordering, supported tasks and limits, and a valid operation period. Editing is blocked during upload and active flight.
- **Validation:** What happens when data freshness or range/reserve inputs are unknown? Required limits, reserve and freshness rules must be configured; missing inputs block Ready. Exact deployment values remain aircraft/provider choices and are not invented as universal thresholds.
- **Start:** What if a user sends Start twice or a validation result arrives late? Repeated starts are blocked, old results cannot validate a new revision, and an uncertain start requires reconciliation before another start.
- **Supervision:** Can delayed telemetry overwrite newer data? No. Observations must match the aircraft, retain their timestamps, and display freshness separately from lifecycle status.
- **Manual control:** Does an accepted mode request enable controls? No. Fresh aircraft-reported manual mode is required. Stale observations disable direct-control input.
- **Command handling:** Does timeout mean failure, and can the planner retry? Timeout means unknown. No automatic uncertain flight-command retry is permitted.
- **Records:** Can later edits erase the earlier decision trail? No. The saved history preserves earlier revisions and outcomes.

## Fifteen problematic requests

The middle column records the risky guess an implementer might otherwise make; the last column gives the adopted rule.

| # | Request | Possible guess | Final rule / criterion |
| --- | --- | --- | --- |
| 1 | Select a configuration with no compatibility evidence | Treat no known conflict as compatible | Block selection; AC-001 |
| 2 | Recommend equipment without a required mission need | Use an unstated default | Show the missing field; AC-001 |
| 3 | Save an empty route | Save a ready-to-fly mission | Reject invalid input; AC-002 |
| 4 | Repeat waypoint order indices | Choose arbitrary order | Reject duplicates; AC-002 |
| 5 | Save an impossible latitude | Clamp or wrap the coordinate | Reject it; AC-002 |
| 6 | Save zero speed or an unsupported task | Substitute a default | Reject it; AC-002 |
| 7 | Edit the route during upload | Race the aircraft upload | Block editing; AC-002 |
| 8 | Validate without a reserve policy | Assume zero reserve | Block Ready; AC-003 |
| 9 | Use authorization for another altitude or time | Accept any approval reference | Require matching scope; AC-003 |
| 10 | Use incomplete or stale airspace coverage | Treat uncovered space as clear | Block Ready; AC-003 |
| 11 | Apply R1's late result after saving R2 | Mark R2 Ready | Keep R2 unapproved; AC-004 |
| 12 | Start twice or start a second mission on A1 | Send both requests | Block duplicate/conflicting start; AC-005 |
| 13 | Retry after a timed-out start | Assume the aircraft did nothing | Require reconciliation; AC-005/008 |
| 14 | Replace telemetry with an old or wrong-aircraft sample | Show the last received message | Preserve the current observation; AC-006 |
| 15 | Send direct controls after an accepted but unconfirmed mode change | Assume acceptance means manual control | Require fresh reported manual mode; AC-007 |

## Business relevance and acceptance coverage

Every functional requirement has a goal reference and an acceptance-script reference in spec.md. G-001 is covered by FR-001/002; G-002 by FR-003–006; G-003 by FR-006–010; G-004 by FR-011. There are no requirements without a goal or acceptance script, and no goals without requirements.

AC-001–010 cover the stated requirements and shared domain constraints. The original four planning/start scenarios are retained in AC-003–005 with expanded failure cases. Added cases cover the remaining original stories and supporting requirements.

Before hardware deployment, the supported autopilot, command correlation mechanism, provider freshness rules, aircraft limits, reserve policy, and timing/deviation settings must be selected and tested. This assignment specifies their required behavior without claiming hardware validation or complete legal compliance.

Generated with the help of GPT-6 (Codex).
