import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import type {
  ConfigurationRecord,
  MissionId,
  MissionRecordState,
  RecordsPort,
  ValidationInputs,
} from "../contracts.ts";

export interface SQLiteRecordsOptions {
  databasePath: string;
  configurations: ConfigurationRecord[];
  validationInputs?: Record<string, ValidationInputs>;
}

interface StoredRow {
  data: string;
}

export class SQLiteRecords implements RecordsPort {
  private readonly database: DatabaseSync;
  private transactionTail: Promise<void> = Promise.resolve();
  private readonly transactionContext = new AsyncLocalStorage<boolean>();

  constructor(options: SQLiteRecordsOptions) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS configurations (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS validation_inputs (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
    this.seedConfigurations(options.configurations);
    this.seedValidationInputs(options.validationInputs ?? {});
  }

  async listConfigurations(): Promise<ConfigurationRecord[]> {
    return this.withAccess(() => this.database.prepare("SELECT data FROM configurations ORDER BY id")
      .all().map((row) => copyConfiguration(JSON.parse((row as StoredRow).data))));
  }

  async getConfiguration(configurationId: string): Promise<ConfigurationRecord | undefined> {
    return this.withAccess(() => {
      const row = this.database.prepare("SELECT data FROM configurations WHERE id = ?").get(configurationId) as StoredRow | undefined;
      return row && copyConfiguration(JSON.parse(row.data));
    });
  }

  async getMission(missionId: MissionId): Promise<MissionRecordState | undefined> {
    return this.withAccess(() => {
      const row = this.database.prepare("SELECT data FROM missions WHERE id = ?").get(missionId) as StoredRow | undefined;
      return row && copyMission(JSON.parse(row.data));
    });
  }

  async listMissions(): Promise<MissionRecordState[]> {
    return this.withAccess(() => this.database.prepare("SELECT data FROM missions ORDER BY id")
      .all().map((row) => copyMission(JSON.parse((row as StoredRow).data))));
  }

  async saveMission(mission: MissionRecordState): Promise<void> {
    await this.withAccess(() => {
      this.database.prepare("INSERT INTO missions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
        .run(mission.id, JSON.stringify(copyMission(mission)));
    });
  }

  async getValidationInputs(missionId: MissionId, revisionId: string): Promise<ValidationInputs | undefined> {
    return this.withAccess(() => {
      const row = this.database.prepare("SELECT data FROM validation_inputs WHERE id = ?")
        .get(`${missionId}:${revisionId}`) as StoredRow | undefined;
      return row && structuredClone(JSON.parse(row.data) as ValidationInputs);
    });
  }

  async transaction(work: () => Promise<unknown>): Promise<unknown> {
    if (this.transactionContext.getStore()) return work();
    return this.serializeTransaction(work);
  }

  close(): void {
    this.database.close();
  }

  private seedConfigurations(configurations: ConfigurationRecord[]): void {
    const statement = this.database.prepare("INSERT INTO configurations (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data");
    for (const configuration of configurations) {
      statement.run(configuration.id, JSON.stringify(copyConfiguration(configuration)));
    }
  }

  private seedValidationInputs(inputs: Record<string, ValidationInputs>): void {
    const statement = this.database.prepare("INSERT INTO validation_inputs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data");
    for (const [id, value] of Object.entries(inputs)) statement.run(id, JSON.stringify(value));
  }

  private async withAccess<T>(work: () => T): Promise<T> {
    if (this.transactionContext.getStore()) return work();
    await this.transactionTail;
    return work();
  }

  private async serializeTransaction(work: () => Promise<unknown>): Promise<unknown> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const result = await this.transactionContext.run(true, work);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* No transaction remained open. */ }
      throw error;
    } finally {
      release();
    }
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
