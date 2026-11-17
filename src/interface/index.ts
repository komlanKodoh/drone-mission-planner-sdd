import type { AppContext, InterfaceRequest, InterfaceState, MissionRecordState } from "../contracts.ts";
import { getMissionRecord } from "../records/index.ts";

const views = new Set(["planner", "supervision", "record"]);

export async function renderMissionView(context: AppContext, request: InterfaceRequest): Promise<InterfaceState> {
  if (!views.has(request.view)) throw domainError("unknown_view", "Mission view was not found.", "view");
  const mission = await context.records.getMission(request.missionId);
  if (!mission) throw domainError("unknown_mission", "Mission was not found.", "missionId");
  if (mission.operatorId !== context.operatorId) throw domainError("operator_mismatch", "Mission belongs to another operator.", "missionId");
  const revision = mission.revisions.find((item) => item.id === mission.currentRevisionId);
  const inputs = revision && await context.records.getValidationInputs(mission.id, revision.id);
  const record = await getMissionRecord(context, { missionId: mission.id });
  const age = mission.telemetry ? Date.parse(context.clock.now()) - Date.parse(mission.telemetry.observedAt) : null;
  const status = authorizationStatus(mission, inputs?.authorization?.status, inputs?.airspace?.authorizationRequired);
  const thresholds = context.aircraft.thresholds;
  const telemetryState = telemetryCondition(age, thresholds?.staleAfterMs, thresholds?.lostLinkAfterMs);
  const commands = mission.commands ?? [];
  const state = {
    missionId: mission.id, view: request.view, plannerStatus: mission.status,
    externalAuthorization: status, externalAuthorizationStatus: status,
    telemetry: mission.telemetry, observationAgeMs: age, telemetryState,
    alerts: mission.alerts ?? [],
    pendingCommands: commands.filter((command) => command.outcome === "requested"),
    uncertainCommands: commands.filter((command) => command.outcome === "unknown"),
    missionRecord: record,
  };
  return state;
}

function authorizationStatus(mission: MissionRecordState, evidence: string | undefined, required: boolean | undefined): string {
  if (evidence) return evidence;
  if (required === false || mission.validations?.some((item) => item.revisionId === mission.currentRevisionId && item.findings.some((finding) => finding.code === "authorization_not_required"))) return "not_required";
  return "not_provided";
}

function telemetryCondition(age: number | null, staleAfterMs: number | undefined, lostLinkAfterMs: number | undefined): InterfaceState["telemetryState"] {
  if (age === null || !Number.isFinite(age)) return "unavailable";
  if (!staleAfterMs || !lostLinkAfterMs || staleAfterMs <= 0 || staleAfterMs >= lostLinkAfterMs) return "unconfigured";
  if (age >= lostLinkAfterMs) return "lost_link";
  return age >= staleAfterMs ? "stale" : "fresh";
}

function domainError(code: string, message: string, field: string): Error & { code: string; field: string } {
  return Object.assign(new Error(message), { name: "InterfaceError", code, field });
}
