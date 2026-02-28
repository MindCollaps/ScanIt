import { Router } from 'express';
import type { ConfigRuntime } from '../../config/runtime.js';

/**
 * Exposes config status diagnostics and runtime config.
 */
export const createConfigRouter = (runtime: ConfigRuntime): Router => {
  const router = Router();

  router.get('/api/config/status', (_request, response) => {
    const status = runtime.getStatus();
    response.json(status);
  });

  router.get('/api/config/runtime', (_request, response) => {
    const snapshot = runtime.getSnapshot();
    response.json(snapshot.config);
  });

  return router;
};
