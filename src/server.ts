import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

interface Route { method: string; path: RegExp; requirement: string; contract: string }

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

function handle(request: IncomingMessage, response: ServerResponse): void {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const result = resolveRequest(request.method ?? "GET", pathname);
  respond(response, result.status, result.body);
}

export function createServer(): Server {
  return createHttpServer(handle);
}

if (process.argv[1]?.endsWith("/src/server.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Drone Mission Planner skeleton listening at http://127.0.0.1:${port}`);
  });
}
