import type { AppContext, MissionRecordRequest } from "../contracts.ts";
import { notImplemented } from "../stub.ts";

export async function getMissionRecord(_context: AppContext, _request: MissionRecordRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}
