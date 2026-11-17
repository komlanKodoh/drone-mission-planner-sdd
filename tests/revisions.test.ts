import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState } from "../src/contracts.ts";
import { saveRevision } from "../src/missions/index.ts";
import { MemoryRecords } from "../src/records/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const validWaypoints = [
  { order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" },
  { order: 2, latitude: 42.01, longitude: -87.01, altitudeAglMeters: 40, speedMetersPerSecond: 6, task: "survey" },
];
const period = { startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z" };

function configuration(): ConfigurationRecord {
  return {
    id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 12, maxFlightDurationMinutes: 25,
    compatibility: "compatible", supplierReferences: ["supplier:C1"], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100, maxSpeedMetersPerSecond: 10,
    supportedTasks: ["survey", "inspect"],
  };
}

function context(status = "Draft", revisions: MissionRecordState["revisions"] = []): AppContext {
  return {
    clock: { now: () => now },
    records: new MemoryRecords({
      configurations: [configuration()],
      missions: [{ id: "M1", operatorId: "P1", status, configurationId: "C1", revisions }],
    }),
    aircraft: { send: async () => { throw new Error("Revision editing must not send aircraft commands."); } },
    operatorId: "P1",
  };
}

describe("mission revision implementation", () => {
  it("saves an ordered revision with configured waypoint limits and operation period", async () => {
    const app = context();
    const result = await saveRevision(app, { missionId: "M1", ...period, waypoints: validWaypoints });
    const saved = await app.records.getMission("M1");

    assert.equal(result.status, "Draft");
    assert.equal(saved?.status, "Draft");
    assert.equal(saved?.revisions.length, 1);
    assert.equal(saved?.currentRevisionId, saved?.revisions[0].id);
    assert.equal(saved?.revisions[0].configurationId, "C1");
    assert.equal(saved?.revisions[0].operatorId, "P1");
    assert.equal(saved?.revisions[0].createdAt, now);
    assert.equal(saved?.revisions[0].startsAt, period.startsAt);
    assert.equal(saved?.revisions[0].endsAt, period.endsAt);
    assert.deepEqual(saved?.revisions[0].waypoints, validWaypoints);
  });

  it("rejects an invalid waypoint with a field reason and preserves the prior revision", async () => {
    const app = context();
    await saveRevision(app, { missionId: "M1", ...period, waypoints: validWaypoints });
    const before = await app.records.getMission("M1");

    await assert.rejects(
      saveRevision(app, {
        missionId: "M1", ...period,
        waypoints: [{ ...validWaypoints[0], latitude: 91 }],
      }),
      (error: Error & { field?: string }) => error.field?.endsWith(".latitude") === true,
    );

    assert.deepEqual(await app.records.getMission("M1"), before);
  });

  for (const status of ["Uploading", "Active"]) {
    it(`blocks route edits while the mission is ${status}`, async () => {
      const app = context(status, [{
        id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1",
        startsAt: period.startsAt, endsAt: period.endsAt, waypoints: validWaypoints,
      }]);
      const before = await app.records.getMission("M1");

      await assert.rejects(
        saveRevision(app, { missionId: "M1", ...period, waypoints: validWaypoints }),
        (error: Error & { code?: string }) => error.code === "mission_locked",
      );

      assert.deepEqual(await app.records.getMission("M1"), before);
    });
  }
});
