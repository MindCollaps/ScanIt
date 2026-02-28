import { Router } from 'express';
import type { ConfigRuntime } from '../../config/runtime.js';
import type { JobService } from '../services/jobService.js';

interface CreateJobBody {
  profileId: string;
  scannerId: string;
  presetId: string;
}

const isCreateJobBody = (value: unknown): value is CreateJobBody => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.profileId === 'string' &&
    typeof record.scannerId === 'string' &&
    typeof record.presetId === 'string'
  );
};

/**
 * Scan job creation and retrieval routes.
 */
export const createJobRouter = (runtime: ConfigRuntime, jobService: JobService): Router => {
  const router = Router();

  router.post('/api/jobs', async (request, response, next) => {
    try {
      if (!isCreateJobBody(request.body)) {
        response.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Body must include profileId, scannerId and presetId',
        });
        return;
      }

      const snapshot = runtime.getSnapshot();
      const job = await jobService.createAndRunJob(request.body, snapshot.config);
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

  return router;
};
