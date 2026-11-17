import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AircraftCommand, AppContext, ConfigurationRecord, MissionRecordState, ValidationInputs } from "../src/contracts.ts";
import { confirmPreflight, startMission } from "../src/missions/index.ts";
import { reconcileCommand } from "../src/aircraft/index.ts";
import { MemoryRecords, type MemoryRecordsSeed } from "../src/records/index.ts";
import { validateMission } from "../src/validation/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const period = { startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z" };

function configuration(): ConfigurationRecord {
  return {
    id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 10, maxFlightDurationMinutes: 30,
    compatibility: "compatible", supplierReferences: ["supplier:C1"], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100,
    maxSpeedMetersPerSecond: 10, supportedTasks: ["survey"],
  };
}

function mission(id: string): MissionRecordState {
  return {
    id, operatorId: "P1", status: "Draft", configurationId: "C1", currentRevisionId: "R1", aircraftId: "A1",
    needs: { payloadMassKg: 2, routeDistanceKm: 8, flightDurationMinutes: 20 },
    revisions: [{
      id: "R1", configurationId: "C1", createdAt: now, operatorId: "P1", ...period,
      waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
    }],
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

class MutableStartRecords extends MemoryRecords {
  private currentInputs: Record<string, ValidationInputs>;

  constructor(seed: MemoryRecordsSeed) {
    super(seed);
    this.currentInputs = structuredClone(seed.validationInputs ?? {});
  }

  updateInputs(missionId: string, revisionId: string, value: ValidationInputs): void {
    this.currentInputs[`${missionId}:${revisionId}`] = structuredClone(value);
  }

  override async getValidationInputs(missionId: string, revisionId: string): Promise<ValidationInputs | undefined> {
    const current = this.currentInputs[`${missionId}:${revisionId}`];
    return current && structuredClone(current);
  }
}

function context(ids = ["M1"], send: AppContext["aircraft"]["send"] = async () => {}): { app: AppContext; records: MutableStartRecords } {
  const validationInputs = Object.fromEntries(ids.map((id) => [`${id}:R1`, inputs()]));
  const records = new MutableStartRecords({
    configurations: [configuration()], missions: ids.map(mission), validationInputs,
  });
  return {
    records,
    app: {
      clock: { now: () => now }, records, operatorId: "P1",
      aircraft: { send, thresholds: { staleAfterMs: 30_000, lostLinkAfterMs: 120_000, deviationMeters: 75, lowBatteryPercent: 20, commandAckTimeoutMs: 15_000 } },
    },
  };
}

async function prepare(contextValue: AppContext, id: string, confirm = true): Promise<void> {
  const validation = await validateMission(contextValue, { missionId: id, revisionId: "R1" });
  assert.equal(validation.status, "Ready");
  if (confirm) await confirmPreflight(contextValue, { missionId: id, revisionId: "R1", validationId: String(validation.id) });
}

describe("mission start acceptance", () => {
  it("uploads the current preflighted revision once and records Uploading", async () => {
    const commands: AircraftCommand[] = [];
    const { app, records } = context(["M1"], async (command) => { commands.push(command); });
    await prepare(app, "M1");

    const result = await startMission(app, { missionId: "M1", revisionId: "R1" });
    await assert.rejects(startMission(app, { missionId: "M1", revisionId: "R1" }));
    const saved = await records.getMission("M1");

    assert.equal(result.status, "Uploading");
    assert.equal(commands.length, 1);
    assert.equal(commands[0].missionId, "M1");
    assert.equal(commands[0].aircraftId, "A1");
    assert.equal(commands[0].kind, "upload");
    assert.equal(saved?.status, "Uploading");
    assert.equal(saved?.reservation?.aircraftId, "A1");
    assert.equal(saved?.commands?.length, 1);
    assert.equal(saved?.commands?.[0].kind, "upload");
  });

  it("blocks missing or stale preflight without sending an aircraft command", async (t) => {
    await t.test("missing confirmation", async () => {
      const commands: AircraftCommand[] = [];
      const { app } = context(["M1"], async (command) => { commands.push(command); });
      await prepare(app, "M1", false);

      await assert.rejects(startMission(app, { missionId: "M1", revisionId: "R1" }));
      assert.equal(commands.length, 0);
    });

    await t.test("inputs changed after confirmation", async () => {
      const commands: AircraftCommand[] = [];
      const { app, records } = context(["M1"], async (command) => { commands.push(command); });
      await prepare(app, "M1");
      const changed = inputs();
      changed.policy!.versionId = "POLICY-2";
      records.updateInputs("M1", "R1", changed);

      await assert.rejects(startMission(app, { missionId: "M1", revisionId: "R1" }));
      assert.equal(commands.length, 0);
      const saved = await records.getMission("M1");
      assert.notEqual(saved?.status, "Uploading");
      assert.equal(saved?.reservation, undefined);
    });
  });

  it("allows only one concurrent mission to reserve A1 and upload", async () => {
    const commands: AircraftCommand[] = [];
    const { app, records } = context(["M1", "M2"], async (command) => { commands.push(command); });
    await Promise.all([prepare(app, "M1"), prepare(app, "M2")]);

    const results = await Promise.allSettled([
      startMission(app, { missionId: "M1", revisionId: "R1" }),
      startMission(app, { missionId: "M2", revisionId: "R1" }),
    ]);
    const saved = await Promise.all([records.getMission("M1"), records.getMission("M2")]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(commands.length, 1);
    assert.equal(saved.filter((item) => item?.reservation?.aircraftId === "A1").length, 1);
  });

  it("keeps an uncertain upload Uploading and reserves the aircraft", async () => {
    let sends = 0;
    const { app, records } = context(["M1"], async () => { sends += 1; throw new Error("acknowledgement timeout"); });
    await prepare(app, "M1");

    const result = await startMission(app, { missionId: "M1", revisionId: "R1" });
    const saved = await records.getMission("M1");

    assert.equal(result.status, "Uploading");
    assert.equal(result.outcome, "unknown");
    assert.equal(sends, 1);
    assert.equal(saved?.status, "Uploading");
    assert.equal(saved?.reservation?.aircraftId, "A1");
    assert.ok(["unknown", "requested"].includes(saved?.commands?.[0]?.outcome ?? ""));
  });

  it("returns the staged start command on repeated upload reconciliation without resending it", async () => {
    const commands: AircraftCommand[] = [];
    const { app } = context(["M1"], async (command) => { commands.push(command); });
    await prepare(app, "M1");
    const upload = await startMission(app, { missionId: "M1", revisionId: "R1" });
    const status = { missionId: "M1", aircraftId: "A1", commandId: upload.commandId, outcome: "accepted", observedAt: now };
    const first = await reconcileCommand(app, { commandId: String(upload.commandId), aircraftId: "A1", status });
    const repeated = await reconcileCommand(app, { commandId: String(upload.commandId), aircraftId: "A1", status });

    assert.ok(first.startCommandId);
    assert.equal(repeated.startCommandId, first.startCommandId);
    assert.equal(commands.filter((command) => command.kind === "start").length, 1);
  });
});
