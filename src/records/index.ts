import type {
  AppContext,
  ConfigurationRecord,
  MissionId,
  MissionRecordRequest,
  MissionRecordState,
  RecordsPort,
  ValidationInputs,
} from "../contracts.ts";

export interface MemoryRecordsSeed {
  configurations: ConfigurationRecord[];
  missions?: MissionRecordState[];
  validationInputs?: Record<string, ValidationInputs>;
}

export class MemoryRecords implements RecordsPort {
  private configurations: ConfigurationRecord[];
  private missions: Map<MissionId, MissionRecordState>;
  private validationInputs: Record<string, ValidationInputs>;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(seed: MemoryRecordsSeed) {
    this.configurations = seed.configurations.map(copyConfiguration);
    this.missions = new Map((seed.missions ?? []).map((mission) => [mission.id, copyMission(mission)]));
    this.validationInputs = structuredClone(seed.validationInputs ?? {});
  }

  async listConfigurations(): Promise<ConfigurationRecord[]> {
    return this.configurations.map(copyConfiguration);
  }

  async getConfiguration(configurationId: string): Promise<ConfigurationRecord | undefined> {
    const configuration = this.configurations.find((item) => item.id === configurationId);
    return configuration && copyConfiguration(configuration);
  }

  async getMission(missionId: MissionId): Promise<MissionRecordState | undefined> {
    const mission = this.missions.get(missionId);
    return mission && copyMission(mission);
  }

  async listMissions(): Promise<MissionRecordState[]> {
    return [...this.missions.values()].map(copyMission);
  }

  async saveMission(mission: MissionRecordState): Promise<void> {
    this.missions.set(mission.id, copyMission(mission));
  }

  async getValidationInputs(missionId: MissionId, revisionId: string): Promise<ValidationInputs | undefined> {
    const inputs = this.validationInputs[`${missionId}:${revisionId}`];
    return inputs && structuredClone(inputs);
  }

  async transaction(work: () => Promise<unknown>): Promise<unknown> {
    return this.serializeTransaction(work);
  }

  private async serializeTransaction(work: () => Promise<unknown>): Promise<unknown> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.missions].map(([id, mission]) => [id, copyMission(mission)]));
    try { return await work(); } catch (error) { this.missions = snapshot; throw error; }
    finally { release(); }
  }
}

function copyConfiguration(record: ConfigurationRecord): ConfigurationRecord {
  return {
    ...record,
    supplierReferences: [...record.supplierReferences],
    supportedTasks: record.supportedTasks && [...record.supportedTasks],
  };
}

function copyMission(mission: MissionRecordState): MissionRecordState {
  return {
    ...mission,
    needs: mission.needs && { ...mission.needs },
    revisions: mission.revisions.map((revision) => ({
      ...revision,
      waypoints: revision.waypoints?.map((waypoint) => ({ ...waypoint })),
    })),
    validations: mission.validations?.map((validation) => ({
      ...validation,
      findings: validation.findings.map((finding) => ({ ...finding })),
      inputVersionIds: [...validation.inputVersionIds],
    })),
    confirmations: mission.confirmations?.map((confirmation) => ({
      ...confirmation,
      inputVersionIds: [...confirmation.inputVersionIds],
    })),
    commands: mission.commands?.map((command) => ({ ...command, payload: { ...command.payload } })),
    telemetry: mission.telemetry && { ...mission.telemetry, position: { ...mission.telemetry.position } },
    alerts: mission.alerts?.map((alert) => ({ ...alert })),
  };
}

export async function getMissionRecord(context: AppContext, request: MissionRecordRequest): Promise<Record<string, unknown>> {
  const mission = await context.records.getMission(request.missionId);
  if (!mission) throw new Error(`Unknown mission: ${request.missionId}`);
  return { missionId: request.missionId, mission, revisions: mission.revisions };
}
