import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  JobState,
  JobTrigger,
  ScanJob,
  ScanParams,
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
  UserPreset,
} from '../../shared/types/domain.js';

export interface JobRecordInput {
  id: string;
  scannerId: string;
  presetId: string;
  state: JobState;
  trigger?: JobTrigger | undefined;
}

/**
 * SQLite operational data store for scan jobs, discovered scanners, and user presets.
 */
export class SqliteStore {
  private readonly db: Database;

  public constructor(dbFilePath: string) {
    mkdirSync(dirname(dbFilePath), { recursive: true });
    this.db = new Database(dbFilePath, { create: true });
    this.initialize();
  }

  /** Cleanly close the database connection. */
  public close(): void {
    this.db.close();
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

      CREATE TABLE IF NOT EXISTS discovered_scanners (
        id TEXT PRIMARY KEY,
        device TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        capabilities_json TEXT
      );

      CREATE TABLE IF NOT EXISTS user_presets (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        scanner_id TEXT,
        source TEXT NOT NULL DEFAULT 'Flatbed',
        mode TEXT NOT NULL DEFAULT 'Color',
        resolution_dpi INTEGER NOT NULL DEFAULT 300,
        brightness INTEGER NOT NULL DEFAULT 0,
        contrast INTEGER NOT NULL DEFAULT 0,
        page_size TEXT NOT NULL DEFAULT 'A4',
        output_format TEXT NOT NULL DEFAULT 'pdf',
        image_format TEXT NOT NULL DEFAULT 'jpeg',
        jpeg_quality INTEGER NOT NULL DEFAULT 85,
        combine_pages INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // ─── Migrations ────────────────────────────────────────────
    this.migrate();
  }

  private migrate(): void {
    const addColumnIfMissing = (table: string, column: string, type: string): void => {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      } catch {
        // Column already exists
      }
    };

    addColumnIfMissing('jobs', 'page_order', 'TEXT');
    addColumnIfMissing('jobs', 'scan_params_json', 'TEXT');
    addColumnIfMissing('jobs', 'output_filename', 'TEXT');
    addColumnIfMissing('jobs', 'trigger', 'TEXT');
    addColumnIfMissing('jobs', 'consumers_json', 'TEXT');

    addColumnIfMissing('user_presets', 'consumers_json', 'TEXT');

    // Indexes for common query patterns
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
    `);
  }

  public createJob(input: JobRecordInput): void {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO jobs (id, profile_id, scanner_id, preset_id, state, created_at, trigger)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
      input.id,
      '',
      input.scannerId,
      input.presetId,
      input.state,
      now,
      input.trigger ?? null,
    );
  }

  public updateJobConsumers(jobId: string, consumers: string[]): void {
    this.db
      .prepare('UPDATE jobs SET consumers_json = ? WHERE id = ?')
      .run(JSON.stringify(consumers), jobId);
  }

  public updateJobState(
    id: string,
    state: JobState,
    metadata?: {
      startedAt?: string;
      finishedAt?: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ): void {
    const statement = this.db.prepare(`
      UPDATE jobs
      SET
        state = $state,
        started_at = COALESCE($startedAt, started_at),
        finished_at = COALESCE($finishedAt, finished_at),
        error_code = COALESCE($errorCode, error_code),
        error_message = COALESCE($errorMessage, error_message)
      WHERE id = $id
    `);

    statement.run({
      $id: id,
      $state: state,
      $startedAt: metadata?.startedAt ?? null,
      $finishedAt: metadata?.finishedAt ?? null,
      $errorCode: metadata?.errorCode ?? null,
      $errorMessage: metadata?.errorMessage ?? null,
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
      SELECT id, profile_id, scanner_id, preset_id, state, created_at, started_at, finished_at, error_code, error_message, page_order, scan_params_json, output_filename, trigger, consumers_json
      FROM jobs
      WHERE id = ?
    `);

    const row = statement.get(jobId) as {
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
      page_order: string | null;
      scan_params_json: string | null;
      output_filename: string | null;
      trigger: string | null;
      consumers_json: string | null;
    } | null;

    if (!row) {
      return undefined;
    }

    return this.mapJobRow(row);
  }

  public listJobs(limit: number): ScanJob[] {
    const statement = this.db.prepare(`
      SELECT id, profile_id, scanner_id, preset_id, state, created_at, started_at, finished_at, error_code, error_message, page_order, scan_params_json, output_filename, trigger, consumers_json
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
      page_order: string | null;
      scan_params_json: string | null;
      output_filename: string | null;
      trigger: string | null;
      consumers_json: string | null;
    }>;

    return rows.map((row) => this.mapJobRow(row));
  }

  public updateJobPageOrder(jobId: string, pageOrder: string[]): void {
    this.db
      .prepare('UPDATE jobs SET page_order = ? WHERE id = ?')
      .run(JSON.stringify(pageOrder), jobId);
  }

  public updateJobScanParams(jobId: string, params: ScanParams): void {
    this.db
      .prepare('UPDATE jobs SET scan_params_json = ? WHERE id = ?')
      .run(JSON.stringify(params), jobId);
  }

  public updateJobOutputFilename(jobId: string, filename: string): void {
    this.db.prepare('UPDATE jobs SET output_filename = ? WHERE id = ?').run(filename, jobId);
  }

  public deleteJob(jobId: string): void {
    this.db.prepare('DELETE FROM job_events WHERE job_id = ?').run(jobId);
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }

  public deleteJobsByState(state: JobState): number {
    const deleteEvents = this.db.prepare(
      'DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE state = ?)',
    );
    const deleteJobs = this.db.prepare('DELETE FROM jobs WHERE state = ?');
    const tx = this.db.transaction(() => {
      deleteEvents.run(state);
      return deleteJobs.run(state).changes;
    });
    return tx();
  }

  public deleteJobsByIds(ids: string[]): number {
    const deleteEvents = this.db.prepare('DELETE FROM job_events WHERE job_id = ?');
    const deleteJob = this.db.prepare('DELETE FROM jobs WHERE id = ?');
    const tx = this.db.transaction(() => {
      let count = 0;
      for (const id of ids) {
        deleteEvents.run(id);
        count += deleteJob.run(id).changes;
      }
      return count;
    });
    return tx();
  }

  private mapJobRow(row: {
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
    page_order: string | null;
    scan_params_json: string | null;
    output_filename: string | null;
    trigger: string | null;
    consumers_json: string | null;
  }): ScanJob {
    const job: ScanJob = {
      id: row.id,
      scannerId: row.scanner_id,
      presetId: row.preset_id,
      state: row.state,
      createdAt: row.created_at,
    };

    if (row.started_at !== null) job.startedAt = row.started_at;
    if (row.finished_at !== null) job.finishedAt = row.finished_at;
    if (row.error_code !== null) job.errorCode = row.error_code;
    if (row.error_message !== null) job.errorMessage = row.error_message;
    if (row.page_order !== null) {
      try {
        job.pageOrder = JSON.parse(row.page_order);
      } catch {
        /* corrupt data — ignore */
      }
    }
    if (row.scan_params_json !== null) {
      try {
        job.scanParams = JSON.parse(row.scan_params_json);
      } catch {
        /* corrupt data — ignore */
      }
    }
    if (row.output_filename !== null) job.outputFilename = row.output_filename;
    if (row.trigger !== null) job.trigger = row.trigger as JobTrigger;
    if (row.consumers_json !== null) {
      try {
        job.consumers = JSON.parse(row.consumers_json);
      } catch {
        /* corrupt data — ignore */
      }
    }

    return job;
  }

  public getJobEvents(
    jobId: string,
  ): Array<{ eventType: string; payload: unknown; createdAt: string }> {
    const statement = this.db.prepare(`
      SELECT event_type, payload_json, created_at
      FROM job_events
      WHERE job_id = ?
      ORDER BY created_at ASC
    `);

    const rows = statement.all(jobId) as Array<{
      event_type: string;
      payload_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      eventType: row.event_type,
      payload: (() => {
        try {
          return JSON.parse(row.payload_json);
        } catch {
          return {};
        }
      })(),
      createdAt: row.created_at,
    }));
  }

  // ─── Discovered Scanners ────────────────────────────────────────────

  public upsertDiscoveredScanner(record: DiscoveredScannerRecord): void {
    const statement = this.db.prepare(`
      INSERT INTO discovered_scanners (id, device, label, last_seen_at, capabilities_json)
      VALUES ($id, $device, $label, $lastSeenAt, $capabilitiesJson)
      ON CONFLICT(id) DO UPDATE SET
        device = $device,
        label = $label,
        last_seen_at = $lastSeenAt,
        capabilities_json = COALESCE($capabilitiesJson, capabilities_json)
      ON CONFLICT(device) DO UPDATE SET
        label = $label,
        last_seen_at = $lastSeenAt,
        capabilities_json = COALESCE($capabilitiesJson, capabilities_json)
    `);

    statement.run({
      $id: record.id,
      $device: record.device,
      $label: record.label,
      $lastSeenAt: record.lastSeenAt,
      $capabilitiesJson: record.capabilities ? JSON.stringify(record.capabilities) : null,
    });
  }

  public updateScannerCapabilities(id: string, capabilities: ScannerCapabilityDetails): void {
    const statement = this.db.prepare(`
      UPDATE discovered_scanners SET capabilities_json = ? WHERE id = ?
    `);
    statement.run(JSON.stringify(capabilities), id);
  }

  public getDiscoveredScanner(id: string): DiscoveredScannerRecord | undefined {
    const statement = this.db.prepare(`
      SELECT id, device, label, last_seen_at, capabilities_json
      FROM discovered_scanners WHERE id = ?
    `);

    const row = statement.get(id) as {
      id: string;
      device: string;
      label: string;
      last_seen_at: string;
      capabilities_json: string | null;
    } | null;

    if (!row) return undefined;

    return {
      id: row.id,
      device: row.device,
      label: row.label,
      lastSeenAt: row.last_seen_at,
      capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : undefined,
    };
  }

  public getDiscoveredScannerByDevice(device: string): DiscoveredScannerRecord | undefined {
    const statement = this.db.prepare(`
      SELECT id, device, label, last_seen_at, capabilities_json
      FROM discovered_scanners WHERE device = ?
    `);

    const row = statement.get(device) as {
      id: string;
      device: string;
      label: string;
      last_seen_at: string;
      capabilities_json: string | null;
    } | null;

    if (!row) return undefined;

    return {
      id: row.id,
      device: row.device,
      label: row.label,
      lastSeenAt: row.last_seen_at,
      capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : undefined,
    };
  }

  public listDiscoveredScanners(): DiscoveredScannerRecord[] {
    const statement = this.db.prepare(`
      SELECT id, device, label, last_seen_at, capabilities_json
      FROM discovered_scanners ORDER BY last_seen_at DESC
    `);

    const rows = statement.all() as Array<{
      id: string;
      device: string;
      label: string;
      last_seen_at: string;
      capabilities_json: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      device: row.device,
      label: row.label,
      lastSeenAt: row.last_seen_at,
      capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : undefined,
    }));
  }

  public deleteDiscoveredScanner(id: string): void {
    this.db.prepare('DELETE FROM discovered_scanners WHERE id = ?').run(id);
  }

  // ─── User Presets ──────────────────────────────────────────────────

  public createUserPreset(preset: UserPreset): void {
    const statement = this.db.prepare(`
      INSERT INTO user_presets (
        id, label, scanner_id, source, mode, resolution_dpi, brightness, contrast,
        page_size, output_format, image_format, jpeg_quality, combine_pages,
        consumers_json, created_at, updated_at
      ) VALUES (
        $id, $label, $scannerId, $source, $mode, $resolutionDpi, $brightness, $contrast,
        $pageSize, $outputFormat, $imageFormat, $jpegQuality, $combinePages,
        $consumersJson, $createdAt, $updatedAt
      )
    `);

    statement.run({
      $id: preset.id,
      $label: preset.label,
      $scannerId: preset.scannerId ?? null,
      $source: preset.source,
      $mode: preset.mode,
      $resolutionDpi: preset.resolutionDpi,
      $brightness: preset.brightness,
      $contrast: preset.contrast,
      $pageSize: preset.pageSize,
      $outputFormat: preset.outputFormat,
      $imageFormat: preset.imageFormat,
      $jpegQuality: preset.jpegQuality,
      $combinePages: preset.combinePages ? 1 : 0,
      $consumersJson: preset.consumers ? JSON.stringify(preset.consumers) : null,
      $createdAt: preset.createdAt,
      $updatedAt: preset.updatedAt,
    });
  }

  public updateUserPreset(preset: UserPreset): void {
    const statement = this.db.prepare(`
      UPDATE user_presets SET
        label = $label, scanner_id = $scannerId, source = $source, mode = $mode,
        resolution_dpi = $resolutionDpi, brightness = $brightness, contrast = $contrast,
        page_size = $pageSize, output_format = $outputFormat, image_format = $imageFormat,
        jpeg_quality = $jpegQuality, combine_pages = $combinePages, consumers_json = $consumersJson,
        updated_at = $updatedAt
      WHERE id = $id
    `);

    statement.run({
      $id: preset.id,
      $label: preset.label,
      $scannerId: preset.scannerId ?? null,
      $source: preset.source,
      $mode: preset.mode,
      $resolutionDpi: preset.resolutionDpi,
      $brightness: preset.brightness,
      $contrast: preset.contrast,
      $pageSize: preset.pageSize,
      $outputFormat: preset.outputFormat,
      $imageFormat: preset.imageFormat,
      $jpegQuality: preset.jpegQuality,
      $combinePages: preset.combinePages ? 1 : 0,
      $consumersJson: preset.consumers ? JSON.stringify(preset.consumers) : null,
      $updatedAt: preset.updatedAt,
    });
  }

  public getUserPreset(id: string): UserPreset | undefined {
    const row = this.db.prepare('SELECT * FROM user_presets WHERE id = ?').get(id) as Record<
      string,
      unknown
    > | null;
    if (!row) return undefined;
    return this.mapUserPresetRow(row);
  }

  public listUserPresets(): UserPreset[] {
    const rows = this.db
      .prepare('SELECT * FROM user_presets ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapUserPresetRow(row));
  }

  public deleteUserPreset(id: string): void {
    this.db.prepare('DELETE FROM user_presets WHERE id = ?').run(id);
  }

  private mapUserPresetRow(row: Record<string, unknown>): UserPreset {
    const preset: UserPreset = {
      id: row.id as string,
      label: row.label as string,
      source: row.source as string,
      mode: row.mode as string,
      resolutionDpi: row.resolution_dpi as number,
      brightness: row.brightness as number,
      contrast: row.contrast as number,
      pageSize: row.page_size as string,
      outputFormat: row.output_format as 'pdf' | 'images',
      imageFormat: row.image_format as 'jpeg' | 'png' | 'tiff',
      jpegQuality: row.jpeg_quality as number,
      combinePages: !!(row.combine_pages as number),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
    const scannerId = row.scanner_id as string | null;
    if (scannerId) preset.scannerId = scannerId;
    const consumersJson = row.consumers_json as string | null;
    if (consumersJson) {
      try {
        preset.consumers = JSON.parse(consumersJson);
      } catch {
        /* corrupt data — ignore */
      }
    }
    return preset;
  }
}
