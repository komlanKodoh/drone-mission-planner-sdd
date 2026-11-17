import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppContext, ConfigurationSelection, ManualModeRequest, PreflightRequest, ReconcileRequest, RecommendationRequest, SafeActionRequest, SaveRevisionRequest, StartRequest, TelemetryRequest, ValidationRequest } from "./contracts.ts";
import { getTelemetry, reconcileCommand, requestManualMode, requestSafeAction } from "./aircraft/index.ts";
import { recommendConfigurations, selectConfiguration } from "./equipment/index.ts";
import { confirmPreflight, saveRevision, startMission } from "./missions/index.ts";
import { validateMission } from "./validation/index.ts";
import { getMissionRecord } from "./records/index.ts";

interface Route { method: string; path: RegExp; requirement: string; contract: string }
interface HttpError extends Error { code?: string; field?: string }

const routes: Route[] = [
  { method: "POST", path: /^\/api\/recommendations$/, requirement: "FR-001", contract: "Equipment.recommendConfigurations" },
  { method: "PUT", path: /^\/api\/missions\/[^/]+\/configuration$/, requirement: "FR-002", contract: "Equipment.selectConfiguration" },
  { method: "PUT", path: /^\/api\/missions\/[^/]+\/revisions$/, requirement: "FR-003", contract: "Missions.saveRevision" },
  { method: "POST", path: /^\/api\/missions\/[^/]+\/validations$/, requirement: "FR-004", contract: "Validation.validateMission" },
  { method: "POST", path: /^\/api\/missions\/[^/]+\/preflight$/, requirement: "FR-005", contract: "Missions.confirmPreflight" },
  { method: "POST", path: /^\/api\/missions\/[^/]+\/start$/, requirement: "FR-006", contract: "Missions.startMission" },
  { method: "GET", path: /^\/api\/missions\/[^/]+\/telemetry$/, requirement: "FR-007", contract: "Aircraft.getTelemetry" },
  { method: "POST", path: /^\/api\/missions\/[^/]+\/manual-mode$/, requirement: "FR-008", contract: "Aircraft.requestManualMode" },
  { method: "POST", path: /^\/api\/commands\/[^/]+\/reconcile$/, requirement: "FR-009", contract: "Aircraft.reconcileCommand" },
  { method: "POST", path: /^\/api\/missions\/[^/]+\/safe-actions$/, requirement: "FR-010", contract: "Aircraft.requestSafeAction" },
  { method: "GET", path: /^\/api\/missions\/[^/]+\/record$/, requirement: "FR-011", contract: "Records.getMissionRecord" },
];

function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function resolveRequest(method: string, pathname: string): { status: number; body: object } {
  const route = routes.find((candidate) => candidate.method === method && candidate.path.test(pathname));
  if (!route) return { status: 404, body: { error: "not_found", message: "No route matches this request." } };
  return {
    status: 501,
    body: {
      error: "not_implemented",
      message: `${route.requirement} is mapped to ${route.contract}; implementation is pending.`,
    },
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, context?: AppContext): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  if (context && isImplementedRoute(method, url.pathname)) {
    try { return await handleImplemented(method, url.pathname, url.searchParams, request, response, context); }
    catch (error) { return respondError(response, error); }
  }
  const result = resolveRequest(method, url.pathname);
  respond(response, result.status, result.body);
}

function isImplementedRoute(method: string, pathname: string): boolean {
  if (method === "GET" && /^\/api\/missions\/[^/]+\/(?:telemetry|record)$/.test(pathname)) return true;
  if (method === "POST" && (/^\/api\/missions\/[^/]+\/(?:start|manual-mode|safe-actions)$/.test(pathname) || /^\/api\/commands\/[^/]+\/reconcile$/.test(pathname))) return true;
  return (method === "POST" && (pathname === "/api/recommendations" || /^\/api\/missions\/[^/]+\/(?:validations|preflight)$/.test(pathname))) ||
    (method === "PUT" && /^\/api\/missions\/[^/]+\/(?:configuration|revisions)$/.test(pathname));
}

async function handleImplemented(method: string, pathname: string, query: URLSearchParams, request: IncomingMessage, response: ServerResponse, context: AppContext): Promise<void> {
  if (method === "GET") return handleTelemetry(pathname, query, response, context);
  const body = await readJson(request);
  if (method === "POST") {
    const dispatched = await handlePost(pathname, body, response, context);
    if (dispatched) return;
    return respond(response, 404, { error: "not_found", message: "No route matches this request." });
  }
  return handlePut(pathname, body, response, context);
}

async function handlePost(pathname: string, body: unknown, response: ServerResponse, context: AppContext): Promise<boolean> {
  const startMatch = pathname.match(/^\/api\/missions\/([^/]+)\/start$/);
  if (startMatch) return sendResult(response, await startMission(context, { ...(body as StartRequest), missionId: decodeURIComponent(startMatch[1]) }));
  const manualMatch = pathname.match(/^\/api\/missions\/([^/]+)\/manual-mode$/);
  if (manualMatch) return sendResult(response, await requestManualMode(context, { ...(body as ManualModeRequest), missionId: decodeURIComponent(manualMatch[1]) }));
  const safeMatch = pathname.match(/^\/api\/missions\/([^/]+)\/safe-actions$/);
  if (safeMatch) return sendResult(response, await requestSafeAction(context, { ...(body as SafeActionRequest), missionId: decodeURIComponent(safeMatch[1]) }));
  const commandMatch = pathname.match(/^\/api\/commands\/([^/]+)\/reconcile$/);
  if (commandMatch) return sendResult(response, await reconcileCommand(context, { ...(body as ReconcileRequest), commandId: decodeURIComponent(commandMatch[1]) }));
    if (pathname === "/api/recommendations") {
      const result = await recommendConfigurations(context, body as RecommendationRequest);
      return sendResult(response, result);
    }
    const validationMatch = pathname.match(/^\/api\/missions\/([^/]+)\/validations$/);
    if (validationMatch) {
      const validation: ValidationRequest = { ...(body as ValidationRequest), missionId: decodeURIComponent(validationMatch[1]) };
      return sendResult(response, await validateMission(context, validation));
    }
    const preflightMatch = pathname.match(/^\/api\/missions\/([^/]+)\/preflight$/);
    if (preflightMatch) {
      const preflight: PreflightRequest = { ...(body as PreflightRequest), missionId: decodeURIComponent(preflightMatch[1]) };
      return sendResult(response, await confirmPreflight(context, preflight));
    }
  return false;
}

async function handleTelemetry(pathname: string, query: URLSearchParams, response: ServerResponse, context: AppContext): Promise<void> {
  const recordMatch = pathname.match(/^\/api\/missions\/([^/]+)\/record$/);
  if (recordMatch) {
    return sendResult(response, await getMissionRecord(context, { missionId: decodeURIComponent(recordMatch[1]) }));
  }
  const match = pathname.match(/^\/api\/missions\/([^/]+)\/telemetry$/);
  if (!match) return respond(response, 404, { error: "not_found", message: "No route matches this request." });
  const aircraftId = query.get("aircraftId");
  if (!aircraftId) throw clientError("missing_aircraft_id", "Query parameter aircraftId is required.");
  const telemetry: TelemetryRequest = { missionId: decodeURIComponent(match[1]), aircraftId };
  sendResult(response, await getTelemetry(context, telemetry));
}

async function handlePut(pathname: string, body: unknown, response: ServerResponse, context: AppContext): Promise<void> {
  const revisionMatch = pathname.match(/^\/api\/missions\/([^/]+)\/revisions$/);
  if (revisionMatch) {
    const missionId = decodeURIComponent(revisionMatch[1]);
    const revision: SaveRevisionRequest = { ...(body as SaveRevisionRequest), missionId };
    return sendResult(response, await saveRevision(context, revision));
  }
  const match = pathname.match(/^\/api\/missions\/([^/]+)\/configuration$/);
  if (!match) return respond(response, 404, { error: "not_found", message: "No route matches this request." });
  const missionId = decodeURIComponent(match[1]);
  const selection: ConfigurationSelection = { ...(body as ConfigurationSelection), missionId };
  sendResult(response, await selectConfiguration(context, selection));
}

function sendResult(response: ServerResponse, result: Record<string, unknown>): boolean {
  respond(response, 200, result);
  return true;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw clientError("invalid_body", "Request body must be a JSON object.");
    return parsed;
  } catch (error) {
    if ((error as HttpError).code) throw error;
    throw clientError("invalid_json", "Request body must contain valid JSON.");
  }
}

function respondError(response: ServerResponse, error: unknown): void {
  const failure = error instanceof Error ? error as HttpError : new Error("Unexpected server error.");
  const status = statusFor(failure);
  respond(response, status, {
    error: failure.code ?? (failure.name === "NotImplementedError" ? "not_implemented" : "internal_error"),
    message: status === 500 ? "The request could not be completed." : failure.message,
    ...(failure.field ? { field: failure.field } : {}),
  });
}

function statusFor(error: HttpError): number {
  if (error.name === "NotImplementedError") return 501;
  if (error.code?.startsWith("invalid_") || error.code?.startsWith("missing_")) return 422;
  if (["waypoints_required", "coordinate_out_of_range", "altitude_out_of_range", "speed_out_of_range", "unsupported_task", "unsupported_action", "configuration_ineligible"].includes(error.code ?? "")) return 422;
  if (error.code === "unknown_mission" || error.code === "unknown_configuration") return 404;
  if (error.code === "operator_mismatch") return 403;
  if (error.code) return 409;
  return 500;
}

function clientError(code: string, message: string): HttpError {
  return Object.assign(new Error(message), { name: "RequestError", code });
}

export function createServer(context?: AppContext): Server {
  return createHttpServer((request, response) => { void handle(request, response, context); });
}

if (process.argv[1]?.endsWith("/src/server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Drone Mission Planner skeleton listening at http://127.0.0.1:${port}`);
  });
}
