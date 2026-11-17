import { randomUUID } from "node:crypto";
import type { AppContext, ConfigurationRecord, ConfigurationSelection, MissionNeeds, RecommendationRequest } from "../contracts.ts";

type Candidate = ConfigurationRecord & { eligible: boolean; blockingReasons: string[] };

export async function recommendConfigurations(context: AppContext, request: RecommendationRequest): Promise<Record<string, unknown>> {
  validateNeeds(request?.needs);
  const now = validInstant(context.clock.now(), "clock");
  const configurations = await context.records.listConfigurations();
  const candidates = configurations.filter((configuration) => configuration.compatibility !== "incompatible")
    .map((configuration) => assess(configuration, request.needs, now));
  const excluded = configurations.filter((configuration) => configuration.compatibility === "incompatible")
    .map((configuration) => ({ ...configuration, eligible: false, blockingReasons: ["confirmed_incompatibility"] }));
  return {
    needs: request.needs,
    recommended: candidates.filter((candidate) => candidate.eligible).map(({ id }) => id),
    blocked: candidates.filter((candidate) => !candidate.eligible).map(({ id }) => id),
    excluded: excluded.map(({ id }) => id),
    candidates,
    excludedCandidates: excluded,
  };
}

export async function selectConfiguration(context: AppContext, request: ConfigurationSelection): Promise<Record<string, unknown>> {
  validateNeeds(request?.needs);
  let result: Record<string, unknown>;
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(request.missionId);
    if (!mission) throw domainError("unknown_mission", "Mission was not found.");
    if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.");
    if (["uploading", "active"].includes(mission.status.toLowerCase())) throw domainError("mission_locked", "Configuration cannot change while the mission is executing.");
    const configuration = await context.records.getConfiguration(request.configurationId);
    if (!configuration) throw domainError("unknown_configuration", "Configuration was not found.");
    const selectedAt = context.clock.now();
    const candidate = assess(configuration, request.needs, validInstant(selectedAt, "clock"));
    if (!candidate.eligible) throw domainError("configuration_ineligible", candidate.blockingReasons.join(", "));
    const revisionId = randomUUID();
    mission.needs = { ...request.needs };
    mission.configurationId = configuration.id;
    mission.currentRevisionId = revisionId;
    mission.status = "Draft";
    mission.revisions = [...(mission.revisions ?? []), { id: revisionId, configurationId: configuration.id, createdAt: selectedAt, operatorId: context.operatorId }];
    await context.records.saveMission(mission);
    result = { missionId: mission.id, configurationId: configuration.id, revisionId, status: mission.status, needs: mission.needs };
  });
  return result!;
}

function assess(configuration: ConfigurationRecord, needs: MissionNeeds, now: number): Candidate {
  const blockingReasons: string[] = [];
  if (configuration.compatibility !== "compatible") blockingReasons.push("compatibility_needs_review");
  if (!Number.isFinite(configuration.maxPayloadMassKg) || configuration.maxPayloadMassKg <= 0) blockingReasons.push("payload_capacity_undocumented");
  else if (configuration.maxPayloadMassKg < needs.payloadMassKg) blockingReasons.push("insufficient_payload_capacity");
  if (!Number.isFinite(configuration.maxRouteDistanceKm) || configuration.maxRouteDistanceKm <= 0) blockingReasons.push("range_undocumented");
  else if (configuration.maxRouteDistanceKm < needs.routeDistanceKm) blockingReasons.push("insufficient_range");
  if (!Number.isFinite(configuration.maxFlightDurationMinutes) || configuration.maxFlightDurationMinutes <= 0) blockingReasons.push("duration_undocumented");
  else if (configuration.maxFlightDurationMinutes < needs.flightDurationMinutes) blockingReasons.push("insufficient_flight_duration");
  addSourceReasons(configuration, now, blockingReasons);
  return { ...configuration, eligible: blockingReasons.length === 0, blockingReasons };
}

function addSourceReasons(configuration: ConfigurationRecord, now: number, reasons: string[]): void {
  const sourceDate = parseInstant(configuration.sourceDate);
  const validUntil = parseInstant(configuration.sourceValidUntil);
  if (sourceDate === undefined || sourceDate > now) reasons.push("invalid_source_date");
  if (validUntil === undefined || validUntil < now) reasons.push("source_record_stale");
  if (!Array.isArray(configuration.supplierReferences) || configuration.supplierReferences.length === 0 || configuration.supplierReferences.some((reference) => typeof reference !== "string" || !reference.trim())) {
    reasons.push("supplier_references_missing");
  }
}

function validateNeeds(needs: MissionNeeds): void {
  if (!needs || typeof needs !== "object") throw domainError("invalid_needs", "Mission needs are required.", "needs");
  for (const [field, value] of Object.entries(needs)) {
    if (!Number.isFinite(value) || value <= 0) throw domainError("invalid_need", `${field} must be a finite positive value.`, field);
  }
  for (const field of ["payloadMassKg", "routeDistanceKm", "flightDurationMinutes"] as const) {
    if (!(field in needs)) throw domainError("missing_need", `${field} is required.`, field);
  }
}

function validInstant(value: string, field: string): number {
  const parsed = parseInstant(value);
  if (parsed === undefined) throw domainError("invalid_instant", `${field} must be a valid UTC instant.`, field);
  return parsed;
}

function parseInstant(value: string): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function domainError(code: string, message: string, field?: string): Error & { code: string; field?: string } {
  return Object.assign(new Error(message), { name: "EquipmentError", code, ...(field ? { field } : {}) });
}
