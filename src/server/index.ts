import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigRuntime } from '../config/runtime.js';
import { watchConfigPath } from '../config/watcher.js';
import { SaneScannerProvider } from '../scanner/sane/provider.js';
import { SqliteStore } from '../store/sqlite/db.js';
import { createServerApp } from './app.js';
import { logger } from './logger.js';
import { SseBroker } from './sse/broker.js';
import { JobService } from './services/jobService.js';

const defaultConfigPath = resolve(process.cwd(), 'config');

/**
 * Bootstraps the ScanIt backend runtime.
 */
const bootstrap = async (): Promise<void> => {
  const configPath = process.env.SCANIT_CONFIG_DIR ?? defaultConfigPath;
  const runtime = new ConfigRuntime(configPath);
  const snapshot = await runtime.loadInitialSnapshot();
  logger.info({ configPath, hash: snapshot.hash }, 'config loaded successfully');

  await mkdir(snapshot.config.paths.outputDir, { recursive: true });

  const store = new SqliteStore(snapshot.config.paths.dbFile);
  const sseBroker = new SseBroker(snapshot.config.realtime.replayBufferSize);
  const scannerProvider = new SaneScannerProvider(snapshot.config.resilience.scanner.timeoutMs);
  const jobService = new JobService(store, scannerProvider, sseBroker);
  const app = createServerApp({
    configRuntime: runtime,
    scannerProvider,
    jobService,
    sseBroker,
  });

  const watcher = watchConfigPath(configPath, {
    onReloadAttempt: async () => {
      const result = await runtime.reloadSnapshot();
      if (result.snapshot) {
        logger.info({ hash: result.snapshot.hash }, 'config reloaded');
        sseBroker.emit('config_reloaded', {
          hash: result.snapshot.hash,
          loadedAt: result.snapshot.loadedAt,
        });
      }

      if (result.error) {
        logger.warn({ error: result.error }, 'config reload failed, keeping last-known-good');
        sseBroker.emit('config_error', { message: result.error });
      }
    },
    onWatcherError: (message) => {
      logger.error({ error: message }, 'config watcher error');
      sseBroker.emit('config_error', { message });
    },
  });

  process.on('SIGINT', async () => {
    await watcher.close();
    process.exit(0);
  });

  app.listen(snapshot.config.app.port, snapshot.config.app.host, () => {
    logger.info(
      { host: snapshot.config.app.host, port: snapshot.config.app.port, configPath },
      'server listening',
    );
  });
};

void bootstrap();
