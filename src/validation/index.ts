import { randomUUID } from "node:crypto";
import type { AppContext, ConfigurationRecord, MissionRecordState, ValidationInputs, ValidationRequest } from "../contracts.ts";

interface Finding { code: string; status: "pass" | "block" | "not_required"; message: string }

export async function validateMission(context: AppContext, request: ValidationRequest): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(request?.missionId);
    if (!mission) throw domainError("unknown_mission", "Mission was not found.");
    if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.");
    if (["uploading", "active"].includes(mission.status.toLowerCase())) throw domainError("mission_locked", "Validation cannot change while the mission is executing.");
    if (mission.currentRevisionId !== request.revisionId) throw domainError("stale_revision", "Only the current saved revision can be validated.");
    const revision = mission.revisions.find((item) => item.id === request.revisionId);
    if (!revision || !revision.startsAt || !revision.endsAt) throw domainError("revision_incomplete", "Saved revision or operation period was not found.");
    const now = parseInstant(context.clock.now());
    if (now === undefined) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.");
    const configuration = await context.records.getConfiguration(revision.configurationId);
    const inputs = await context.records.getValidationInputs(mission.id, revision.id);
    const findings = assess(context, mission, revision, configuration, inputs, now);
    const status = findings.some((finding) => finding.status === "block") ? "Draft" : "Ready";
    const inputVersionIds = collectVersionIds(configuration?.sourceDate, inputs);
    const validation = { id: randomUUID(), revisionId: revision.id, status, findings, inputVersionIds, createdAt: context.clock.now(), operatorId: context.operatorId };
    mission.status = status;
    mission.validations = [...(mission.validations ?? []), validation];
    await context.records.saveMission(mission);
    result = { missionId: mission.id, ...validation, externalAuthorization: inputs?.authorization?.status ?? "not_provided" };
  });
  return result!;
}

function assess(_context: AppContext, mission: MissionRecordState, revision: MissionRecordState["revisions"][number], configuration: ConfigurationRecord | undefined, inputs: ValidationInputs | undefined, now: number): Finding[] {
  const findings: Finding[] = [];
  if (parseInstant(revision.startsAt) === undefined || parseInstant(revision.endsAt) === undefined || parseInstant(revision.endsAt)! <= parseInstant(revision.startsAt)!) add(findings, "operation_period_invalid", "Saved operation period is invalid.");
  if (!configuration || configuration.id !== mission.configurationId || revision.configurationId !== mission.configurationId) add(findings, "configuration_unknown", "The revision's selected configuration is missing or changed.");
  else if (configuration.compatibility === "incompatible") add(findings, "configuration_incompatible", "Current configuration compatibility is confirmed incompatible.");
  else if (configuration.compatibility !== "compatible") add(findings, "compatibility_unknown", "Current compatibility is not documented as compatible.");
  checkRange(findings, configuration, inputs);
  checkAircraftLimits(findings, mission, revision, configuration);
  checkAirspace(findings, inputs, revision, now);
  checkAuthorization(findings, inputs, revision);
  return findings;
}

function checkRange(findings: Finding[], configuration: ConfigurationRecord | undefined, inputs: ValidationInputs | undefined): void {
  if (!configuration || !Number.isFinite(configuration.maxRouteDistanceKm) || configuration.maxRouteDistanceKm <= 0) return add(findings, "range_limit_unknown", "Aircraft range limit is unknown.");
  if (!inputs || !Number.isFinite(inputs.routeDistanceKm) || inputs.routeDistanceKm! <= 0) return add(findings, "route_distance_unknown", "Route distance is unavailable.");
  const reserve = inputs.policy?.reserveFraction;
  if (!Number.isFinite(reserve) || reserve! < 0 || reserve! >= 1) return add(findings, "reserve_policy_missing", "A valid configured reserve policy is required.");
  add(findings, inputs.routeDistanceKm! <= configuration.maxRouteDistanceKm * (1 - reserve!) ? "range_within_reserve" : "range_exceeded_after_reserve", inputs.routeDistanceKm! <= configuration.maxRouteDistanceKm * (1 - reserve!) ? "Route distance is within available range after reserve." : "Route distance exceeds available range after reserve.", inputs.routeDistanceKm! <= configuration.maxRouteDistanceKm * (1 - reserve!) ? "pass" : "block");
}

function checkAircraftLimits(findings: Finding[], mission: MissionRecordState, revision: MissionRecordState["revisions"][number], configuration: ConfigurationRecord | undefined): void {
  if (!configuration) return;
  const limits = [configuration.maxPayloadMassKg, configuration.maxFlightDurationMinutes, configuration.maxAltitudeAglMeters, configuration.maxSpeedMetersPerSecond];
  if (limits.some((limit) => !Number.isFinite(limit) || limit! <= 0)) return add(findings, "aircraft_limit_unknown", "One or more required aircraft limits are undocumented.");
  const waypoints = revision.waypoints ?? [];
  const routeOutsideLimits = waypoints.some((point) => point.altitudeAglMeters > configuration.maxAltitudeAglMeters! || point.speedMetersPerSecond > configuration.maxSpeedMetersPerSecond!);
  const missionOutsideLimits = (mission.needs?.payloadMassKg ?? Infinity) > configuration.maxPayloadMassKg || (mission.needs?.flightDurationMinutes ?? Infinity) > configuration.maxFlightDurationMinutes;
  add(findings, routeOutsideLimits || missionOutsideLimits ? "aircraft_limit_exceeded" : "aircraft_limits_documented", routeOutsideLimits || missionOutsideLimits ? "Mission requirements exceed a documented aircraft limit." : "Mission requirements fit documented aircraft limits.", routeOutsideLimits || missionOutsideLimits ? "block" : "pass");
}

function checkAirspace(findings: Finding[], inputs: ValidationInputs | undefined, revision: MissionRecordState["revisions"][number], now: number): void {
  const airspace = inputs?.airspace;
  if (!airspace || !inputs?.policy) return add(findings, "airspace_evidence_missing", "Current airspace coverage and freshness policy are required.");
  const startsAt = revision.startsAt!;
  const endsAt = revision.endsAt!;
  const sourceDate = parseInstant(airspace.sourceDate);
  const validUntil = parseInstant(airspace.validUntil);
  const coverageStart = parseInstant(airspace.startsAt);
  const coverageEnd = parseInstant(airspace.endsAt);
  const maxAge = inputs.policy.maxAirspaceAgeMs;
  if (!Number.isFinite(maxAge) || maxAge <= 0) add(findings, "airspace_freshness_policy_missing", "A positive airspace freshness policy is required.");
  else if (sourceDate === undefined || sourceDate > now || now - sourceDate > maxAge) add(findings, "airspace_stale", "Airspace data is stale or has an invalid source date.");
  if (validUntil === undefined || validUntil < parseInstant(endsAt)!) add(findings, "airspace_expired", "Airspace data does not remain valid for the whole operation period.");
  const altitudes = revision.waypoints?.map((point) => point.altitudeAglMeters) ?? [];
  const minAltitude = airspace.minAltitudeAglMeters;
  const maxAltitude = airspace.maxAltitudeAglMeters;
  const altitudeCovered = Number.isFinite(minAltitude) && Number.isFinite(maxAltitude) && altitudes.length > 0 && altitudes.every((altitude) => altitude >= minAltitude! && altitude <= maxAltitude!);
  if (!airspace.coversWholeRoute || coverageStart === undefined || coverageEnd === undefined || coverageStart > parseInstant(startsAt)! || coverageEnd < parseInstant(endsAt)! || !altitudeCovered) add(findings, "airspace_coverage_incomplete", "Airspace data does not cover the whole route, altitude, and operation period.");
  else add(findings, "airspace_coverage_complete", "Airspace data covers the whole route and operation period.", "pass");
}

function checkAuthorization(findings: Finding[], inputs: ValidationInputs | undefined, revision: MissionRecordState["revisions"][number]): void {
  if (inputs?.airspace?.authorizationRequired === false) return add(findings, "authorization_not_required", "Current airspace evidence establishes that authorization is not required.", "not_required");
  const authorization = inputs?.authorization;
  if (!authorization) return add(findings, "authorization_missing", "Required external authorization evidence is missing.");
  const from = parseInstant(authorization.validFrom);
  const until = parseInstant(authorization.validUntil);
  const start = parseInstant(revision.startsAt);
  const end = parseInstant(revision.endsAt);
  if (authorization.status !== "approved") add(findings, "authorization_not_approved", `External authorization status is ${authorization.status}.`);
  if (!authorization.coversWholeRoute) add(findings, "authorization_route_scope", "Authorization does not cover the whole route.");
  if (from === undefined || until === undefined || start === undefined || end === undefined || from > start || until < end) add(findings, "authorization_time_scope", "Authorization does not cover the whole operation period.");
  const altitudes = revision.waypoints?.map((point) => point.altitudeAglMeters) ?? [];
  const min = authorization.minAltitudeAglMeters;
  const max = authorization.maxAltitudeAglMeters;
  if (!Number.isFinite(min) || !Number.isFinite(max) || altitudes.length === 0 || altitudes.some((altitude) => altitude < min! || altitude > max!)) add(findings, "authorization_altitude_scope", "Authorization does not document altitude scope covering every waypoint.");
  if (authorization.status === "approved" && authorization.coversWholeRoute && from !== undefined && until !== undefined && start !== undefined && end !== undefined && from <= start && until >= end && Number.isFinite(min) && Number.isFinite(max) && altitudes.length > 0 && altitudes.every((altitude) => altitude >= min! && altitude <= max!)) add(findings, "authorization_scope_valid", "External authorization covers route, altitude, and operation time.", "pass");
}

function collectVersionIds(configurationSourceDate: string | undefined, inputs: ValidationInputs | undefined): string[] {
  return [...new Set([inputs?.versionId, inputs?.policy?.versionId, inputs?.airspace?.versionId, inputs?.authorization?.versionId, configurationSourceDate].filter((value): value is string => Boolean(value)))];
}

function add(findings: Finding[], code: string, message: string, status: Finding["status"] = "block"): void { findings.push({ code, status, message }); }
function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : undefined;
}
function domainError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: "ValidationError", code });
}
