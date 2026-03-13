import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../server/logger.js';
import type { AdapterFactory } from './adapter.js';

interface IntegrationModule {
  adapterFactory?: AdapterFactory;
}

const ENTRY_CANDIDATES = ['index.js', 'index.ts'];
const integrationsDir = fileURLToPath(new URL('../integrations/', import.meta.url));

const resolveEntryFile = (directoryPath: string): string | undefined => {
  for (const candidate of ENTRY_CANDIDATES) {
    const entryPath = join(directoryPath, candidate);
    if (existsSync(entryPath)) {
      return entryPath;
    }
  }
  return undefined;
};

export const loadAdapterFactories = async (): Promise<AdapterFactory[]> => {
  const entries = await readdir(integrationsDir, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const factories: AdapterFactory[] = [];

  for (const directoryName of directories) {
    const directoryPath = join(integrationsDir, directoryName);
    const entryPath = resolveEntryFile(directoryPath);
    if (!entryPath) {
      logger.warn({ integration: directoryName }, 'integration directory has no index module');
      continue;
    }

    let loadedModule: IntegrationModule;
    try {
      loadedModule = (await import(pathToFileURL(entryPath).href)) as IntegrationModule;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load integration '${directoryName}': ${message}`);
    }

    const factory = loadedModule.adapterFactory;
    if (!factory || typeof factory.create !== 'function' || typeof factory.name !== 'string') {
      logger.warn({ integration: directoryName }, 'integration module missing adapterFactory export');
      continue;
    }

    factories.push(factory);
  }

  logger.info(
    { factories: factories.map((factory) => factory.name), count: factories.length },
    'integration factories discovered',
  );

  return factories;
};
