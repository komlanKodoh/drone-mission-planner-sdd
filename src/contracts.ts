export type OperatorId = string;
export type MissionId = string;
export type AircraftId = string;
export type ConfigurationId = string;
export type RevisionId = string;
export type CommandId = string;
export type Instant = string;

export interface AppContext {
  clock: { now(): Instant };
  records: RecordsPort;
  aircraft: AircraftPort;
  operatorId: OperatorId;
}

export interface RecordsPort {
  readonly transaction: (work: () => Promise<unknown>) => Promise<unknown>;
}

export interface AircraftPort {
  readonly send: (command: AircraftCommand) => Promise<void>;
}

export interface AircraftCommand {
  commandId: CommandId;
  missionId: MissionId;
  aircraftId: AircraftId;
  kind: string;
  payload: Record<string, unknown>;
}

export interface MissionNeeds {
  payloadMassKg: number;
  routeDistanceKm: number;
  flightDurationMinutes: number;
}

export interface RecommendationRequest { needs: MissionNeeds }
export interface ConfigurationSelection { missionId: MissionId; configurationId: ConfigurationId }
export interface SaveRevisionRequest { missionId: MissionId; waypoints: Record<string, unknown>[]; startsAt: Instant; endsAt: Instant }
export interface ValidationRequest { missionId: MissionId; revisionId: RevisionId }
export interface PreflightRequest { missionId: MissionId; revisionId: RevisionId; validationId: string }
export interface StartRequest { missionId: MissionId; revisionId: RevisionId }
export interface TelemetryRequest { missionId: MissionId; aircraftId: AircraftId }
export interface ManualModeRequest { missionId: MissionId; aircraftId: AircraftId }
export interface ReconcileRequest { commandId: CommandId; aircraftId: AircraftId; status: Record<string, unknown> }
export interface SafeActionRequest { missionId: MissionId; aircraftId: AircraftId; action: string }
export interface MissionRecordRequest { missionId: MissionId }
export interface InterfaceRequest { missionId: MissionId; view: string }
export interface InterfaceState { missionId: MissionId; view: string }
