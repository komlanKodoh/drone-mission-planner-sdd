import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ConfigurationRecord, MissionRecordState } from "../src/contracts.ts";
import { SQLiteRecords } from "../src/records/sqlite.ts";

const configuration: ConfigurationRecord = {
  id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 12, maxFlightDurationMinutes: 25,
  maxAltitudeAglMeters: 90, maxSpeedMetersPerSecond: 12, supportedTasks: ["survey"],
  compatibility: "compatible", supplierReferences: ["supplier:C1"],
  sourceDate: "2026-11-01T00:00:00Z", sourceValidUntil: "2026-12-01T00:00:00Z",
};

describe("SQLite RecordsPort", () => {
  it("reopens saved mission revisions and configuration data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "drone-records-"));
    const databasePath = join(directory, "records.sqlite");
    try {
      const first = new SQLiteRecords({ databasePath, configurations: [configuration] });
      const mission: MissionRecordState = {
        id: "M1", operatorId: "P1", status: "Draft", configurationId: "C1", revisions: [
          { id: "R1", configurationId: "C1", createdAt: "2026-11-16T12:00:00Z", operatorId: "P1", startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z", waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }] },
        ],
      };
      await first.transaction(() => first.saveMission(mission));
      first.close();
      const reopened = new SQLiteRecords({ databasePath, configurations: [configuration] });
      assert.deepEqual((await reopened.getMission("M1"))?.revisions[0].waypoints?.[0].task, "survey");
      assert.deepEqual((await reopened.getConfiguration("C1"))?.supportedTasks, ["survey"]);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back mission writes when a transaction fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "drone-records-"));
    const databasePath = join(directory, "records.sqlite");
    try {
      const records = new SQLiteRecords({ databasePath, configurations: [configuration] });
      const mission: MissionRecordState = { id: "M1", operatorId: "P1", status: "Draft", revisions: [] };
      await assert.rejects(records.transaction(async () => {
        await records.saveMission(mission);
        throw new Error("interrupt");
      }));
      assert.equal(await records.getMission("M1"), undefined);
      records.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
