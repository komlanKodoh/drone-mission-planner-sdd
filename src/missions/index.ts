import { randomUUID } from "node:crypto";
import type { AircraftCommand, AppContext, ConfigurationRecord, MissionRecordState, PreflightRequest, SaveRevisionRequest, StartRequest, ValidationInputs } from "../contracts.ts";

type Waypoint = NonNullable<SaveRevisionRequest["waypoints"]>[number];

export async function saveRevision(context: AppContext, request: SaveRevisionRequest): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(request?.missionId);
    if (!mission) throw domainError("unknown_mission", "Mission was not found.", "missionId");
    if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.", "missionId");
    if (["uploading", "active"].includes(mission.status.toLowerCase())) throw domainError("mission_locked", "Route cannot be edited while the mission is executing.", "status");
    const configurationId = mission.configurationId;
    if (!configurationId) throw domainError("configuration_required", "Select a configuration before saving a route.", "configurationId");
    const configuration = await context.records.getConfiguration(configurationId);
    if (!configuration) throw domainError("unknown_configuration", "Selected configuration was not found.", "configurationId");
    validateRoute(request, configuration);
    const createdAt = context.clock.now();
    if (parseInstant(createdAt) === undefined) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.", "clock");
    const revision = { id: randomUUID(), configurationId, createdAt, operatorId: context.operatorId, startsAt: request.startsAt, endsAt: request.endsAt, waypoints: request.waypoints.map((point) => ({ ...point })) };
    mission.revisions = [...mission.revisions, revision];
    mission.currentRevisionId = revision.id;
    mission.status = "Draft";
    await context.records.saveMission(mission);
    result = { missionId: mission.id, revisionId: revision.id, revision, status: "Draft" };
  });
  return result!;
}

export async function confirmPreflight(context: AppContext, request: PreflightRequest): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(request?.missionId);
    if (!mission) throw domainError("unknown_mission", "Mission was not found.", "missionId");
    if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.", "missionId");
    if (mission.currentRevisionId !== request.revisionId) throw domainError("stale_revision", "Preflight must confirm the current saved revision.", "revisionId");
    const validation = mission.validations?.find((item) => item.id === request.validationId);
    if (!validation || validation.revisionId !== request.revisionId) throw domainError("validation_mismatch", "Validation was not found for this revision.", "validationId");
    if (validation.status !== "Ready" || validation.findings.some((finding) => finding.status === "block")) throw domainError("validation_blocked", "A blocking validation cannot be confirmed.", "validationId");
    const revision = mission.revisions.find((item) => item.id === request.revisionId);
    const configuration = revision && await context.records.getConfiguration(revision.configurationId);
    const inputs = await context.records.getValidationInputs(mission.id, request.revisionId);
    const currentReferences = collectVersionIds(configuration?.sourceDate, inputs);
    const confirmedAt = context.clock.now();
    if (parseInstant(confirmedAt) === undefined) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.", "clock");
    if (!sameReferences(validation.inputVersionIds, currentReferences) || !evidenceIsCurrent(configuration, inputs, confirmedAt)) throw domainError("stale_validation", "Validation inputs changed or expired; validate this revision again.", "validationId");
    const confirmation = { id: randomUUID(), revisionId: request.revisionId, validationId: validation.id, inputVersionIds: [...currentReferences], confirmedAt, operatorId: context.operatorId };
    mission.confirmations = [...(mission.confirmations ?? []), confirmation];
    await context.records.saveMission(mission);
    result = { missionId: mission.id, ...confirmation, confirmed: true };
  });
  return result!;
}

export async function startMission(context: AppContext, request: StartRequest): Promise<Record<string, unknown>> {
  let command: AircraftCommand;
  let result: Record<string, unknown>;
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(request?.missionId);
    const validationId = await checkStartPrerequisites(context, mission, request);
    const aircraftId = mission!.aircraftId!;
    const occupied = (await context.records.listMissions()).some((other) => other.id !== mission!.id && other.reservation?.aircraftId === aircraftId);
    if (occupied || mission!.reservation) throw domainError("aircraft_reserved", "Aircraft has an active or unresolved mission reservation.", "aircraftId");
    const commandId = randomUUID();
    const createdAt = context.clock.now();
    if (parseInstant(createdAt) === undefined) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.", "clock");
    command = { commandId, missionId: mission!.id, aircraftId, kind: "upload", payload: { revisionId: request.revisionId } };
    mission!.status = "Uploading";
    mission!.reservation = { aircraftId, commandId };
    mission!.commands = [...(mission!.commands ?? []), { id: commandId, missionId: mission!.id, aircraftId, revisionId: request.revisionId, kind: "upload", outcome: "requested", createdAt, updatedAt: createdAt, payload: { revisionId: request.revisionId } }];
    await context.records.saveMission(mission!);
    result = { missionId: mission!.id, revisionId: request.revisionId, commandId, aircraftId, status: "Uploading", outcome: "requested", validationId };
  });
  try {
    await context.aircraft.send(command!);
  } catch {
    await markUploadUnknown(context, result!.missionId as string, result!.commandId as string);
    result = { ...result!, outcome: "unknown" };
  }
  return result!;
}

async function checkStartPrerequisites(context: AppContext, mission: MissionRecordState | undefined, request: StartRequest): Promise<string> {
  if (!mission) throw domainError("unknown_mission", "Mission was not found.", "missionId");
  if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.", "missionId");
  if (mission.currentRevisionId !== request.revisionId) throw domainError("stale_revision", "Start must use the current saved revision.", "revisionId");
  if (mission.status.toLowerCase() !== "ready") throw domainError("mission_not_ready", "Mission must be Ready before starting.", "status");
  if (!mission.aircraftId) throw domainError("aircraft_required", "Assign an aircraft before starting.", "aircraftId");
  const validation = mission.validations?.filter((item) => item.revisionId === request.revisionId).at(-1);
  if (!validation || validation.status !== "Ready" || validation.findings.some((finding) => finding.status === "block")) throw domainError("validation_blocked", "Current revision does not have a Ready validation.", "revisionId");
  const confirmation = mission.confirmations?.find((item) => item.revisionId === request.revisionId && item.validationId === validation.id);
  if (!confirmation) throw domainError("preflight_required", "Current validation needs a preflight confirmation.", "revisionId");
  const revision = mission.revisions.find((item) => item.id === request.revisionId);
  const configuration = revision && await context.records.getConfiguration(revision.configurationId);
  const inputs = await context.records.getValidationInputs(mission.id, request.revisionId);
  const references = collectVersionIds(configuration?.sourceDate, inputs);
  const now = context.clock.now();
  if (parseInstant(now) === undefined) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.", "clock");
  if (!sameReferences(validation.inputVersionIds, references) || !sameReferences(confirmation.inputVersionIds, references) || !evidenceIsCurrent(configuration, inputs, now)) throw domainError("stale_validation", "Validation inputs changed or expired; validate this revision and confirm preflight again.", "revisionId");
  return validation.id;
}

async function markUploadUnknown(context: AppContext, missionId: string, commandId: string): Promise<void> {
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(missionId);
    if (!mission) return;
    mission.commands = mission.commands?.map((item) => item.id === commandId ? { ...item, outcome: "unknown", updatedAt: context.clock.now() } : item);
    await context.records.saveMission(mission);
  });
}

function validateRoute(request: SaveRevisionRequest, configuration: ConfigurationRecord): void {
  const start = parseInstant(request?.startsAt);
  const end = parseInstant(request?.endsAt);
  if (start === undefined) throw domainError("invalid_time", "startsAt must include a valid UTC offset.", "startsAt");
  if (end === undefined) throw domainError("invalid_time", "endsAt must include a valid UTC offset.", "endsAt");
  if (end <= start) throw domainError("invalid_period", "endsAt must be later than startsAt.", "endsAt");
  if (!Array.isArray(request?.waypoints) || request.waypoints.length === 0) throw domainError("waypoints_required", "At least one waypoint is required.", "waypoints");
  const maxAltitude = requiredLimit(configuration.maxAltitudeAglMeters, "maxAltitudeAglMeters");
  const maxSpeed = requiredLimit(configuration.maxSpeedMetersPerSecond, "maxSpeedMetersPerSecond");
  if (!Array.isArray(configuration.supportedTasks) || configuration.supportedTasks.length === 0) throw domainError("tasks_undocumented", "Configuration must document supported tasks.", "supportedTasks");
  validateWaypoints(request.waypoints, maxAltitude, maxSpeed, configuration.supportedTasks);
}

function validateWaypoints(waypoints: Waypoint[], maxAltitude: number, maxSpeed: number, supportedTasks: string[]): void {
  let previousOrder = -Infinity;
  waypoints.forEach((point, index) => {
    const prefix = `waypoints[${index}]`;
    if (!point || typeof point !== "object") throw domainError("invalid_waypoint", "Waypoint must be an object.", prefix);
    const order = finiteNumber(point.order, `${prefix}.order`);
    if (!Number.isInteger(order) || order <= previousOrder) throw domainError("invalid_order", "Waypoint orders must be unique and strictly increasing integers.", `${prefix}.order`);
    previousOrder = order;
    boundedCoordinate(point.latitude, -90, 90, `${prefix}.latitude`);
    boundedCoordinate(point.longitude, -180, 180, `${prefix}.longitude`);
    const altitude = finiteNumber(point.altitudeAglMeters, `${prefix}.altitudeAglMeters`);
    if (altitude < 0 || altitude > maxAltitude) throw domainError("altitude_out_of_range", `Altitude must be between 0 and ${maxAltitude} meters AGL.`, `${prefix}.altitudeAglMeters`);
    const speed = finiteNumber(point.speedMetersPerSecond, `${prefix}.speedMetersPerSecond`);
    if (speed <= 0 || speed > maxSpeed) throw domainError("speed_out_of_range", `Speed must be positive and no greater than ${maxSpeed} m/s.`, `${prefix}.speedMetersPerSecond`);
    if (typeof point.task !== "string" || !supportedTasks.includes(point.task)) throw domainError("unsupported_task", "Task is not supported by the selected configuration.", `${prefix}.task`);
  });
}

function boundedCoordinate(value: unknown, min: number, max: number, field: string): void {
  const coordinate = finiteNumber(value, field);
  if (coordinate < min || coordinate > max) throw domainError("coordinate_out_of_range", `Must be between ${min} and ${max} degrees.`, field);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw domainError("invalid_number", "Must be a finite number.", field);
  return value;
}

function requiredLimit(value: number | undefined, field: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) throw domainError("limit_undocumented", "Selected configuration must document a finite positive limit.", field);
  return value;
}

function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectVersionIds(configurationSourceDate: string | undefined, inputs: ValidationInputs | undefined): string[] {
  return [...new Set([inputs?.versionId, inputs?.policy?.versionId, inputs?.airspace?.versionId, inputs?.authorization?.versionId, configurationSourceDate].filter((value): value is string => Boolean(value)))];
}

function sameReferences(left: string[], right: string[]): boolean {
  const expected = [...left].sort();
  const current = [...right].sort();
  return expected.length === current.length && expected.every((reference, index) => reference === current[index]);
}

function evidenceIsCurrent(configuration: ConfigurationRecord | undefined, inputs: ValidationInputs | undefined, now: string): boolean {
  const source = parseInstant(inputs?.airspace?.sourceDate);
  const instant = parseInstant(now);
  const maxAge = inputs?.policy?.maxAirspaceAgeMs;
  const expires = [configuration?.sourceValidUntil, inputs?.airspace?.validUntil, inputs?.authorization?.validUntil].filter((value): value is string => value !== undefined).map(parseInstant);
  return source !== undefined && instant !== undefined && Number.isFinite(maxAge) && maxAge! > 0 && source <= instant && instant - source <= maxAge! && expires.every((expiry) => expiry !== undefined && expiry >= instant);
}

function domainError(code: string, message: string, field: string): Error & { code: string; field: string } {
  return Object.assign(new Error(message), { name: "MissionError", code, field });
}
