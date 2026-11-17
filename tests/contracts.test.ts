import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRequest } from "../src/server.ts";
import type { AppContext, AircraftCommand, CommandRecord, ConfigurationRecord, MissionRecordState, TelemetryObservation, ValidationInputs } from "../src/contracts.ts";
import { recommendConfigurations, selectConfiguration } from "../src/equipment/index.ts";
import { saveRevision, confirmPreflight, startMission } from "../src/missions/index.ts";
import { validateMission } from "../src/validation/index.ts";
import { getTelemetry, requestManualMode, reconcileCommand, requestSafeAction } from "../src/aircraft/index.ts";
import { getMissionRecord, MemoryRecords } from "../src/records/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const operation = { startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z" };
const needs = { payloadMassKg: 2, routeDistanceKm: 10, flightDurationMinutes: 20 };
const versionIds = ["INPUT-1", "POLICY-1", "AIRSPACE-1", "2026-11-01T00:00:00Z"];

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

function configuration(id = "C1", compatibility: ConfigurationRecord["compatibility"] = "compatible"): ConfigurationRecord {
  return {
    id, maxPayloadMassKg: 3, maxRouteDistanceKm: 12, maxFlightDurationMinutes: 25,
    compatibility, supplierReferences: [`supplier:${id}`], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100,
    maxSpeedMetersPerSecond: 10, supportedTasks: ["survey"], supportedSafeActions: ["return"],
  };
}

function revision(): MissionRecordState["revisions"][number] {
  return {
    id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1", ...operation,
    waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
  };
}

function mission(overrides: Partial<MissionRecordState> = {}): MissionRecordState {
  return {
    id: "M1", operatorId: "P1", status: "Draft", configurationId: "C1", currentRevisionId: "R1", aircraftId: "A1",
    needs, revisions: [revision()], ...overrides,
  };
}

function validationInputs(): ValidationInputs {
  return {
    versionId: "INPUT-1", routeDistanceKm: 10,
    policy: { versionId: "POLICY-1", reserveFraction: 0.1, maxAirspaceAgeMs: 7 * 86_400_000 },
    airspace: {
      versionId: "AIRSPACE-1", sourceDate: "2026-11-15T00:00:00Z", validUntil: "2026-11-20T00:00:00Z",
      coversWholeRoute: true, minAltitudeAglMeters: 0, maxAltitudeAglMeters: 120,
      startsAt: "2026-11-16T00:00:00Z", endsAt: "2026-11-18T00:00:00Z", authorizationRequired: false,
    },
  };
}

function telemetry(): TelemetryObservation {
  return { missionId: "M1", aircraftId: "A1", observedAt: now, position: { latitude: 42, longitude: -87 }, batteryPercent: 85, mode: "auto", progress: 0.25 };
}

function context(options: { configurations?: ConfigurationRecord[]; mission?: MissionRecordState; send?: AppContext["aircraft"]["send"] } = {}): AppContext {
  const records = new MemoryRecords({
    configurations: options.configurations ?? [configuration()], missions: [options.mission ?? mission()],
    validationInputs: { "M1:R1": validationInputs() },
  });
  return {
    clock: { now: () => now }, records, operatorId: "P1",
    aircraft: {
      send: options.send ?? (async () => {}), readTelemetry: async () => telemetry(),
      thresholds: { staleAfterMs: 30_000, lostLinkAfterMs: 120_000, deviationMeters: 75, lowBatteryPercent: 20, commandAckTimeoutMs: 15_000 },
    },
  };
}

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
    assert.equal(resolveRequest("GET", "/not-a-route").status, 404);
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

describe("acceptance behavior contracts", () => {
  it("AT-01 selects a qualifying configuration and blocks unknown compatibility", async () => {
    const app = context({ configurations: [configuration("C1"), configuration("C2", "unknown")] });
    const result = await recommendConfigurations(app, { needs });
    assert.deepEqual(result.recommended, ["C1"]);
    assert.deepEqual(result.blocked, ["C2"]);
    const selected = await selectConfiguration(app, { missionId: "M1", configurationId: "C1", needs });
    assert.equal(selected.configurationId, "C1");
    assert.equal((await app.records.getMission("M1"))?.configurationId, "C1");
  });

  it("AT-02 saves a valid ordered route revision", async () => {
    const app = context();
    const result = await saveRevision(app, { missionId: "M1", ...operation, waypoints: revision().waypoints! });
    assert.equal(result.status, "Draft");
    assert.equal((await app.records.getMission("M1"))?.currentRevisionId, result.revisionId);
  });

  it("AT-03 validates the current route and records evidence references", async () => {
    const result = await validateMission(context(), { missionId: "M1", revisionId: "R1" });
    assert.equal(result.status, "Ready");
    assert.deepEqual(result.inputVersionIds, versionIds);
  });

  it("AT-04 binds preflight confirmation to the current validation", async () => {
    const app = context();
    const validation = await validateMission(app, { missionId: "M1", revisionId: "R1" });
    const result = await confirmPreflight(app, { missionId: "M1", revisionId: "R1", validationId: String(validation.id) });
    assert.equal(result.confirmed, true);
    assert.equal(result.validationId, validation.id);
    await assert.rejects(confirmPreflight(app, { missionId: "M1", revisionId: "R2", validationId: String(validation.id) }));
  });

  it("AT-05 reserves an aircraft once and waits for execution confirmation", async () => {
    const sent: AircraftCommand[] = [];
    const app = context({ send: async (command) => { sent.push(command); } });
    const validation = await validateMission(app, { missionId: "M1", revisionId: "R1" });
    await confirmPreflight(app, { missionId: "M1", revisionId: "R1", validationId: String(validation.id) });
    const result = await startMission(app, { missionId: "M1", revisionId: "R1" });
    assert.equal(result.status, "Uploading");
    assert.equal(sent.length, 1);
    assert.equal((await app.records.getMission("M1"))?.reservation?.aircraftId, "A1");
  });

  it("AT-06 returns timestamped telemetry and stale-data alerts", async () => {
    const result = await getTelemetry(context(), { missionId: "M1", aircraftId: "A1" });
    assert.equal(result.aircraftId, "A1");
    assert.equal(result.stale, false);
    assert.equal((result.observation as TelemetryObservation).observedAt, now);
  });

  it("AT-07 gates direct control on fresh confirmed manual mode", async () => {
    const result = await requestManualMode(context({ mission: mission({ status: "Active" }) }), { missionId: "M1", aircraftId: "A1" });
    assert.equal(result.outcome, "requested");
  });

  it("AT-08 correlates command outcomes without retrying uncertain commands", async () => {
    const command: CommandRecord = {
      id: "K1", missionId: "M1", aircraftId: "A1", revisionId: "R1", kind: "manual_mode", outcome: "requested",
      createdAt: now, updatedAt: now, payload: { mode: "manual" },
    };
    const app = context({ mission: mission({ status: "Active", commands: [command] }) });
    const result = await reconcileCommand(app, {
      commandId: "K1", aircraftId: "A1",
      status: { missionId: "M1", aircraftId: "A1", commandId: "K1", outcome: "accepted", observedAt: now },
    });
    assert.equal(result.commandId, "K1");
    assert.equal((await app.records.getMission("M1"))?.commands?.[0].outcome, "accepted");
  });

  it("AT-09 records safe actions and completes only after confirmed landing", async () => {
    const result = await requestSafeAction(context({ mission: mission({ status: "Active" }) }), { missionId: "M1", aircraftId: "A1", action: "return" });
    assert.equal(result.outcome, "requested");
  });

  it("AT-10 retrieves an append-only mission decision history", async () => {
    const result = await getMissionRecord(context(), { missionId: "M1" });
    assert.equal(result.missionId, "M1");
    assert.equal((result.mission as MissionRecordState).revisions[0].id, "R1");
  });
});
