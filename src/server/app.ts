import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ConfigRuntime } from '../config/runtime.js';
import type { ScannerProvider } from '../scanner/provider.js';
import type { JobService } from './services/jobService.js';
import type { SseBroker } from './sse/broker.js';
import type { SqliteStore } from '../store/sqlite/db.js';
import { logger } from './logger.js';
import { createHealthRouter } from './routes/health.js';
import { createConfigRouter } from './routes/config.js';
import { createScannerRouter } from './routes/scanners.js';
import { createJobRouter } from './routes/jobs.js';
import { createEventsRouter } from './routes/events.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface AppDependencies {
  configRuntime: ConfigRuntime;
  scannerProvider: ScannerProvider;
  jobService: JobService;
  sseBroker: SseBroker;
  store: SqliteStore;
}

/**
 * Builds the Express application with all routes and middleware.
 */
export const createServerApp = (dependencies: AppDependencies): Express => {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? '';
          return url === '/healthz' || url === '/readyz';
        },
      },
      // Keep request logs concise — strip verbose headers
      serializers: {
        req(req: { method: string; url: string }) {
          return {
            method: req.method,
            url: req.url,
          };
        },
        res(res: { statusCode: number }) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );

  app.use(createHealthRouter(dependencies.configRuntime));
  app.use(createConfigRouter(dependencies.configRuntime));
  app.use(
    createScannerRouter(
      dependencies.configRuntime,
      dependencies.scannerProvider,
      dependencies.store,
      dependencies.sseBroker,
    ),
  );
  app.use(createJobRouter(dependencies.configRuntime, dependencies.jobService));
  app.use(createEventsRouter(dependencies.sseBroker));

  // Serve built Vue client in production
  const currentDir = fileURLToPath(new URL('.', import.meta.url));
  const clientDir = resolve(currentDir, '../client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    // SPA fallback – serve index.html for non-API routes
    app.get('/{*path}', (_req, res, next) => {
      if (_req.path.startsWith('/api/') || _req.path === '/healthz' || _req.path === '/readyz') {
        return next();
      }
      res.sendFile(resolve(clientDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
};
