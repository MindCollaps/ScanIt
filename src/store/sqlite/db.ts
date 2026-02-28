import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { JobState, ScanJob } from '../../shared/types/domain.js';

export interface JobRecordInput {
  id: string;
  profileId: string;
  scannerId: string;
  presetId: string;
  state: JobState;
}

/**
 * SQLite operational data store for scan jobs.
 */
export class SqliteStore {
  private readonly db: Database;

  public constructor(dbFilePath: string) {
    mkdirSync(dirname(dbFilePath), { recursive: true });
    this.db = new Database(dbFilePath, { create: true });
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        scanner_id TEXT NOT NULL,
        preset_id TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  public createJob(input: JobRecordInput): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO jobs (id, profile_id, scanner_id, preset_id, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    statement.run(input.id, input.profileId, input.scannerId, input.presetId, input.state, now);
  }

  public updateJobState(
    id: string,
    state: JobState,
    metadata?: { startedAt?: string; finishedAt?: string; errorCode?: string; errorMessage?: string },
  ): void {
    const statement = this.db.prepare(`
      UPDATE jobs
      SET
        state = @state,
        started_at = COALESCE(@startedAt, started_at),
        finished_at = COALESCE(@finishedAt, finished_at),
        error_code = COALESCE(@errorCode, error_code),
        error_message = COALESCE(@errorMessage, error_message)
      WHERE id = @id
    `);

    statement.run({
      id,
      state,
      startedAt: metadata?.startedAt ?? null,
      finishedAt: metadata?.finishedAt ?? null,
      errorCode: metadata?.errorCode ?? null,
      errorMessage: metadata?.errorMessage ?? null,
    });
  }

  public addJobEvent(jobId: string, eventType: string, payload: object): void {
    const statement = this.db.prepare(`
      INSERT INTO job_events (job_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `);

    statement.run(jobId, eventType, JSON.stringify(payload), new Date().toISOString());
  }

  public getJob(jobId: string): ScanJob | undefined {
    const statement = this.db.prepare(`
      SELECT id, profile_id, scanner_id, preset_id, state, created_at, started_at, finished_at, error_code, error_message
      FROM jobs
      WHERE id = ?
    `);

    const row = statement.get(jobId) as
      | {
          id: string;
          profile_id: string;
          scanner_id: string;
          preset_id: string;
          state: JobState;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          error_code: string | null;
          error_message: string | null;
        }
      | null;

    if (!row) {
      return undefined;
    }

    const job: ScanJob = {
      id: row.id,
      profileId: row.profile_id,
      scannerId: row.scanner_id,
      presetId: row.preset_id,
      state: row.state,
      createdAt: row.created_at,
    };

    if (row.started_at !== null) {
      job.startedAt = row.started_at;
    }
    if (row.finished_at !== null) {
      job.finishedAt = row.finished_at;
    }
    if (row.error_code !== null) {
      job.errorCode = row.error_code;
    }
    if (row.error_message !== null) {
      job.errorMessage = row.error_message;
    }

    return job;
  }

  public listJobs(limit: number): ScanJob[] {
    const statement = this.db.prepare(`
      SELECT id, profile_id, scanner_id, preset_id, state, created_at, started_at, finished_at, error_code, error_message
      FROM jobs
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = statement.all(limit) as Array<{
      id: string;
      profile_id: string;
      scanner_id: string;
      preset_id: string;
      state: JobState;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      error_code: string | null;
      error_message: string | null;
    }>;

    return rows.map((row) => {
      const job: ScanJob = {
        id: row.id,
        profileId: row.profile_id,
        scannerId: row.scanner_id,
        presetId: row.preset_id,
        state: row.state,
        createdAt: row.created_at,
      };

      if (row.started_at !== null) {
        job.startedAt = row.started_at;
      }
      if (row.finished_at !== null) {
        job.finishedAt = row.finished_at;
      }
      if (row.error_code !== null) {
        job.errorCode = row.error_code;
      }
      if (row.error_message !== null) {
        job.errorMessage = row.error_message;
      }

      return job;
    });
  }
}
