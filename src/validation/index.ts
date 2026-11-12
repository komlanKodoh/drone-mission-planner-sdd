import type { AppContext, ValidationRequest } from "../contracts.ts";
import { notImplemented } from "../stub.ts";

export async function validateMission(_context: AppContext, _request: ValidationRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}
