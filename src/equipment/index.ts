import type { AppContext, ConfigurationSelection, RecommendationRequest } from "../contracts.ts";
import { notImplemented } from "../stub.ts";

export async function recommendConfigurations(_context: AppContext, _request: RecommendationRequest): Promise<Record<string, unknown>> {
  return notImplemented();
}

export async function selectConfiguration(_context: AppContext, _request: ConfigurationSelection): Promise<Record<string, unknown>> {
  return notImplemented();
}
