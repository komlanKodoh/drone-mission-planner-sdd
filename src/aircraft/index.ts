import { randomUUID } from "node:crypto";
import type {
  AircraftCommand,
  AppContext,
  CommandRecord,
  MissionRecordState,
  TelemetryObservation,
  TelemetryRequest,
  ManualModeRequest,
  ReconcileRequest,
  SafeActionRequest,
  ValidationInputs,
} from "../contracts.ts";

export async function getTelemetry(context: AppContext, request: TelemetryRequest): Promise<Record<string, unknown>> {
  const mission = await missionForAircraft(context, request.missionId, request.aircraftId);
  const thresholds = getThresholds(context);
  await markExpiredCommands(context, mission, thresholds.commandAckTimeoutMs);
  const incoming = context.aircraft.readTelemetry && await context.aircraft.readTelemetry(mission.id, request.aircraftId);
  const observation = await recordObservation(context, mission, incoming, thresholds);
  if (!observation) throw domainError("telemetry_unavailable", "No matching aircraft observation is available.", "aircraftId");
  const ageMs = observationAge(context.clock.now(), observation.observedAt);
  return {
    missionId: mission.id, aircraftId: request.aircraftId, observation,
    observationAgeMs: ageMs, stale: ageMs >= thresholds.staleAfterMs,
    lostLink: ageMs >= thresholds.lostLinkAfterMs,
    directControlEnabled: mission.status.toLowerCase() === "active" && isFreshManual(observation, ageMs, thresholds),
    alerts: (await context.records.getMission(mission.id))?.alerts ?? [],
  };
}

export async function requestManualMode(context: AppContext, request: ManualModeRequest): Promise<Record<string, unknown>> {
  const mission = await missionForAircraft(context, request.missionId, request.aircraftId);
  if (mission.status.toLowerCase() !== "active") throw domainError("mission_not_active", "Manual mode is available only for an Active mission.", "status");
  if (!mission.currentRevisionId) throw domainError("revision_required", "Mission has no current revision.", "revisionId");
  const thresholds = getThresholds(context);
  await markExpiredCommands(context, mission, thresholds.commandAckTimeoutMs);
  const sample = context.aircraft.readTelemetry && await context.aircraft.readTelemetry(mission.id, request.aircraftId);
  const observation = await recordObservation(context, mission, sample, thresholds);
  const age = observation ? observationAge(context.clock.now(), observation.observedAt) : Infinity;
  if (!observation || age >= thresholds.staleAfterMs) throw domainError("telemetry_stale", "Fresh matching telemetry is required before requesting manual mode.", "aircraftId");
  if (mission.status.toLowerCase() !== "active") throw domainError("mission_not_active", "Fresh telemetry confirms the mission has ended.", "status");
  return createCommand(context, mission, "manual_mode", { mode: "manual" });
}

export async function reconcileCommand(context: AppContext, request: ReconcileRequest): Promise<Record<string, unknown>> {
  let mission = await findCommandMission(context, request.commandId);
  const thresholds = getThresholds(context);
  mission = await markExpiredCommands(context, mission, thresholds.commandAckTimeoutMs);
  const command = mission.commands!.find((item) => item.id === request.commandId)!;
  const status = request.status;
  if (request.aircraftId !== command.aircraftId || status.aircraftId !== command.aircraftId || status.missionId !== mission.id || status.commandId !== command.id) {
    throw domainError("command_mismatch", "Aircraft status does not match the command identity.", "status");
  }
  const observedAt = status.observedAt;
  const age = typeof observedAt === "string" ? observationAge(context.clock.now(), observedAt) : Infinity;
  if (age < 0 || age >= thresholds.staleAfterMs) throw domainError("status_stale", "Command status must be a fresh aircraft observation.", "status.observedAt");
  const outcome = status.outcome;
  const execution = status.execution;
  if (outcome !== undefined && outcome !== "accepted" && outcome !== "rejected") throw domainError("invalid_status", "Status outcome must be accepted or rejected.", "status.outcome");
  if (execution !== undefined && execution !== "executing" && execution !== "not_executing") throw domainError("invalid_status", "Execution status must be executing or not_executing.", "status.execution");
  if (outcome === undefined && execution === undefined && status.landed !== true) throw domainError("invalid_status", "Status must include an outcome or execution state.", "status");
  if (execution !== undefined && status.revisionId !== command.revisionId) throw domainError("revision_mismatch", "Execution status must match the command revision.", "status.revisionId");
  return applyCommandStatus(context, mission, command, status, outcome, observedAt as string);
}

export async function requestSafeAction(context: AppContext, request: SafeActionRequest): Promise<Record<string, unknown>> {
  const mission = await missionForAircraft(context, request.missionId, request.aircraftId);
  if (mission.status.toLowerCase() !== "active") throw domainError("mission_not_active", "Safe actions are available only for an Active mission.", "status");
  if (!mission.currentRevisionId) throw domainError("revision_required", "Mission has no current revision.", "revisionId");
  const thresholds = getThresholds(context);
  await markExpiredCommands(context, mission, thresholds.commandAckTimeoutMs);
  const revision = mission.revisions.find((item) => item.id === mission.currentRevisionId);
  const configuration = revision && await context.records.getConfiguration(revision.configurationId);
  if (!configuration?.supportedSafeActions?.includes(request.action)) throw domainError("unsupported_action", "Aircraft configuration does not document this safe action.", "action");
  return createCommand(context, mission, "safe_action", { action: request.action });
}

async function missionForAircraft(context: AppContext, missionId: string, aircraftId: string): Promise<MissionRecordState> {
  const mission = await context.records.getMission(missionId);
  if (!mission) throw domainError("unknown_mission", "Mission was not found.", "missionId");
  if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.", "missionId");
  if (mission.aircraftId !== aircraftId) throw domainError("aircraft_mismatch", "Aircraft does not match this mission.", "aircraftId");
  return mission;
}

function getThresholds(context: AppContext) {
  const value = context.aircraft.thresholds;
  if (!value || !positive(value.staleAfterMs) || !positive(value.lostLinkAfterMs) || value.staleAfterMs >= value.lostLinkAfterMs ||
      !positive(value.deviationMeters) || !Number.isFinite(value.lowBatteryPercent) || value.lowBatteryPercent < 0 || value.lowBatteryPercent > 100 ||
      !positive(value.commandAckTimeoutMs)) {
    throw domainError("thresholds_unconfigured", "Valid aircraft supervision thresholds must be configured.", "thresholds");
  }
  return value;
}

async function recordObservation(context: AppContext, mission: MissionRecordState, incoming: TelemetryObservation | undefined, thresholds: ReturnType<typeof getThresholds>): Promise<TelemetryObservation | undefined> {
  let changed = false;
  const sample = incoming && matchesObservation(mission, incoming) && observationAge(context.clock.now(), incoming.observedAt) >= 0 &&
    (!mission.telemetry || Date.parse(incoming.observedAt) > Date.parse(mission.telemetry.observedAt)) ? incoming : undefined;
  if (sample) { mission.telemetry = structuredClone(sample); changed = true; }
  const observation = mission.telemetry;
  if (observation) changed = await addObservationAlerts(context, mission, observation, thresholds) || changed;
  if (changed) await context.records.saveMission(mission);
  return observation;
}

function matchesObservation(mission: MissionRecordState, sample: TelemetryObservation): boolean {
  return sample.missionId === mission.id && sample.aircraftId === mission.aircraftId && validInstant(sample.observedAt) &&
    Number.isFinite(sample.position?.latitude) && sample.position.latitude >= -90 && sample.position.latitude <= 90 &&
    Number.isFinite(sample.position?.longitude) && sample.position.longitude >= -180 && sample.position.longitude <= 180 &&
    Number.isFinite(sample.batteryPercent) && sample.batteryPercent >= 0 && sample.batteryPercent <= 100 &&
    typeof sample.mode === "string" && Number.isFinite(sample.progress);
}

async function addObservationAlerts(context: AppContext, mission: MissionRecordState, sample: TelemetryObservation, thresholds: ReturnType<typeof getThresholds>): Promise<boolean> {
  const age = observationAge(context.clock.now(), sample.observedAt);
  const wanted: Array<[string, string]> = [];
  if (sample.batteryPercent <= thresholds.lowBatteryPercent) wanted.push(["low_battery", "Battery level reached the configured alert threshold."]);
  if (routeDeviationMeters(sample, mission) > thresholds.deviationMeters) wanted.push(["route_deviation", "Observed position exceeded the configured route deviation threshold."]);
  if (age >= thresholds.staleAfterMs) wanted.push(["stale_telemetry", "The latest aircraft observation is stale."]);
  if (age >= thresholds.lostLinkAfterMs) wanted.push(["lost_link", "No fresh aircraft observation is available."]);
  let changed = false;
  mission.alerts ??= [];
  for (const [type, reason] of wanted) {
    const id = `${type}:${sample.observedAt}`;
    if (!mission.alerts.some((alert) => alert.id === id)) {
      mission.alerts.push({ id, type, createdAt: context.clock.now(), reason, aircraftId: mission.aircraftId });
      changed = true;
    }
  }
  if (sample.landed === true && age < thresholds.staleAfterMs && mission.status.toLowerCase() === "active") {
    mission.status = "Completed";
    mission.reservation = undefined;
    changed = true;
  }
  return changed;
}

function routeDeviationMeters(sample: TelemetryObservation, mission: MissionRecordState): number {
  const revision = mission.revisions.find((item) => item.id === mission.currentRevisionId);
  const points = revision?.waypoints ?? [];
  if (points.length < 2) return 0;
  let minimum = Infinity;
  for (let index = 1; index < points.length; index++) minimum = Math.min(minimum, pointToSegmentMeters(sample.position, points[index - 1], points[index]));
  return minimum;
}

function pointToSegmentMeters(point: { latitude: number; longitude: number }, start: { latitude: number; longitude: number }, end: { latitude: number; longitude: number }): number {
  const latitude = point.latitude * Math.PI / 180;
  const scale = 111_320;
  const px = point.longitude * Math.cos(latitude) * scale;
  const py = point.latitude * scale;
  const ax = start.longitude * Math.cos(latitude) * scale;
  const ay = start.latitude * scale;
  const bx = end.longitude * Math.cos(latitude) * scale;
  const by = end.latitude * scale;
  const dx = bx - ax; const dy = by - ay;
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

async function createCommand(context: AppContext, mission: MissionRecordState, kind: "manual_mode" | "safe_action", payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const commandId = randomUUID();
  const createdAt = context.clock.now();
  if (!validInstant(createdAt) || !mission.currentRevisionId || !mission.aircraftId) throw domainError("invalid_context", "A valid clock, revision, and aircraft are required.", "missionId");
  const command: AircraftCommand = { commandId, missionId: mission.id, aircraftId: mission.aircraftId, kind, payload };
  const record: CommandRecord = { id: commandId, missionId: mission.id, aircraftId: mission.aircraftId, revisionId: mission.currentRevisionId, kind, outcome: "requested", createdAt, updatedAt: createdAt, payload, events: [{ outcome: "requested", occurredAt: createdAt }] };
  mission.commands = [...(mission.commands ?? []), record];
  await context.records.saveMission(mission);
  try { await context.aircraft.send(command); }
  catch { await updateCommand(context, mission.id, commandId, "unknown", context.clock.now(), "send outcome is uncertain"); }
  const saved = await context.records.getMission(mission.id);
  const savedCommand = saved?.commands?.find((item) => item.id === commandId) ?? record;
  return { missionId: mission.id, aircraftId: mission.aircraftId, commandId, kind, outcome: savedCommand.outcome, directControlEnabled: false };
}

async function findCommandMission(context: AppContext, commandId: string): Promise<MissionRecordState> {
  const mission = (await context.records.listMissions()).find((item) => item.commands?.some((command) => command.id === commandId));
  if (!mission) throw domainError("unknown_command", "Command was not found.", "commandId");
  if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Command belongs to another operator.", "commandId");
  return mission;
}

async function applyCommandStatus(context: AppContext, mission: MissionRecordState, command: CommandRecord, status: Record<string, unknown>, outcome: "accepted" | "rejected" | undefined, observedAt: string): Promise<Record<string, unknown>> {
  let startCommand: AircraftCommand | undefined;
  let existingStartCommand: CommandRecord | undefined;
  let result: Record<string, unknown> = {};
  await context.records.transaction(async () => {
    const latest = await context.records.getMission(mission.id);
    const current = latest?.commands?.find((item) => item.id === command.id);
    if (!latest || !current) throw domainError("unknown_command", "Command was not found.", "commandId");
    const newlyAccepted = outcome === "accepted" && current.outcome !== "accepted";
    applyCommandOutcome(current, outcome, observedAt);
    if (["upload", "start"].includes(current.kind) && typeof status.execution === "string") await applyExecutionStatus(context, latest, current, status.execution, observedAt);
    else if (outcome === "rejected" && ["upload", "start"].includes(current.kind)) await applyExecutionStatus(context, latest, current, "not_executing", observedAt);
    if (status.landed === true && latest.status.toLowerCase() === "active") { latest.status = "Completed"; latest.reservation = undefined; }
    if (current.kind === "upload" && newlyAccepted && status.execution === undefined) startCommand = await stageStart(context, latest, current, observedAt);
    else if (current.kind === "upload" && outcome === "accepted" && status.execution === undefined) {
      existingStartCommand = latest.commands?.find((item) => item.id === latest.reservation?.commandId && item.kind === "start" && item.revisionId === current.revisionId);
    }
    await context.records.saveMission(latest);
    result = { missionId: latest.id, aircraftId: current.aircraftId, commandId: current.id, outcome: current.outcome, status: latest.status };
  });
  if (existingStartCommand) result = { ...result, startCommandId: existingStartCommand.id, startOutcome: existingStartCommand.outcome };
  if (startCommand) result = { ...result, ...await sendStagedStart(context, startCommand) };
  return result;
}

function applyCommandOutcome(command: CommandRecord, outcome: "accepted" | "rejected" | undefined, observedAt: string): void {
  if (!outcome) return;
  if (command.outcome !== "requested" && command.outcome !== "unknown" && command.outcome !== outcome) throw domainError("command_outcome_conflict", "Command already has a conflicting confirmed outcome.", "status.outcome");
  if (command.outcome === outcome) return;
  command.outcome = outcome; command.updatedAt = observedAt;
  command.events ??= [{ outcome: "requested", occurredAt: command.createdAt }];
  if (!command.events.some((event) => event.outcome === outcome && event.occurredAt === observedAt)) command.events.push({ outcome, occurredAt: observedAt });
}

async function applyExecutionStatus(context: AppContext, mission: MissionRecordState, command: CommandRecord, execution: string, at: string): Promise<void> {
  if (execution === "executing") { mission.status = "Active"; return; }
  const current = await startPrerequisitesCurrent(context, mission, command.revisionId, at);
  invalidateConfirmation(mission, command.revisionId, at, "Aircraft confirmed non-execution; renewed preflight is required.");
  mission.status = current ? "Ready" : "Draft";
  mission.reservation = undefined;
}

async function stageStart(context: AppContext, mission: MissionRecordState, upload: CommandRecord, at: string): Promise<AircraftCommand | undefined> {
  const current = await startPrerequisitesCurrent(context, mission, upload.revisionId, at);
  if (!current || mission.currentRevisionId !== upload.revisionId || mission.status.toLowerCase() !== "uploading") {
    invalidateConfirmation(mission, upload.revisionId, at, "Upload recheck failed; revalidate and confirm preflight again.");
    mission.status = "Draft"; mission.reservation = undefined;
    addAlert(mission, "upload_recheck_blocked", at, "Current validation, preflight, or evidence did not pass the upload recheck.");
    return undefined;
  }
  const commandId = randomUUID();
  const command: AircraftCommand = { commandId, missionId: mission.id, aircraftId: upload.aircraftId, kind: "start", payload: { revisionId: upload.revisionId } };
  mission.commands = [...(mission.commands ?? []), { id: commandId, missionId: mission.id, aircraftId: upload.aircraftId, revisionId: upload.revisionId, kind: "start", outcome: "requested", createdAt: at, updatedAt: at, payload: command.payload, events: [{ outcome: "requested", occurredAt: at }] }];
  mission.reservation = { aircraftId: upload.aircraftId, commandId };
  return command;
}

async function sendStagedStart(context: AppContext, command: AircraftCommand): Promise<Record<string, unknown>> {
  try { await context.aircraft.send(command); }
  catch { await updateCommand(context, command.missionId, command.commandId, "unknown", context.clock.now(), "start send outcome is uncertain; no automatic retry"); }
  const mission = await context.records.getMission(command.missionId);
  const record = mission?.commands?.find((item) => item.id === command.commandId);
  return { startCommandId: command.commandId, startOutcome: record?.outcome ?? "unknown", status: mission?.status };
}

function invalidateConfirmation(mission: MissionRecordState, revisionId: string, at: string, reason: string): void {
  for (const confirmation of mission.confirmations ?? []) {
    if (confirmation.revisionId === revisionId && !confirmation.invalidatedAt) {
      confirmation.invalidatedAt = at; confirmation.invalidationReason = reason;
    }
  }
}

function addAlert(mission: MissionRecordState, type: string, at: string, reason: string): void {
  mission.alerts ??= [];
  const id = `${type}:${at}`;
  if (!mission.alerts.some((item) => item.id === id)) mission.alerts.push({ id, type, createdAt: at, reason, aircraftId: mission.aircraftId });
}

async function startPrerequisitesCurrent(context: AppContext, mission: MissionRecordState, revisionId: string, now: string): Promise<boolean> {
  if (mission.currentRevisionId !== revisionId) return false;
  const validation = mission.validations?.filter((item) => item.revisionId === revisionId).at(-1);
  if (!validation || validation.status !== "Ready" || validation.findings.some((item) => item.status === "block")) return false;
  if (!mission.confirmations?.some((item) => item.revisionId === revisionId && item.validationId === validation.id && !item.invalidatedAt)) return false;
  const revision = mission.revisions.find((item) => item.id === revisionId);
  const configuration = revision && await context.records.getConfiguration(revision.configurationId);
  const inputs = await context.records.getValidationInputs(mission.id, revisionId);
  const references = collectVersionIds(configuration?.sourceDate, inputs);
  return sameReferences(validation.inputVersionIds, references) && evidenceIsCurrent(configuration?.sourceValidUntil, inputs, now);
}

function collectVersionIds(sourceDate: string | undefined, inputs: ValidationInputs | undefined): string[] {
  return [...new Set([inputs?.versionId, inputs?.policy?.versionId, inputs?.airspace?.versionId, inputs?.authorization?.versionId, sourceDate].filter((value): value is string => Boolean(value)))];
}

function sameReferences(left: string[], right: string[]): boolean {
  const first = [...left].sort(); const second = [...right].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function evidenceIsCurrent(sourceValidUntil: string | undefined, inputs: ValidationInputs | undefined, now: string): boolean {
  const instant = Date.parse(now); const source = Date.parse(inputs?.airspace?.sourceDate ?? "");
  const maxAge = inputs?.policy?.maxAirspaceAgeMs;
  const expiries = [sourceValidUntil, inputs?.airspace?.validUntil, inputs?.authorization?.validUntil].filter((value): value is string => value !== undefined).map(Date.parse);
  return Number.isFinite(instant) && Number.isFinite(source) && source <= instant && Number.isFinite(maxAge) && maxAge! > 0 && instant - source <= maxAge! &&
    expiries.length > 0 && expiries.every((expiry) => Number.isFinite(expiry) && expiry >= instant);
}

async function updateCommand(context: AppContext, missionId: string, commandId: string, outcome: CommandRecord["outcome"], at: string, detail: string): Promise<void> {
  await context.records.transaction(async () => {
    const mission = await context.records.getMission(missionId);
    const command = mission?.commands?.find((item) => item.id === commandId);
    if (!mission || !command || command.outcome !== "requested") return;
    command.outcome = outcome; command.updatedAt = at;
    command.events ??= [{ outcome: "requested", occurredAt: command.createdAt }];
    command.events.push({ outcome, occurredAt: at, detail });
    await context.records.saveMission(mission);
  });
}

async function markExpiredCommands(context: AppContext, mission: MissionRecordState, timeoutMs: number): Promise<MissionRecordState> {
  const now = Date.parse(context.clock.now());
  if (!Number.isFinite(now)) throw domainError("invalid_clock", "Clock must provide a valid UTC instant.", "clock");
  let changed = false;
  for (const command of mission.commands ?? []) {
    if (command.outcome !== "requested" || now - Date.parse(command.createdAt) < timeoutMs) continue;
    command.outcome = "unknown"; command.updatedAt = context.clock.now();
    command.events ??= [{ outcome: "requested", occurredAt: command.createdAt }];
    command.events.push({ outcome: "unknown", occurredAt: command.updatedAt, detail: "acknowledgement timed out; no automatic retry" });
    changed = true;
  }
  if (changed) await context.records.saveMission(mission);
  return mission;
}

function isFreshManual(sample: TelemetryObservation, ageMs: number, thresholds: ReturnType<typeof getThresholds>): boolean {
  return ageMs >= 0 && ageMs < thresholds.staleAfterMs && sample.mode.toLowerCase() === "manual";
}

function observationAge(now: string, observedAt: string): number {
  const current = Date.parse(now); const observed = Date.parse(observedAt);
  if (!Number.isFinite(current) || !Number.isFinite(observed)) return Infinity;
  return current - observed;
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }

function domainError(code: string, message: string, field: string): Error & { code: string; field: string } {
  return Object.assign(new Error(message), { name: "AircraftError", code, field });
}
