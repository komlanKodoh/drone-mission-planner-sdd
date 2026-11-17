import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState, ValidationInputs } from "../src/contracts.ts";
import { validateMission } from "../src/validation/index.ts";
import { MemoryRecords } from "../src/records/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const startsAt = "2026-11-17T12:00:00Z";
const endsAt = "2026-11-17T13:00:00Z";
const versionIds = ["INPUT-1", "POLICY-1", "AIRSPACE-1", "AUTH-1", "2026-11-01T00:00:00Z"];

function configuration(): ConfigurationRecord {
  return {
    id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 10, maxFlightDurationMinutes: 30,
    compatibility: "compatible", supplierReferences: ["supplier:C1"], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100,
    maxSpeedMetersPerSecond: 10, supportedTasks: ["survey"],
  };
}

function revision(): MissionRecordState["revisions"][number] {
  return {
    id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1", startsAt, endsAt,
    waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
  };
}

function validInputs(): ValidationInputs {
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

function context(inputs: ValidationInputs): { app: AppContext; sentCommands: () => number } {
  let sends = 0;
  return {
    app: {
      clock: { now: () => now },
      records: new MemoryRecords({
        configurations: [configuration()],
        missions: [{
          id: "M1", operatorId: "P1", status: "Draft", configurationId: "C1", currentRevisionId: "R1",
          needs: { payloadMassKg: 2, routeDistanceKm: 8, flightDurationMinutes: 20 }, revisions: [revision()],
        }],
        validationInputs: { "M1:R1": inputs },
      }),
      aircraft: { send: async () => { sends += 1; } },
      operatorId: "P1",
    },
    sentCommands: () => sends,
  };
}

describe("mission validation implementation", () => {
  it("marks a fully supported revision Ready and records its input versions", async () => {
    const fixture = context(validInputs());
    const result = await validateMission(fixture.app, { missionId: "M1", revisionId: "R1" });
    const saved = await fixture.app.records.getMission("M1");

    assert.equal(result.status, "Ready", JSON.stringify(result.findings));
    assert.equal(result.externalAuthorization, "approved");
    assert.deepEqual(result.inputVersionIds, versionIds);
    assert.ok((result.findings as Array<{ status: string }>).every(({ status }) => status !== "block"));
    assert.equal(saved?.status, "Ready");
    assert.deepEqual(saved?.validations?.[0].inputVersionIds, versionIds);
    assert.equal(saved?.validations?.[0].operatorId, "P1");
    assert.equal(fixture.sentCommands(), 0);
  });

  it("records multiple independent blockers as Draft without sending aircraft commands", async () => {
    const inputs = validInputs();
    inputs.routeDistanceKm = 8.1;
    inputs.airspace!.sourceDate = "2026-10-01T00:00:00Z";
    inputs.authorization!.status = "denied";
    const fixture = context(inputs);
    const result = await validateMission(fixture.app, { missionId: "M1", revisionId: "R1" });
    const saved = await fixture.app.records.getMission("M1");
    const blocked = (result.findings as Array<{ code: string; status: string }>)
      .filter(({ status }) => status === "block").map(({ code }) => code);

    assert.equal(result.status, "Draft");
    assert.ok(blocked.includes("range_exceeded_after_reserve"));
    assert.ok(blocked.includes("airspace_stale"));
    assert.ok(blocked.includes("authorization_not_approved"));
    assert.equal(saved?.status, "Draft");
    assert.equal(saved?.validations?.length, 1);
    assert.equal(fixture.sentCommands(), 0);
  });
});
