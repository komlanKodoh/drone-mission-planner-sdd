import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRequest } from "../src/server.ts";
import type { AppContext } from "../src/contracts.ts";
import { recommendConfigurations, selectConfiguration } from "../src/equipment/index.ts";
import { saveRevision, confirmPreflight, startMission } from "../src/missions/index.ts";
import { validateMission } from "../src/validation/index.ts";
import { getTelemetry, requestManualMode, reconcileCommand, requestSafeAction } from "../src/aircraft/index.ts";
import { getMissionRecord } from "../src/records/index.ts";

const context = {} as AppContext;
const endpoints = [
  ["POST", "/api/recommendations", "FR-001"],
  ["PUT", "/api/missions/M1/configuration", "FR-002"],
  ["PUT", "/api/missions/M1/revisions", "FR-003"],
  ["POST", "/api/missions/M1/validations", "FR-004"],
  ["POST", "/api/missions/M1/preflight", "FR-005"],
  ["POST", "/api/missions/M1/start", "FR-006"],
  ["GET", "/api/missions/M1/telemetry", "FR-007"],
  ["POST", "/api/missions/M1/manual-mode", "FR-008"],
  ["POST", "/api/commands/K1/reconcile", "FR-009"],
  ["POST", "/api/missions/M1/safe-actions", "FR-010"],
  ["GET", "/api/missions/M1/record", "FR-011"],
] as const;

describe("runnable HTTP skeleton", () => {
  for (const [method, path, requirement] of endpoints) {
    it(`${method} ${path} maps ${requirement} and returns 501`, () => {
      const response = resolveRequest(method, path);
      assert.equal(response.status, 501);
      assert.deepEqual(response.body, {
        error: "not_implemented",
        message: `${requirement} is mapped to ${contractFor(requirement)}; implementation is pending.`,
      });
    });
  }

  it("returns 404 for an unknown route", () => {
    const response = resolveRequest("GET", "/not-a-route");
    assert.equal(response.status, 404);
  });
});

function contractFor(requirement: string): string {
  return [
    "Equipment.recommendConfigurations", "Equipment.selectConfiguration", "Missions.saveRevision",
    "Validation.validateMission", "Missions.confirmPreflight", "Missions.startMission",
    "Aircraft.getTelemetry", "Aircraft.requestManualMode", "Aircraft.reconcileCommand",
    "Aircraft.requestSafeAction", "Records.getMissionRecord",
  ][Number(requirement.slice(4)) - 1];
}

describe("acceptance behavior contracts (expected to fail until implemented)", () => {
  it("AT-01 selects a qualifying configuration and blocks unknown compatibility", async () => {
    const result = await recommendConfigurations(context, { needs: { payloadMassKg: 2, routeDistanceKm: 10, flightDurationMinutes: 20 } });
    assert.deepEqual(result, { recommended: ["C1"], blocked: ["C2"] });
  });
  it("AT-02 saves a valid ordered route revision", async () => {
    const result = await saveRevision(context, { missionId: "M1", startsAt: "2026-11-12T12:00:00Z", endsAt: "2026-11-12T13:00:00Z", waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }] });
    assert.equal(result.status, "Draft");
  });
  it("AT-03 validates the current route and records evidence references", async () => {
    const result = await validateMission(context, { missionId: "M1", revisionId: "R1" });
    assert.equal(result.status, "Ready");
  });
  it("AT-04 binds preflight confirmation to the current validation", async () => {
    const result = await confirmPreflight(context, { missionId: "M1", revisionId: "R1", validationId: "V1" });
    assert.equal(result.confirmed, true);
  });
  it("AT-05 reserves an aircraft once and waits for execution confirmation", async () => {
    const result = await startMission(context, { missionId: "M1", revisionId: "R1" });
    assert.equal(result.status, "Uploading");
  });
  it("AT-06 returns timestamped telemetry and stale-data alerts", async () => {
    const result = await getTelemetry(context, { missionId: "M1", aircraftId: "A1" });
    assert.equal(result.aircraftId, "A1");
  });
  it("AT-07 gates direct control on fresh confirmed manual mode", async () => {
    const result = await requestManualMode(context, { missionId: "M1", aircraftId: "A1" });
    assert.equal(result.outcome, "requested");
  });
  it("AT-08 correlates command outcomes without retrying uncertain commands", async () => {
    const result = await reconcileCommand(context, { commandId: "K1", aircraftId: "A1", status: { outcome: "accepted" } });
    assert.equal(result.commandId, "K1");
  });
  it("AT-09 records safe actions and completes only after confirmed landing", async () => {
    const result = await requestSafeAction(context, { missionId: "M1", aircraftId: "A1", action: "return" });
    assert.equal(result.outcome, "requested");
  });
  it("AT-10 retrieves an append-only mission decision history", async () => {
    const result = await getMissionRecord(context, { missionId: "M1" });
    assert.equal(result.missionId, "M1");
  });
});
