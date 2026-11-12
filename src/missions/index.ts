import type { AppContext, PreflightRequest, SaveRevisionRequest, StartRequest } from "../contracts.ts";
import { notImplemented } from "../stub.ts";

export async function saveRevision(_context: AppContext, _request: SaveRevisionRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function confirmPreflight(_context: AppContext, _request: PreflightRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function startMission(_context: AppContext, _request: StartRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}
