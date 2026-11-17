import type { AppContext, ConfigurationRecord, MissionRecordState } from "../src/contracts.ts";
import { MemoryRecords } from "../src/records/index.ts";
import { recommendConfigurations, selectConfiguration } from "../src/equipment/index.ts";
import { saveRevision } from "../src/missions/index.ts";

const now = "2026-11-16T18:00:00Z";
const configuration: ConfigurationRecord = {
  id: "demo-survey-config",
  maxPayloadMassKg: 1.5,
  maxRouteDistanceKm: 8,
  maxFlightDurationMinutes: 35,
  compatibility: "compatible",
  supplierReferences: ["DEMO-SUPPLIER-RECORD"],
  sourceDate: "2026-10-01T00:00:00Z",
  sourceValidUntil: "2027-01-01T00:00:00Z",
  maxAltitudeAglMeters: 90,
  maxSpeedMetersPerSecond: 12,
  supportedTasks: ["survey"],
};
const mission: MissionRecordState = {
  id: "demo-mission",
  operatorId: "demo-operator",
  status: "Draft",
  revisions: [],
};

async function main(): Promise<void> {
  const records = new MemoryRecords({ configurations: [configuration], missions: [mission] });
  const aircraftCommands: unknown[] = [];
  const context: AppContext = {
    clock: { now: () => now },
    records,
    operatorId: "demo-operator",
    aircraft: { send: async (command) => { aircraftCommands.push(command); } },
  };
  const needs = { payloadMassKg: 0.5, routeDistanceKm: 2, flightDurationMinutes: 20 };
  const recommendations = await recommendConfigurations(context, { needs });
  console.log("1. Recommendation result:", JSON.stringify(recommendations, null, 2));
  const selection = await selectConfiguration(context, { missionId: mission.id, configurationId: configuration.id, needs });
  console.log("2. Selected configuration:", JSON.stringify(selection, null, 2));
  const saved = await saveRevision(context, {
    missionId: mission.id,
    startsAt: "2026-11-17T12:00:00Z",
    endsAt: "2026-11-17T13:00:00Z",
    waypoints: [{ order: 1, latitude: 42, longitude: -87, altitudeAglMeters: 30, speedMetersPerSecond: 5, task: "survey" }],
  });
  console.log("3. Saved route revision:", JSON.stringify(saved, null, 2));
  console.log("4. Mission record:", JSON.stringify(await records.getMission(mission.id), null, 2));
  console.log(`Synthetic aircraft commands sent: ${aircraftCommands.length}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
