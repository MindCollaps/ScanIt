import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../shared/types/config.js';
import type { ScanJob } from '../../shared/types/domain.js';
import type { ScannerProvider } from '../../scanner/provider.js';
import type { SqliteStore } from '../../store/sqlite/db.js';
import type { SseBroker } from '../sse/broker.js';

export interface CreateJobInput {
  profileId: string;
  scannerId: string;
  presetId: string;
}

/**
 * Orchestrates scan jobs and persists operational state.
 */
export class JobService {
  public constructor(
    private readonly store: SqliteStore,
    private readonly scannerProvider: ScannerProvider,
    private readonly broker: SseBroker,
  ) {}

  public async createAndRunJob(input: CreateJobInput, config: AppConfig): Promise<ScanJob> {
    const profile = config.profiles.find((item) => item.id === input.profileId);
    const scanner = config.scanners.find((item) => item.id === input.scannerId);
    const preset = config.presets.find((item) => item.id === input.presetId);

    if (!profile || !scanner || !preset) {
      throw new Error('Invalid profile, scanner, or preset reference in create job request');
    }

    const jobId = randomUUID();

    this.store.createJob({
      id: jobId,
      profileId: input.profileId,
      scannerId: input.scannerId,
      presetId: input.presetId,
      state: 'PENDING',
    });

    this.broker.emit('job_created', { jobId, input });

    void this.runJob(jobId, profile.id, scanner.id, preset.id, config);

    const created = this.store.getJob(jobId);
    if (!created) {
      throw new Error('Failed to read persisted job record after creation');
    }

    return created;
  }

  private async runJob(
    jobId: string,
    profileId: string,
    scannerId: string,
    presetId: string,
    config: AppConfig,
  ): Promise<void> {
    const scanner = config.scanners.find((item) => item.id === scannerId);
    const preset = config.presets.find((item) => item.id === presetId);

    if (!scanner || !preset) {
      this.store.updateJobState(jobId, 'FAILED', {
        finishedAt: new Date().toISOString(),
        errorCode: 'CONFIG_REFERENCE_ERROR',
        errorMessage: 'Job references missing scanner or preset',
      });
      return;
    }

    this.store.updateJobState(jobId, 'RUNNING', {
      startedAt: new Date().toISOString(),
    });

    this.broker.emit('job_running', { jobId });

    const outputDir = join(config.paths.outputDir, profileId, jobId);

    try {
      await mkdir(outputDir, { recursive: true });
      const result = await this.scannerProvider.executeScan(
        {
          jobId,
          scanner,
          source: preset.scan.source,
          mode: preset.scan.mode,
          resolutionDpi: preset.scan.resolutionDpi,
          outputDir,
        },
        (progress) => {
          this.store.addJobEvent(jobId, 'progress', progress as object);
          this.broker.emit('job_progress', { jobId, ...progress });
        },
      );

      this.store.addJobEvent(jobId, 'completed', { pagePaths: result.pagePaths });
      this.store.updateJobState(jobId, 'SUCCEEDED', {
        finishedAt: new Date().toISOString(),
      });

      this.broker.emit('job_succeeded', { jobId, pagePaths: result.pagePaths });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown scan failure';
      this.store.updateJobState(jobId, 'FAILED', {
        finishedAt: new Date().toISOString(),
        errorCode: 'SCAN_FAILURE',
        errorMessage: message,
      });
      this.store.addJobEvent(jobId, 'failed', { message });
      this.broker.emit('job_failed', { jobId, message });
    }
  }

  public getJob(jobId: string): ScanJob | undefined {
    return this.store.getJob(jobId);
  }

  public listJobs(limit = 50): ScanJob[] {
    return this.store.listJobs(limit);
  }
}
