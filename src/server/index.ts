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
import { AdapterRegistry } from '../integration/adapter.js';
import { filesystemAdapterFactory } from '../integration/filesystem.js';
import { paperlessAdapterFactory } from '../integration/paperless.js';
import { homeAssistantAdapterFactory } from '../integration/homeassistant/service.js';

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

  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.registerFactory(filesystemAdapterFactory);
  adapterRegistry.registerFactory(paperlessAdapterFactory);
  adapterRegistry.registerFactory(homeAssistantAdapterFactory);

  const jobService = new JobService(store, scannerProvider, sseBroker, adapterRegistry);

  const adapterDeps = { jobService, sseBroker, configRuntime: runtime, store };
  await adapterRegistry.initializeAll(snapshot.config, adapterDeps);

  const app = createServerApp({
    configRuntime: runtime,
    scannerProvider,
    jobService,
    sseBroker,
    store,
    adapterRegistry,
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
        await adapterRegistry.reloadConfig(result.snapshot.config, adapterDeps);
      }

      if (result.error) {
        logger.warn({ error: result.error, issues: result.issues }, 'config reload failed, keeping last-known-good');
        for (const issue of result.issues ?? []) {
          logger.warn({ issue }, 'config validation issue');
        }
        sseBroker.emit('config_error', { message: result.error, issues: result.issues ?? [] });
      }
    },
    onWatcherError: (message) => {
      logger.error({ error: message }, 'config watcher error');
      sseBroker.emit('config_error', { message });
    },
  });

  const server = app.listen(snapshot.config.app.port, snapshot.config.app.host, () => {
    logger.info(
      { host: snapshot.config.app.host, port: snapshot.config.app.port, configPath },
      'server listening',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await adapterRegistry.shutdownAll();
    await watcher.close();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

bootstrap().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.fatal({ error: message }, 'Bootstrap failed');
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)) {
    for (const issue of err.issues as string[]) {
      logger.fatal({ issue }, 'config validation issue');
    }
  }
  process.exit(1);
});
