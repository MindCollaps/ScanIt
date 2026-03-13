import { Router } from 'express';
import { join } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConfigRuntime } from '../../config/runtime.js';
import type { JobService } from '../services/jobService.js';
import type { AdapterRegistry } from '../../integration-core/adapter.js';
import type { JobState, JobTrigger } from '../../shared/types/domain.js';

const execFileAsync = promisify(execFile);

interface CreateJobBody {
  scannerId: string;
  presetId: string;
  outputFilename?: string;
  trigger?: JobTrigger;
  consumers?: string[];
  deferDelivery?: boolean;
  overrides?: {
    device?: string;
    source?: string;
    mode?: string;
    resolutionDpi?: number;
  };
}

const isCreateJobBody = (value: unknown): value is CreateJobBody => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.scannerId !== 'string' ||
    (typeof record.presetId !== 'string' && typeof record.presetId !== 'undefined')
  ) {
    return false;
  }

  if (
    record.trigger !== undefined &&
    record.trigger !== 'webui' &&
    record.trigger !== 'api'
  ) {
    return false;
  }

  if (
    record.consumers !== undefined &&
    (!Array.isArray(record.consumers) ||
      !record.consumers.every((c: unknown) => typeof c === 'string'))
  ) {
    return false;
  }

  if (record.deferDelivery !== undefined && typeof record.deferDelivery !== 'boolean') {
    return false;
  }

  return true;
};

/**
 * Scan job creation and retrieval routes.
 */
export const createJobRouter = (
  runtime: ConfigRuntime,
  jobService: JobService,
  adapterRegistry: AdapterRegistry,
): Router => {
  const router = Router();

  /** List available consumer adapter types. */
  router.get('/api/consumers', (_request, response) => {
    response.json(adapterRegistry.types());
  });

  router.post('/api/jobs', async (request, response, next) => {
    try {
      if (!isCreateJobBody(request.body)) {
        response.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Body must include scannerId and presetId',
        });
        return;
      }

      const snapshot = runtime.getSnapshot();
      const job = await jobService.createAndRunJob(
        {
          ...request.body,
          trigger: request.body.trigger ?? 'api',
        },
        snapshot.config,
      );
      response.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/jobs/:jobId', (request, response) => {
    const job = jobService.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({
        code: 'JOB_NOT_FOUND',
        message: `Job '${request.params.jobId}' not found`,
      });
      return;
    }

    response.json(job);
  });

  router.get('/api/history', (request, response) => {
    const limitQuery = request.query.limit;
    const parsedLimit = typeof limitQuery === 'string' ? Number(limitQuery) : 50;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 50;
    response.json(jobService.listJobs(limit));
  });

  /** List scanned page images for a job. */
  router.get('/api/jobs/:jobId/pages', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const pages = await jobService.getJobPages(request.params.jobId, snapshot.config);
      response.json(
        pages.map((page, index) => ({
          index,
          filename: page.filename,
          bytes: page.bytes,
          url: `/api/jobs/${request.params.jobId}/pages/by-name/${encodeURIComponent(page.filename)}`,
        })),
      );
    } catch (error) {
      next(error);
    }
  });

  /** Serve an individual page image by index. */
  router.get('/api/jobs/:jobId/pages/:pageIndex', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const pages = await jobService.getJobPages(request.params.jobId, snapshot.config);
      const pageIndex = Number(request.params.pageIndex);
      const page = pages[pageIndex];

      if (!page) {
        response.status(404).json({ code: 'PAGE_NOT_FOUND', message: 'Page not found' });
        return;
      }

      const ext = page.filename.split('.').pop()?.toLowerCase() ?? 'png';
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        pnm: 'image/x-portable-anymap',
        tif: 'image/tiff',
        tiff: 'image/tiff',
      };

      response.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      response.setHeader('Content-Length', page.bytes);
      createReadStream(page.path).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  /** Serve a page image by filename (stable during active scans). */
  router.get('/api/jobs/:jobId/pages/by-name/:filename', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const outputDir = jobService.getJobOutputDir(request.params.jobId, snapshot.config);
      if (!outputDir) {
        response.status(404).json({ code: 'JOB_NOT_FOUND', message: 'Job not found' });
        return;
      }

      const filename = request.params.filename;
      // Prevent directory traversal
      if (filename.includes('/') || filename.includes('..')) {
        response.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid filename' });
        return;
      }

      const filePath = join(outputDir, filename);
      if (!existsSync(filePath)) {
        response.status(404).json({ code: 'PAGE_NOT_FOUND', message: 'Page file not found' });
        return;
      }

      const ext = filename.split('.').pop()?.toLowerCase() ?? 'png';
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        pnm: 'image/x-portable-anymap',
        tif: 'image/tiff',
        tiff: 'image/tiff',
      };

      response.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      // no-cache: browser revalidates on every request (handles rotation)
      response.setHeader('Cache-Control', 'no-cache');
      createReadStream(filePath).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  /** Generate and serve a PDF combining all page images. */
  router.get('/api/jobs/:jobId/pdf', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const outputDir = jobService.getJobOutputDir(request.params.jobId, snapshot.config);

      if (!outputDir) {
        response.status(404).json({ code: 'JOB_NOT_FOUND', message: 'Job not found' });
        return;
      }

      const pages = await jobService.getJobPages(request.params.jobId, snapshot.config);
      if (pages.length === 0) {
        response.status(404).json({ code: 'NO_PAGES', message: 'No scanned pages found' });
        return;
      }

      const pdfPath = join(outputDir, 'output.pdf');

      // Generate PDF from images using img2pdf if available, otherwise use convert
      if (!existsSync(pdfPath)) {
        const imagePaths = pages.map((p) => p.path);
        try {
          await execFileAsync('img2pdf', [...imagePaths, '-o', pdfPath], { timeout: 60000 });
        } catch {
          // Fall back to ImageMagick convert
          try {
            await execFileAsync('convert', [...imagePaths, pdfPath], { timeout: 60000 });
          } catch {
            response.status(500).json({
              code: 'PDF_GENERATION_FAILED',
              message: 'Neither img2pdf nor convert (ImageMagick) is available to generate PDF',
            });
            return;
          }
        }
      }

      response.setHeader('Content-Type', 'application/pdf');
      const job = jobService.getJob(request.params.jobId);
      const downloadName = job?.outputFilename
        ? `${job.outputFilename.replace(/[^a-zA-Z0-9_\-. ]/g, '_')}.pdf`
        : `scan_${request.params.jobId.slice(0, 8)}.pdf`;
      response.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
      createReadStream(pdfPath).pipe(response);
    } catch (error) {
      next(error);
    }
  });

  /** Update the custom output filename for a job. */
  router.put('/api/jobs/:jobId/filename', (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (typeof body.filename !== 'string') {
        response
          .status(400)
          .json({ code: 'BAD_REQUEST', message: 'Body must include filename: string' });
        return;
      }
      jobService.updateOutputFilename(request.params.jobId, body.filename);
      response.json({ ok: true, filename: body.filename });
    } catch (error) {
      next(error);
    }
  });

  /** Append more pages to an existing (completed) job via a new scan. */
  router.post('/api/jobs/:jobId/append', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      const result = await jobService.appendToJob(request.params.jobId, snapshot.config);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** List events (activity log) for a job. */
  router.get('/api/jobs/:jobId/events', (request, response) => {
    const job = jobService.getJob(request.params.jobId);
    if (!job) {
      response.status(404).json({
        code: 'JOB_NOT_FOUND',
        message: `Job '${request.params.jobId}' not found`,
      });
      return;
    }
    response.json(jobService.getJobEvents(request.params.jobId));
  });

  /** Delete a single page from a job. */
  router.delete('/api/jobs/:jobId/pages/:filename', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      await jobService.deletePage(request.params.jobId, request.params.filename, snapshot.config);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Rotate a single page image. Body: { degrees: 90 | 180 | 270 } */
  router.post('/api/jobs/:jobId/pages/:filename/rotate', async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const degrees = body.degrees;
      if (typeof degrees !== 'number' || ![90, 180, 270].includes(degrees)) {
        response
          .status(400)
          .json({ code: 'BAD_REQUEST', message: 'degrees must be 90, 180 or 270' });
        return;
      }
      const snapshot = runtime.getSnapshot();
      await jobService.rotatePage(
        request.params.jobId,
        request.params.filename,
        degrees,
        snapshot.config,
      );
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Reorder pages in a job. Body: { order: string[] } (array of filenames in desired order) */
  router.put('/api/jobs/:jobId/pages/reorder', async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const order = body.order;

      if (!Array.isArray(order) || !order.every((item) => typeof item === 'string')) {
        response
          .status(400)
          .json({ code: 'BAD_REQUEST', message: 'Body must include order: string[]' });
        return;
      }

      const snapshot = runtime.getSnapshot();
      jobService.reorderPages(request.params.jobId, order as string[], snapshot.config);
      response.json({ ok: true, order });
    } catch (error) {
      next(error);
    }
  });

  /** Interleave pages for duplex scanning. Body: { splitIndex: number, reverseSecond?: boolean } */
  router.post('/api/jobs/:jobId/pages/interleave', async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const splitIndex = body.splitIndex;
      const reverseSecond = body.reverseSecond === true;

      if (typeof splitIndex !== 'number' || splitIndex < 1) {
        response
          .status(400)
          .json({ code: 'BAD_REQUEST', message: 'splitIndex must be a positive integer' });
        return;
      }

      const snapshot = runtime.getSnapshot();
      const newOrder = await jobService.interleavePages(
        request.params.jobId,
        splitIndex,
        reverseSecond,
        snapshot.config,
      );
      response.json({ ok: true, order: newOrder });
    } catch (error) {
      next(error);
    }
  });

  /** Manually deliver a completed job to a specific consumer. Body: { consumer: string } */
  router.post('/api/jobs/:jobId/deliver', async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (typeof body.consumer !== 'string' || !body.consumer) {
        response.status(400).json({ code: 'BAD_REQUEST', message: 'Body must include consumer: string' });
        return;
      }
      const snapshot = runtime.getSnapshot();
      const result = await jobService.deliverToConsumer(
        request.params.jobId,
        body.consumer,
        snapshot.config,
      );
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  /** Finalize a held job and dispatch its consumers. */
  router.post('/api/jobs/:jobId/finalize', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      await jobService.finalizeHeldJob(request.params.jobId, snapshot.config);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Delete a single job and its files. */
  router.delete('/api/jobs/:jobId', async (request, response, next) => {
    try {
      const snapshot = runtime.getSnapshot();
      await jobService.deleteJob(request.params.jobId, snapshot.config);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /** Batch delete jobs. Body: { ids?: string[], state?: string } */
  router.post('/api/jobs/batch-delete', async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const snapshot = runtime.getSnapshot();

      if (typeof body.state === 'string') {
        const validStates: JobState[] = [
          'PENDING',
          'RUNNING',
          'APPENDING',
          'HOLD',
          'SUCCEEDED',
          'FAILED',
          'CANCELED',
        ];
        if (!validStates.includes(body.state as JobState)) {
          response.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid state filter' });
          return;
        }
        const count = await jobService.deleteJobsByState(body.state as JobState, snapshot.config);
        response.json({ ok: true, deleted: count });
        return;
      }

      if (Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string')) {
        const count = await jobService.deleteJobsByIds(body.ids as string[], snapshot.config);
        response.json({ ok: true, deleted: count });
        return;
      }

      response
        .status(400)
        .json({ code: 'BAD_REQUEST', message: 'Body must include ids: string[] or state: string' });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
