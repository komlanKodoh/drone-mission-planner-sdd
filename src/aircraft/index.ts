import type { AppContext, ManualModeRequest, ReconcileRequest, SafeActionRequest, TelemetryRequest } from "../contracts.ts";
import { notImplemented } from "../stub.ts";

export async function getTelemetry(_context: AppContext, _request: TelemetryRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function requestManualMode(_context: AppContext, _request: ManualModeRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function reconcileCommand(_context: AppContext, _request: ReconcileRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function requestSafeAction(_context: AppContext, _request: SafeActionRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}
