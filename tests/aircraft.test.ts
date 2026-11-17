import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState, TelemetryObservation } from "../src/contracts.ts";
import { getTelemetry, reconcileCommand, requestManualMode, requestSafeAction } from "../src/aircraft/index.ts";
import { MemoryRecords } from "../src/records/index.ts";

const initialTime = Date.parse("2026-11-16T18:00:00.000Z");
const thresholds = { staleAfterMs: 2_000, lostLinkAfterMs: 5_000, deviationMeters: 100, lowBatteryPercent: 20, commandAckTimeoutMs: 1_000 };

function configuration(): ConfigurationRecord {
  return {
    id: "C1", maxPayloadMassKg: 3, maxRouteDistanceKm: 10, maxFlightDurationMinutes: 30,
    compatibility: "compatible", supplierReferences: ["supplier:C1"], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z", maxAltitudeAglMeters: 100, maxSpeedMetersPerSecond: 10,
    supportedTasks: ["survey"], supportedSafeActions: ["return"],
  };
}

function mission(status = "Active"): MissionRecordState {
  return {
    id: "M1", operatorId: "P1", status, configurationId: "C1", currentRevisionId: "R1", aircraftId: "A1",
    revisions: [{
      id: "R1", configurationId: "C1", createdAt: "2026-11-16T17:00:00Z", operatorId: "P1",
      waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
    }],
  };
}

function observation(overrides: Partial<TelemetryObservation> = {}): TelemetryObservation {
  return {
    missionId: "M1", aircraftId: "A1", observedAt: "2026-11-16T17:59:58.001Z",
    position: { latitude: 42, longitude: -87 }, batteryPercent: 80, mode: "manual", progress: 0.5,
    ...overrides,
  };
}

function fixture(sample: TelemetryObservation | undefined = observation()) {
  let now = initialTime;
  let currentSample = sample;
  const sent: Array<{ commandId: string; kind: string }> = [];
  const records = new MemoryRecords({ configurations: [configuration()], missions: [mission()] });
  const app: AppContext = {
    clock: { now: () => new Date(now).toISOString() }, records, operatorId: "P1",
    aircraft: {
      thresholds,
      send: async (command) => { sent.push({ commandId: command.commandId, kind: command.kind }); },
      readTelemetry: async () => currentSample && structuredClone(currentSample),
    },
  };
  return {
    app, sent,
    setNow: (value: number) => { now = value; },
    setSample: (value: TelemetryObservation | undefined) => { currentSample = value; },
  };
}

describe("aircraft supervision implementation", () => {
  it("reports a matching timestamped observation and enforces the explicit freshness boundary", async () => {
    const fixtureState = fixture();
    const response = await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal(response.observationAgeMs, 1_999);
    assert.equal(response.stale, false);
    assert.equal(response.lostLink, false);
    assert.equal(response.directControlEnabled, true);
    assert.equal((response.observation as TelemetryObservation).observedAt, "2026-11-16T17:59:58.001Z");

    fixtureState.setSample(observation({ missionId: "M2", observedAt: "2026-11-16T18:00:00.000Z" }));
    const wrongMission = await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal((wrongMission.observation as TelemetryObservation).observedAt, "2026-11-16T17:59:58.001Z");
    fixtureState.setSample(observation({ observedAt: "2026-11-16T17:59:57.000Z", mode: "autonomous" }));
    const older = await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal((older.observation as TelemetryObservation).mode, "manual");

    fixtureState.setNow(initialTime + 2_000);
    const stale = await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal(stale.stale, true);
    assert.equal(stale.directControlEnabled, false);
  });

  it("requires fresh matching telemetry before requesting manual mode", async () => {
    const fresh = fixture(observation({ mode: "autonomous" }));
    const result = await requestManualMode(fresh.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal(result.kind, "manual_mode");
    assert.equal(result.outcome, "requested");
    assert.equal(result.directControlEnabled, false);
    assert.equal(fresh.sent.length, 1);

    const stale = fixture(observation({ observedAt: "2026-11-16T17:59:58.000Z", mode: "autonomous" }));
    await assert.rejects(
      requestManualMode(stale.app, { missionId: "M1", aircraftId: "A1" }),
      (error: Error & { code?: string }) => error.code === "telemetry_stale",
    );
    assert.equal(stale.sent.length, 0);
  });

  it("reconciles an acknowledgement once after timeout and never retries the command", async () => {
    const fixtureState = fixture(observation({ mode: "autonomous" }));
    const requested = await requestManualMode(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    const commandId = String(requested.commandId);
    fixtureState.setNow(initialTime + thresholds.commandAckTimeoutMs);
    const status = {
      commandId, missionId: "M1", aircraftId: "A1", observedAt: new Date(initialTime + thresholds.commandAckTimeoutMs).toISOString(), outcome: "accepted",
    };
    const accepted = await reconcileCommand(fixtureState.app, { commandId, aircraftId: "A1", status });
    assert.equal(accepted.outcome, "accepted");
    const afterFirstAck = await fixtureState.app.records.getMission("M1");
    const firstEvents = afterFirstAck?.commands?.[0].events ?? [];
    assert.deepEqual(firstEvents.map(({ outcome }) => outcome), ["requested", "unknown", "accepted"]);

    await reconcileCommand(fixtureState.app, { commandId, aircraftId: "A1", status });
    const afterRepeat = await fixtureState.app.records.getMission("M1");
    assert.equal(afterRepeat?.commands?.[0].events?.length, firstEvents.length);
    assert.equal(fixtureState.sent.length, 1);
  });

  it("keeps a safe-action mission Active until fresh telemetry confirms landing", async () => {
    const fixtureState = fixture(undefined);
    const requested = await requestSafeAction(fixtureState.app, { missionId: "M1", aircraftId: "A1", action: "return" });
    assert.equal(requested.kind, "safe_action");
    assert.equal(requested.outcome, "requested");
    assert.equal((await fixtureState.app.records.getMission("M1"))?.status, "Active");

    fixtureState.setSample(observation({ observedAt: "2026-11-16T17:59:58.000Z", landed: true }));
    await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal((await fixtureState.app.records.getMission("M1"))?.status, "Active");

    fixtureState.setSample(observation({ observedAt: "2026-11-16T18:00:00.000Z", landed: true }));
    await getTelemetry(fixtureState.app, { missionId: "M1", aircraftId: "A1" });
    assert.equal((await fixtureState.app.records.getMission("M1"))?.status, "Completed");
    assert.equal(fixtureState.sent.length, 1);
  });
});
