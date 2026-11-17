import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState, TelemetryObservation, ValidationInputs } from "../src/contracts.ts";
import { renderMissionView } from "../src/interface/index.ts";
import { MemoryRecords } from "../src/records/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const versions = ["INPUT-1", "POLICY-1", "AIRSPACE-1", "AUTH-1", "2026-11-01T00:00:00Z"];

function configuration(): ConfigurationRecord {
  return {
    id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 10, maxFlightDurationMinutes: 30,
    compatibility: "compatible", supplierReferences: ["supplier:C1"], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100, maxSpeedMetersPerSecond: 10,
    supportedTasks: ["survey"], supportedSafeActions: ["return"],
  };
}

function inputs(): ValidationInputs {
  return {
    versionId: "INPUT-1", routeDistanceKm: 8,
    policy: { versionId: "POLICY-1", reserveFraction: 0.2, maxAirspaceAgeMs: 7 * 24 * 60 * 60 * 1000 },
    airspace: {
      versionId: "AIRSPACE-1", sourceDate: "2026-11-15T00:00:00Z", validUntil: "2026-11-20T00:00:00Z",
      coversWholeRoute: true, minAltitudeAglMeters: 0, maxAltitudeAglMeters: 120,
      startsAt: "2026-11-16T00:00:00Z", endsAt: "2026-11-18T00:00:00Z", authorizationRequired: true,
    },
    authorization: {
      versionId: "AUTH-1", status: "approved", coversWholeRoute: true,
      minAltitudeAglMeters: 0, maxAltitudeAglMeters: 100,
      validFrom: "2026-11-17T00:00:00Z", validUntil: "2026-11-18T00:00:00Z",
    },
  };
}

function telemetry(): TelemetryObservation {
  return {
    missionId: "M1", aircraftId: "A1", observedAt: "2026-11-16T17:59:59.000Z",
    position: { latitude: 42, longitude: -87 }, batteryPercent: 80, mode: "autonomous", progress: 0.4,
  };
}

function mission(): MissionRecordState {
  return {
    id: "M1", operatorId: "P1", status: "Ready", configurationId: "C1", currentRevisionId: "R1", aircraftId: "A1",
    needs: { payloadMassKg: 2, routeDistanceKm: 8, flightDurationMinutes: 20 },
    revisions: [{
      id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1",
      startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z",
      waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
    }],
    validations: [{
      id: "V1", revisionId: "R1", status: "Ready", findings: [{ code: "authorization_scope_valid", status: "pass", message: "Approval covers the operation." }],
      inputVersionIds: versions, createdAt: now, operatorId: "P1",
    }],
    confirmations: [{ id: "F1", revisionId: "R1", validationId: "V1", inputVersionIds: versions, confirmedAt: now, operatorId: "P1" }],
    commands: [{
      id: "K1", missionId: "M1", aircraftId: "A1", revisionId: "R1", kind: "manual_mode", outcome: "requested",
      createdAt: now, updatedAt: now, payload: { mode: "manual" }, events: [{ outcome: "requested", occurredAt: now }],
    }],
    telemetry: telemetry(), alerts: [],
  };
}

function context(): AppContext {
  return {
    clock: { now: () => now },
    records: new MemoryRecords({
      configurations: [configuration()], missions: [mission()], validationInputs: { "M1:R1": inputs() },
    }),
    aircraft: {
      thresholds: { staleAfterMs: 2_000, lostLinkAfterMs: 5_000, deviationMeters: 100, lowBatteryPercent: 20, commandAckTimeoutMs: 1_000 },
      send: async () => {},
    },
    operatorId: "P1",
  };
}

describe("mission interface rendering", () => {
  it("separates planner readiness, external approval, command request, and observed aircraft mode", async () => {
    const app = context();
    const planner = await renderMissionView(app, { missionId: "M1", view: "planner" });
    assert.equal(planner.plannerStatus, "Ready");
    assert.equal(planner.externalAuthorization, "approved");

    const supervision = await renderMissionView(app, { missionId: "M1", view: "supervision" });
    assert.equal(supervision.telemetryState, "fresh");
    assert.equal(supervision.telemetry?.mode, "autonomous");
    assert.equal(supervision.pendingCommands?.length, 1);
    assert.equal(supervision.pendingCommands?.[0].kind, "manual_mode");
    assert.equal(supervision.pendingCommands?.[0].id, "K1");
    assert.equal(supervision.pendingCommands?.[0].outcome, "requested");
    assert.equal(supervision.observationAgeMs, 1_000);
  });

  it("reports unknown views and missions with domain errors", async () => {
    const app = context();
    await assert.rejects(
      renderMissionView(app, { missionId: "M1", view: "unsupported" }),
      (error: Error & { code?: string }) => error.code === "unknown_view",
    );
    await assert.rejects(
      renderMissionView(app, { missionId: "MISSING", view: "planner" }),
      (error: Error & { code?: string }) => error.code === "unknown_mission",
    );
  });
});
