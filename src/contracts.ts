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
  listConfigurations(): Promise<ConfigurationRecord[]>;
  getConfiguration(configurationId: ConfigurationId): Promise<ConfigurationRecord | undefined>;
  getMission(missionId: MissionId): Promise<MissionRecordState | undefined>;
  listMissions(): Promise<MissionRecordState[]>;
  saveMission(mission: MissionRecordState): Promise<void>;
  getValidationInputs(missionId: MissionId, revisionId: RevisionId): Promise<ValidationInputs | undefined>;
}

export interface ValidationInputs {
  versionId: string;
  routeDistanceKm?: number;
  policy?: { versionId: string; reserveFraction: number; maxAirspaceAgeMs: number };
  airspace?: {
    versionId: string;
    sourceDate: Instant;
    validUntil: Instant;
    coversWholeRoute: boolean;
    minAltitudeAglMeters?: number;
    maxAltitudeAglMeters?: number;
    startsAt: Instant;
    endsAt: Instant;
    authorizationRequired: boolean;
  };
  authorization?: {
    versionId: string;
    status: "approved" | "denied" | "pending";
    coversWholeRoute: boolean;
    minAltitudeAglMeters?: number;
    maxAltitudeAglMeters?: number;
    validFrom: Instant;
    validUntil: Instant;
  };
}

export interface ConfigurationRecord {
  id: ConfigurationId;
  maxPayloadMassKg: number;
  maxRouteDistanceKm: number;
  maxFlightDurationMinutes: number;
  compatibility: "compatible" | "incompatible" | "unknown";
  supplierReferences: string[];
  sourceDate: Instant;
  sourceValidUntil: Instant;
  maxAltitudeAglMeters?: number;
  maxSpeedMetersPerSecond?: number;
  supportedTasks?: string[];
  supportedSafeActions?: string[];
}

export interface MissionRecordState {
  id: MissionId;
  operatorId: OperatorId;
  status: string;
  needs?: MissionNeeds;
  configurationId?: ConfigurationId;
  currentRevisionId?: RevisionId;
  aircraftId?: AircraftId;
  reservation?: { aircraftId: AircraftId; commandId: CommandId };
  revisions: Array<{
    id: RevisionId;
    configurationId: ConfigurationId;
    createdAt: Instant;
    operatorId: OperatorId;
    startsAt?: Instant;
    endsAt?: Instant;
    waypoints?: Array<{
      order: number;
      latitude: number;
      longitude: number;
      altitudeAglMeters: number;
      speedMetersPerSecond: number;
      task: string;
    }>;
  }>;
  validations?: Array<{
    id: string;
    revisionId: RevisionId;
    status: "Ready" | "Draft";
    findings: Array<{ code: string; status: "pass" | "block" | "not_required"; message: string }>;
    inputVersionIds: string[];
    createdAt: Instant;
    operatorId: OperatorId;
  }>;
  confirmations?: Array<{
    id: string;
    revisionId: RevisionId;
    validationId: string;
    inputVersionIds: string[];
    confirmedAt: Instant;
    operatorId: OperatorId;
    invalidatedAt?: Instant;
    invalidationReason?: string;
  }>;
  commands?: Array<CommandRecord>;
  telemetry?: TelemetryObservation;
  alerts?: Array<{ id: string; type: string; createdAt: Instant; reason: string; aircraftId?: AircraftId }>;
}

export interface CommandRecord {
  id: CommandId;
  missionId: MissionId;
  aircraftId: AircraftId;
  revisionId: RevisionId;
  kind: "upload" | "start" | "manual_mode" | "safe_action";
  outcome: "requested" | "accepted" | "rejected" | "unknown";
  createdAt: Instant;
  updatedAt: Instant;
  payload: Record<string, unknown>;
  events?: Array<{ outcome: CommandRecord["outcome"]; occurredAt: Instant; detail?: string }>;
}

export interface AircraftPort {
  readonly send: (command: AircraftCommand) => Promise<void>;
  readonly readTelemetry?: (missionId: MissionId, aircraftId: AircraftId) => Promise<TelemetryObservation | undefined>;
  readonly thresholds?: AircraftThresholds;
}

export interface AircraftThresholds {
  staleAfterMs: number;
  lostLinkAfterMs: number;
  deviationMeters: number;
  lowBatteryPercent: number;
  commandAckTimeoutMs: number;
}

export interface TelemetryObservation {
  missionId: MissionId;
  aircraftId: AircraftId;
  observedAt: Instant;
  position: { latitude: number; longitude: number };
  batteryPercent: number;
  mode: string;
  progress: number;
  landed?: boolean;
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
export interface ConfigurationSelection { missionId: MissionId; configurationId: ConfigurationId; needs: MissionNeeds }
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
export interface InterfaceState {
  missionId: MissionId;
  view: string;
  plannerStatus?: string;
  externalAuthorization?: string;
  externalAuthorizationStatus?: string;
  telemetryState?: "unavailable" | "unconfigured" | "fresh" | "stale" | "lost_link";
  telemetry?: TelemetryObservation;
  observationAgeMs?: number | null;
  alerts?: Array<{ id: string; type: string; createdAt: Instant; reason: string }>;
  pendingCommands?: Array<{ id: CommandId; kind: CommandRecord["kind"]; outcome: CommandRecord["outcome"] }>;
  uncertainCommands?: Array<{ id: CommandId; kind: CommandRecord["kind"]; outcome: CommandRecord["outcome"] }>;
  missionRecord?: Record<string, unknown>;
}
