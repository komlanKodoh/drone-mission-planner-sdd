import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppContext, ConfigurationRecord, MissionRecordState, TelemetryObservation, ValidationInputs } from "../src/contracts.ts";
import { MemoryRecords } from "../src/records/index.ts";
import { createServer } from "../src/server.ts";
import { renderDemoPage } from "../src/interface/demo-page.ts";

const demoNow = "2026-11-16T18:00:00Z";
const configuration: ConfigurationRecord = {
  id: "demo-survey-config", maxPayloadMassKg: 1.5, maxRouteDistanceKm: 8,
  maxFlightDurationMinutes: 35, compatibility: "compatible",
  supplierReferences: ["SYNTHETIC-SUPPLIER-REFERENCE"],
  sourceDate: "2026-11-16T17:00:00Z", sourceValidUntil: "2026-12-16T18:00:00Z",
  maxAltitudeAglMeters: 90, maxSpeedMetersPerSecond: 12,
  supportedTasks: ["survey"], supportedSafeActions: ["hold", "return_home"],
};
const mission: MissionRecordState = {
  id: "M1", operatorId: "demo-operator", aircraftId: "A1", status: "Draft", revisions: [],
};
const inputs: ValidationInputs = {
  versionId: "SYNTHETIC-INPUTS-v1", routeDistanceKm: 2,
  policy: { versionId: "SYNTHETIC-POLICY-v1", reserveFraction: 0.2, maxAirspaceAgeMs: 86_400_000 },
  airspace: {
    versionId: "SYNTHETIC-AIRSPACE-v1", sourceDate: "2026-11-16T17:00:00Z",
    validUntil: "2026-11-18T18:00:00Z", coversWholeRoute: true,
    minAltitudeAglMeters: 0, maxAltitudeAglMeters: 120,
    startsAt: "2026-11-17T12:00:00Z", endsAt: "2026-11-17T13:00:00Z",
    authorizationRequired: false,
  },
};

export function createDemoContext(): AppContext {
  const records = new DemoMemoryRecords({
    configurations: [configuration], missions: [mission],
    validationInputs: { "M1:demo-route": inputs },
  });
  const fakeAircraft = createFakeAircraft();
  return {
    clock: { now: () => demoNow }, records, operatorId: "demo-operator",
    aircraft: {
      send: async (command) => { fakeAircraft.commands.push(structuredClone(command)); },
      readTelemetry: async (missionId, aircraftId) => fakeAircraft.telemetry(missionId, aircraftId),
      thresholds: { staleAfterMs: 30_000, lostLinkAfterMs: 120_000, deviationMeters: 75, lowBatteryPercent: 20, commandAckTimeoutMs: 15_000 },
    },
  };
}

class DemoMemoryRecords extends MemoryRecords {
  async getValidationInputs(missionId: string, revisionId: string): Promise<ValidationInputs | undefined> {
    return await super.getValidationInputs(missionId, revisionId) ?? (missionId === "M1" ? structuredClone(inputs) : undefined);
  }
}

function createFakeAircraft(): { commands: unknown[]; telemetry: (missionId: string, aircraftId: string) => Promise<TelemetryObservation | undefined> } {
  return {
    commands: [],
    telemetry: async (missionId, aircraftId) => missionId === "M1" && aircraftId === "A1" ? ({
      missionId, aircraftId, observedAt: demoNow, position: { latitude: 42.0005, longitude: -87 },
      batteryPercent: 85, mode: "synthetic_auto", progress: 0.25,
    }) : undefined,
  };
}

function serveDemo(request: IncomingMessage, response: ServerResponse, api: (request: IncomingMessage, response: ServerResponse) => void): void {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderDemoPage());
    return;
  }
  api(request, response);
}

export function createDemoServer(context: AppContext = createDemoContext()) {
  const api = createServer(context);
  const apiHandler = api.listeners("request")[0] as (request: IncomingMessage, response: ServerResponse) => void;
  return createHttpServer((request, response) => serveDemo(request, response, apiHandler));
}

if (process.argv[1]?.endsWith("/scripts/demo-server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createDemoServer().listen(port, "127.0.0.1", () => {
    console.log(`Synthetic demo only: open http://127.0.0.1:${port}`);
  });
}
