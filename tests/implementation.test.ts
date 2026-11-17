import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import { describe, it } from "node:test";
import type { AppContext, ConfigurationRecord, MissionRecordState } from "../src/contracts.ts";
import { selectConfiguration, recommendConfigurations } from "../src/equipment/index.ts";
import { MemoryRecords } from "../src/records/index.ts";

const now = "2026-11-16T18:00:00.000Z";
const needs = { payloadMassKg: 2, routeDistanceKm: 10, flightDurationMinutes: 20 };

function configuration(id: string, compatibility: ConfigurationRecord["compatibility"]): ConfigurationRecord {
  return {
    id, maxPayloadMassKg: 3, maxRouteDistanceKm: 12, maxFlightDurationMinutes: 25,
    compatibility, supplierReferences: [`supplier:${id}`], sourceDate: "2026-11-01T00:00:00Z",
    sourceValidUntil: "2026-12-01T00:00:00Z",
  };
}

function context(configurations: ConfigurationRecord[], missions: MissionRecordState[] = []): AppContext {
  return {
    clock: { now: () => now },
    records: new MemoryRecords({ configurations, missions }),
    aircraft: { send: async () => { throw new Error("Equipment selection must not send aircraft commands."); } },
    operatorId: "P1",
  };
}

function mission(): MissionRecordState {
  return { id: "M1", operatorId: "P1", status: "Draft", revisions: [] };
}

describe("equipment implementation", () => {
  it("recommends a documented compatible configuration that meets every need", async () => {
    const result = await recommendConfigurations(context([configuration("C1", "compatible")]), { needs });
    assert.deepEqual(result.recommended, ["C1"]);
    assert.deepEqual(result.blocked, []);
    assert.equal((result.candidates as Array<Record<string, unknown>>)[0].eligible, true);
  });

  it("shows unknown compatibility as blocked and never recommends it", async () => {
    const result = await recommendConfigurations(context([configuration("C2", "unknown")]), { needs });
    assert.deepEqual(result.recommended, []);
    assert.deepEqual(result.blocked, ["C2"]);
    const candidate = (result.candidates as Array<Record<string, unknown>>)[0];
    assert.equal(candidate.eligible, false);
    assert.ok((candidate.blockingReasons as string[]).length > 0);
  });

  it("persists an eligible selection and its needs for the mission", async () => {
    const app = context([configuration("C1", "compatible")], [mission()]);
    const selected = await selectConfiguration(app, { missionId: "M1", configurationId: "C1", needs });
    const saved = await app.records.getMission("M1");
    assert.equal(selected.configurationId, "C1");
    assert.equal(selected.status, "Draft");
    assert.equal(saved?.configurationId, "C1");
    assert.deepEqual(saved?.needs, needs);
    assert.equal(saved?.revisions.length, 1);
    assert.equal(saved?.currentRevisionId, saved?.revisions[0].id);
  });

  it("rejects invalid needs and blocked selections without changing mission state", async () => {
    const app = context([configuration("C2", "unknown")], [mission()]);
    await assert.rejects(
      recommendConfigurations(app, { needs: { ...needs, payloadMassKg: 0 } }),
      (error: Error & { code?: string }) => error.code === "invalid_need",
    );
    await assert.rejects(
      selectConfiguration(app, { missionId: "M1", configurationId: "C2", needs }),
      (error: Error & { code?: string }) => error.code === "configuration_ineligible",
    );
    const saved = await app.records.getMission("M1");
    assert.equal(saved?.configurationId, undefined);
    assert.deepEqual(saved?.revisions, []);
  });

  it("serves recommendation and selection over HTTP and persists the selection", async (testContext) => {
    const app = context([configuration("C1", "compatible")], [mission()]);
    const server = createServer(app);
    try { await listen(server); } catch (error) {
      if ((error as { code?: string }).code === "EPERM") return testContext.skip("Local network binding is blocked in this environment.");
      throw error;
    }
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const recommendation = await fetch(`${baseUrl}/api/recommendations`, jsonRequest("POST", { needs }));
      assert.equal(recommendation.status, 200);
      assert.deepEqual((await recommendation.json()).recommended, ["C1"]);
      const selection = await fetch(`${baseUrl}/api/missions/M1/configuration`, jsonRequest("PUT", { configurationId: "C1", needs }));
      assert.equal(selection.status, 200);
      assert.equal((await selection.json()).configurationId, "C1");
      assert.equal((await app.records.getMission("M1"))?.configurationId, "C1");
    } finally { await close(server); }
  });
});

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
