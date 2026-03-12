import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../../shared/types/config.js';
import type { ScanJob, JobState, JobTrigger, ScanParams } from '../../shared/types/domain.js';
import type { ScannerProvider } from '../../scanner/provider.js';
import type { SqliteStore } from '../../store/sqlite/db.js';
import type { SseBroker } from '../sse/broker.js';
import type { AdapterRegistry } from '../../integration/adapter.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

export interface CreateJobInput {
  scannerId: string;
  presetId: string;
  /** Custom output filename (without extension) */
  outputFilename?: string;
  /** What triggered this job */
  trigger?: JobTrigger;
  /** Which consumers should receive the scan output */
  consumers?: string[];
  /** Override scan settings (used for ad-hoc scanning from discovered scanners) */
  overrides?: {
    device?: string;
    source?: string;
    mode?: string;
    resolutionDpi?: number;
  };
}

/**
 * Orchestrates scan jobs and persists operational state.
 */
export class JobService {
  public constructor(
    private readonly store: SqliteStore,
    private readonly scannerProvider: ScannerProvider,
    private readonly broker: SseBroker,
    private readonly adapterRegistry: AdapterRegistry,
  ) {}

  public async createAndRunJob(input: CreateJobInput, config: AppConfig): Promise<ScanJob> {
    // Resolve scanner device - either from config or discovered scanners
    let device: string | undefined;
    let scannerId = input.scannerId;

    const configScanner = config.scanners.find((item) => item.id === input.scannerId);
    if (configScanner) {
      device = configScanner.connection.device;
    } else {
      // Check discovered scanners
      const discovered = this.store.getDiscoveredScanner(input.scannerId);
      if (discovered) {
        device = discovered.device;
        scannerId = discovered.id;
      }
    }

    // Allow device override from ad-hoc scanning
    if (input.overrides?.device) {
      device = input.overrides.device;
    }

    if (!device) {
      throw new Error(`Cannot resolve device for scanner '${input.scannerId}'`);
    }

    // Resolve preset - config presets or user presets
    const configPreset = config.presets.find((item) => item.id === input.presetId);
    const userPreset = !configPreset ? this.store.getUserPreset(input.presetId) : undefined;

    if (!configPreset && !userPreset && !input.overrides) {
      throw new Error('Invalid preset reference and no scan overrides provided');
    }

    // Build effective scan settings
    const source =
      input.overrides?.source ?? userPreset?.source ?? configPreset?.scan.source ?? 'Flatbed';

    const mode = input.overrides?.mode ?? userPreset?.mode ?? configPreset?.scan.mode ?? 'Color';

    const resolutionDpi =
      input.overrides?.resolutionDpi ??
      userPreset?.resolutionDpi ??
      configPreset?.scan.resolutionDpi ??
      300;

    const jobId = randomUUID();

    // Resolve consumers: explicit → preset → default
    const consumers: string[] =
      input.consumers ??
      configPreset?.output.consumers ??
      userPreset?.consumers ??
      ['filesystem'];

    this.store.createJob({
      id: jobId,
      scannerId,
      presetId: input.presetId || 'adhoc',
      state: 'PENDING',
      trigger: input.trigger,
    });

    // Persist resolved consumers
    this.store.updateJobConsumers(jobId, consumers);

    // Persist resolved scan params for future appends
    const scanParams: ScanParams = { device, source, mode, resolutionDpi };
    this.store.updateJobScanParams(jobId, scanParams);

    // Persist custom output filename if provided
    if (input.outputFilename) {
      this.store.updateJobOutputFilename(jobId, input.outputFilename);
    }

    this.broker.emit('job_created', { jobId, input });

    void this.runJob(jobId, device, source, mode, resolutionDpi, config);

    const created = this.store.getJob(jobId);
    if (!created) {
      throw new Error('Failed to read persisted job record after creation');
    }

    return created;
  }

  private async runJob(
    jobId: string,
    device: string,
    source: string,
    mode: string,
    resolutionDpi: number,
    config: AppConfig,
  ): Promise<void> {
    this.store.updateJobState(jobId, 'RUNNING', {
      startedAt: new Date().toISOString(),
    });

    this.broker.emit('job_running', { jobId });

    const outputDir = join(config.paths.outputDir, jobId);

    try {
      await mkdir(outputDir, { recursive: true });
      const result = await this.scannerProvider.executeScan(
        {
          jobId,
          device,
          source,
          mode,
          resolutionDpi,
          outputDir,
        },
        (progress) => {
          this.store.addJobEvent(jobId, 'progress', progress as object);
          this.broker.emit('job_progress', {
            jobId,
            ...progress,
            // Include a URL the client can use to display the page live
            ...(progress.filename
              ? { pageUrl: `/api/jobs/${jobId}/pages/by-name/${progress.filename}` }
              : {}),
          });
        },
      );

      this.store.addJobEvent(jobId, 'completed', { pagePaths: result.pagePaths });
      this.store.updateJobState(jobId, 'SUCCEEDED', {
        finishedAt: new Date().toISOString(),
      });

      this.broker.emit('job_succeeded', { jobId, pagePaths: result.pagePaths });

      // Dispatch to consumers after successful scan
      await this.dispatchToConsumers(jobId, config);
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

  /**
   * Manually dispatch a completed job to a single consumer.
   * Re-runs delivery regardless of whether it was delivered before.
   */
  public async deliverToConsumer(
    jobId: string,
    consumerType: string,
    config: AppConfig,
  ): Promise<{ success: boolean; error?: string }> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);
    if (job.state !== 'SUCCEEDED') throw new Error('Can only deliver completed jobs');

    const adapter = this.adapterRegistry.get(consumerType);
    if (!adapter) throw new Error(`No adapter registered for '${consumerType}'`);

    const pages = await this.getJobPages(jobId, config);

    try {
      const result = await adapter.deliver({ job, pages, config });
      if (!result.success) {
        logger.warn({ jobId, consumerType, error: result.error }, 'Manual delivery failed');
      }
      this.store.addJobEvent(jobId, 'delivery_completed', {
        consumer: consumerType,
        success: result.success,
        manual: true,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Delivery failed';
      logger.error({ jobId, consumerType, err: error }, 'Manual consumer delivery failed');
      this.store.addJobEvent(jobId, 'delivery_failed', {
        consumer: consumerType,
        error: message,
        manual: true,
      });
      return { success: false, error: message };
    }
  }

  public listJobs(limit = 50): ScanJob[] {
    return this.store.listJobs(limit);
  }

  public getJobEvents(
    jobId: string,
  ): Array<{ eventType: string; payload: unknown; createdAt: string }> {
    return this.store.getJobEvents(jobId);
  }

  /**
   * Update the custom output filename for a job.
   */
  public updateOutputFilename(jobId: string, filename: string): void {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);
    this.store.updateJobOutputFilename(jobId, filename);
  }

  /**
   * Returns the output directory for a job, or undefined if the job doesn't exist.
   */
  public getJobOutputDir(jobId: string, config: AppConfig): string | undefined {
    const job = this.store.getJob(jobId);
    if (!job) return undefined;
    return join(config.paths.outputDir, jobId);
  }

  /**
   * Lists page image files for a job, respecting stored page_order.
   */
  public async getJobPages(
    jobId: string,
    config: AppConfig,
  ): Promise<Array<{ filename: string; path: string; bytes: number }>> {
    const outputDir = this.getJobOutputDir(jobId, config);
    if (!outputDir) return [];

    try {
      const files = await readdir(outputDir);
      const imageFiles = files.filter((f) => /\.(png|pnm|jpg|jpeg|tiff?)$/i.test(f)).sort();

      // Respect stored page order if available
      const job = this.store.getJob(jobId);
      const ordered = job?.pageOrder?.length
        ? job.pageOrder.filter((f) => imageFiles.includes(f))
        : imageFiles;

      // Include any new files not yet in the page_order (e.g. just appended)
      const orderedSet = new Set(ordered);
      const extras = imageFiles.filter((f) => !orderedSet.has(f));
      const finalList = [...ordered, ...extras];

      const results: Array<{ filename: string; path: string; bytes: number }> = [];
      for (const filename of finalList) {
        const filePath = join(outputDir, filename);
        const fileStat = await stat(filePath);
        results.push({ filename, path: filePath, bytes: fileStat.size });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Append more scanned pages to an existing job.
   */
  public async appendToJob(jobId: string, config: AppConfig): Promise<{ newPages: string[] }> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);
    if (job.state !== 'SUCCEEDED') throw new Error('Can only append to completed jobs');
    if (!job.scanParams) throw new Error('Job has no stored scan params — cannot append');

    const outputDir = this.getJobOutputDir(jobId, config)!;
    await mkdir(outputDir, { recursive: true });

    // Count existing pages to determine batch-start number
    const existingPages = await this.getJobPages(jobId, config);
    const batchStart = existingPages.length + 1;

    // Transition to APPENDING so the UI knows we're scanning again
    this.store.updateJobState(jobId, 'APPENDING');
    this.broker.emit('job_running', { jobId, append: true });

    try {
      const result = await this.scannerProvider.executeScan(
        {
          jobId,
          device: job.scanParams.device,
          source: job.scanParams.source,
          mode: job.scanParams.mode,
          resolutionDpi: job.scanParams.resolutionDpi,
          outputDir,
          batchStart,
        },
        (progress) => {
          this.broker.emit('job_progress', { jobId, append: true, ...progress });
        },
      );

      // Extract filenames from full paths — only truly new files
      const existingFilenames = new Set(existingPages.map((p) => p.filename));
      const newPageFiles = result.pagePaths
        .map((p) => basename(p))
        .filter((f) => !existingFilenames.has(f));

      // Update page order: existing order + new pages
      const currentOrder = job.pageOrder ?? existingPages.map((p) => p.filename);
      const updatedOrder = [...currentOrder, ...newPageFiles];
      this.store.updateJobPageOrder(jobId, updatedOrder);

      // Invalidate cached PDF
      this.invalidateCachedPdf(outputDir);

      // Transition back to SUCCEEDED
      this.store.updateJobState(jobId, 'SUCCEEDED');

      this.store.addJobEvent(jobId, 'appended', { newPages: newPageFiles, batchStart });
      this.broker.emit('job_succeeded', { jobId, append: true, newPages: newPageFiles });

      // Re-dispatch to consumers after append
      await this.dispatchToConsumers(jobId, config);

      return { newPages: newPageFiles };
    } catch (error: unknown) {
      // Revert to SUCCEEDED so the user can retry
      this.store.updateJobState(jobId, 'SUCCEEDED');
      const message = error instanceof Error ? error.message : 'Append scan failed';
      this.broker.emit('job_failed', { jobId, append: true, message });
      throw error;
    }
  }

  /**
   * Delete a single page from a job by filename.
   */
  public async deletePage(jobId: string, filename: string, config: AppConfig): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    // Prevent directory traversal
    if (filename.includes('/') || filename.includes('..')) {
      throw new Error('Invalid filename');
    }

    const outputDir = this.getJobOutputDir(jobId, config);
    if (!outputDir) throw new Error('Job output directory not found');

    const filePath = join(outputDir, filename);
    if (existsSync(filePath)) {
      await rm(filePath);
    }

    // Remove from page order
    const currentOrder = job.pageOrder ?? [];
    const updatedOrder = currentOrder.filter((f) => f !== filename);
    this.store.updateJobPageOrder(jobId, updatedOrder);

    // Invalidate cached PDF
    this.invalidateCachedPdf(outputDir);
  }

  /**
   * Rotate a single page image by the given degrees (90, 180, 270).
   * Uses ImageMagick `convert` to rewrite the file in-place.
   */
  public async rotatePage(
    jobId: string,
    filename: string,
    degrees: number,
    config: AppConfig,
  ): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    if (![90, 180, 270].includes(degrees)) {
      throw new Error('Degrees must be 90, 180, or 270');
    }

    // Prevent directory traversal
    if (filename.includes('/') || filename.includes('..')) {
      throw new Error('Invalid filename');
    }

    const outputDir = this.getJobOutputDir(jobId, config);
    if (!outputDir) throw new Error('Job output directory not found');

    const filePath = join(outputDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Page file '${filename}' not found`);
    }

    await execFileAsync('convert', [filePath, '-rotate', String(degrees), filePath], {
      timeout: 30000,
    });

    // Invalidate cached PDF
    this.invalidateCachedPdf(outputDir);
  }

  /**
   * Reorder pages in a job.
   */
  public reorderPages(jobId: string, order: string[], config: AppConfig): void {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);
    this.store.updateJobPageOrder(jobId, order);
    const outputDir = this.getJobOutputDir(jobId, config);
    if (outputDir) this.invalidateCachedPdf(outputDir);
  }

  /**
   * Interleave pages for duplex scanning.
   * Takes existing page order, splits at splitIndex, and interleaves the two halves.
   * If reverseSecond is true, the second half is reversed before interleaving.
   */
  public async interleavePages(
    jobId: string,
    splitIndex: number,
    reverseSecond: boolean,
    config: AppConfig,
  ): Promise<string[]> {
    const job = this.store.getJob(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    const pages = await this.getJobPages(jobId, config);
    const allFiles = pages.map((p) => p.filename);

    if (splitIndex < 1 || splitIndex >= allFiles.length) {
      throw new Error('Invalid split index');
    }

    const firstBatch = allFiles.slice(0, splitIndex);
    let secondBatch = allFiles.slice(splitIndex);

    if (reverseSecond) {
      secondBatch = secondBatch.reverse();
    }

    // Interleave: take one from each alternately
    const interleaved: string[] = [];
    const maxLen = Math.max(firstBatch.length, secondBatch.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < firstBatch.length) interleaved.push(firstBatch[i]!);
      if (i < secondBatch.length) interleaved.push(secondBatch[i]!);
    }

    this.store.updateJobPageOrder(jobId, interleaved);
    const outputDir = this.getJobOutputDir(jobId, config);
    if (outputDir) this.invalidateCachedPdf(outputDir);

    return interleaved;
  }

  /**
   * Delete a single job and its files.
   */
  public async deleteJob(jobId: string, config: AppConfig): Promise<void> {
    const outputDir = this.getJobOutputDir(jobId, config);
    this.store.deleteJob(jobId);
    if (outputDir && existsSync(outputDir)) {
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  /**
   * Delete jobs by state (e.g. all FAILED) and their files.
   */
  public async deleteJobsByState(state: JobState, config: AppConfig): Promise<number> {
    // Get jobs before deleting to remove files
    const jobs = this.store.listJobs(10000).filter((j) => j.state === state);
    const count = this.store.deleteJobsByState(state);
    for (const job of jobs) {
      const dir = join(config.paths.outputDir, job.id);
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
    return count;
  }

  /**
   * Delete specific jobs by IDs and their files.
   */
  public async deleteJobsByIds(ids: string[], config: AppConfig): Promise<number> {
    const jobs = ids.map((id) => this.store.getJob(id)).filter(Boolean) as ScanJob[];
    const count = this.store.deleteJobsByIds(ids);
    for (const job of jobs) {
      const dir = join(config.paths.outputDir, job.id);
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
    return count;
  }

  private invalidateCachedPdf(outputDir: string): void {
    const pdfPath = join(outputDir, 'output.pdf');
    try {
      if (existsSync(pdfPath)) unlinkSync(pdfPath);
    } catch {
      // ignore
    }
  }

  /**
   * Dispatch completed scan output to all registered consumers for this job.
   */
  private async dispatchToConsumers(jobId: string, config: AppConfig): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) return;

    const consumers = job.consumers ?? ['filesystem'];
    const pages = await this.getJobPages(jobId, config);

    for (const consumerType of consumers) {
      const adapter = this.adapterRegistry.get(consumerType);
      if (!adapter) {
        logger.warn({ jobId, consumerType }, 'No adapter registered for consumer type');
        this.store.addJobEvent(jobId, 'delivery_skipped', {
          consumer: consumerType,
          reason: 'no_adapter',
        });
        continue;
      }

      try {
        const result = await adapter.deliver({ job, pages, config });
        if (!result.success) {
          logger.warn({ jobId, consumerType, error: result.error }, 'Consumer delivery failed');
        }
        this.store.addJobEvent(jobId, 'delivery_completed', {
          consumer: consumerType,
          success: result.success,
          ...(result.error !== undefined ? { error: result.error } : {}),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Delivery failed';
        logger.error({ jobId, consumerType, err: error }, 'Consumer delivery failed');
        this.store.addJobEvent(jobId, 'delivery_failed', {
          consumer: consumerType,
          error: message,
        });
      }
    }
  }
}
