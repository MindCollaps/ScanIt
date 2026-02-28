import { Router } from 'express';
import type { ConfigRuntime } from '../../config/runtime.js';

/**
 * Health and readiness routes.
 */
export const createHealthRouter = (runtime: ConfigRuntime): Router => {
  const router = Router();

  router.get('/healthz', (_request, response) => {
    response.json({
      status: 'ok',
      time: new Date().toISOString(),
    });
  });

  router.get('/readyz', (_request, response) => {
    try {
      const snapshot = runtime.getSnapshot();
      response.json({
        status: 'ready',
        configHash: snapshot.hash,
      });
    } catch {
      response.status(503).json({ status: 'not_ready' });
    }
  });

  return router;
};
