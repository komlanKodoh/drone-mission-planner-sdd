import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState, ValidationInputs } from "../src/contracts.ts";
import { confirmPreflight } from "../src/missions/index.ts";
import { MemoryRecords, type MemoryRecordsSeed } from "../src/records/index.ts";
import { validateMission } from "../src/validation/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const period = { startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z" };
const versions = ["INPUT-1", "POLICY-1", "AIRSPACE-1", "AUTH-1", "2026-11-01T00:00:00Z"];

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
    id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1", ...period,
    waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
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

class MutableValidationRecords extends MemoryRecords {
  private currentInputs: ValidationInputs;

  constructor(seed: MemoryRecordsSeed) {
    super(seed);
    this.currentInputs = structuredClone(seed.validationInputs!["M1:R1"]);
  }

  updateInputs(value: ValidationInputs): void { this.currentInputs = structuredClone(value); }

  override async getValidationInputs(missionId: string, revisionId: string): Promise<ValidationInputs | undefined> {
    if (missionId === "M1" && revisionId === "R1") return structuredClone(this.currentInputs);
    return super.getValidationInputs(missionId, revisionId);
  }
}

function context(): { app: AppContext; records: MutableValidationRecords } {
  const validationInputs = inputs();
  const seed: MemoryRecordsSeed = {
    configurations: [configuration()],
    missions: [{
      id: "M1", operatorId: "P1", status: "Draft", configurationId: "C1", currentRevisionId: "R1",
      needs: { payloadMassKg: 2, routeDistanceKm: 8, flightDurationMinutes: 20 }, revisions: [revision()],
    }],
    validationInputs: { "M1:R1": validationInputs },
  };
  const records = new MutableValidationRecords(seed);
  return { records, app: { clock: { now: () => now }, records, operatorId: "P1", aircraft: { send: async () => {} } } };
}

describe("preflight confirmation implementation", () => {
  it("confirms the current ready validation with its exact revision and input versions", async () => {
    const { app } = context();
    const validation = await validateMission(app, { missionId: "M1", revisionId: "R1" });
    assert.equal(validation.status, "Ready");
    const result = await confirmPreflight(app, { missionId: "M1", revisionId: "R1", validationId: String(validation.id) });
    const saved = await app.records.getMission("M1");

    assert.equal(result.confirmed, true);
    assert.equal(result.revisionId, "R1");
    assert.equal(result.validationId, validation.id);
    assert.deepEqual(result.inputVersionIds, versions);
    assert.equal(result.confirmedAt, now);
    assert.equal(result.operatorId, "P1");
    assert.deepEqual(saved?.confirmations?.[0].inputVersionIds, versions);
    assert.equal(saved?.confirmations?.length, 1);
  });

  it("rejects confirmation after validation inputs change and preserves state", async () => {
    const { app, records } = context();
    const validation = await validateMission(app, { missionId: "M1", revisionId: "R1" });
    const changed = inputs();
    changed.policy!.versionId = "POLICY-2";
    records.updateInputs(changed);
    const before = await app.records.getMission("M1");

    await assert.rejects(
      confirmPreflight(app, { missionId: "M1", revisionId: "R1", validationId: String(validation.id) }),
      (error: Error & { code?: string }) => error.code === "stale_validation",
    );

    assert.deepEqual(await app.records.getMission("M1"), before);
  });

  it("rejects confirmation for a revision that is no longer current and preserves state", async () => {
    const { app } = context();
    const validation = await validateMission(app, { missionId: "M1", revisionId: "R1" });
    const mission = await app.records.getMission("M1");
    mission!.currentRevisionId = "R2";
    await app.records.saveMission(mission!);
    const before = await app.records.getMission("M1");

    await assert.rejects(
      confirmPreflight(app, { missionId: "M1", revisionId: "R1", validationId: String(validation.id) }),
      (error: Error & { code?: string }) => error.code === "stale_revision",
    );

    assert.deepEqual(await app.records.getMission("M1"), before);
  });
});
