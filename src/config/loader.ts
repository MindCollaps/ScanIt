import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import YAML from 'yaml';
import type { AppConfig, ConfigSnapshot } from '../shared/types/config.js';
import { ConfigLoadError, ConfigValidationError } from './errors.js';
import { validateConfig } from './schema.js';

const interpolationRegex = /\$\{([A-Z0-9_]+)(:-([^}]*))?\}/g;

/**
 * Interpolates ${ENV} and ${ENV:-default} expressions in raw config text.
 */
const interpolateEnv = (raw: string): string => {
  return raw.replace(interpolationRegex, (_whole, variable: string, _fallbackExpr, fallback: string) => {
    const fromEnv = process.env[variable];
    if (fromEnv !== undefined) {
      return fromEnv;
    }

    if (fallback !== undefined) {
      return fallback;
    }

    return '';
  });
};

/**
 * ID-keyed array sections that should be merged by `id` instead of replaced.
 */
const ARRAY_SECTIONS = ['scanners', 'profiles', 'presets', 'workflows', 'destinations'] as const;

type ArraySection = (typeof ARRAY_SECTIONS)[number];

const isArraySection = (key: string): key is ArraySection => {
  return (ARRAY_SECTIONS as readonly string[]).includes(key);
};

/**
 * Deep-merges `overlay` into `base`, mutating `base`.
 * Arrays in ARRAY_SECTIONS are merged by `id`: same id overrides, new ids append.
 * Other objects are recursively merged. Scalars are overwritten.
 */
const deepMerge = (base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> => {
  for (const key of Object.keys(overlay)) {
    const baseVal = base[key];
    const overVal = overlay[key];

    if (isArraySection(key) && Array.isArray(baseVal) && Array.isArray(overVal)) {
      const idMap = new Map<string, Record<string, unknown>>();
      for (const item of baseVal as Array<Record<string, unknown>>) {
        if (typeof item.id === 'string') {
          idMap.set(item.id, item);
        }
      }
      for (const item of overVal as Array<Record<string, unknown>>) {
        if (typeof item.id === 'string') {
          const existing = idMap.get(item.id);
          if (existing) {
            idMap.set(item.id, deepMerge(existing, item) as Record<string, unknown>);
          } else {
            idMap.set(item.id, item);
          }
        }
      }
      base[key] = [...idMap.values()];
    } else if (
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal) &&
      typeof overVal === 'object' &&
      overVal !== null &&
      !Array.isArray(overVal)
    ) {
      deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else {
      base[key] = overVal;
    }
  }
  return base;
};

/**
 * Reads all *.yaml / *.yml files from a config directory in alphabetical order,
 * deep-merges them, then validates the result.
 */
export const loadConfigFromDir = async (configDir: string): Promise<ConfigSnapshot> => {
  let entries: string[];
  try {
    const allFiles = await readdir(configDir);
    entries = allFiles
      .filter((f) => ['.yaml', '.yml'].includes(extname(f).toLowerCase()))
      .sort();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown read error';
    throw new ConfigLoadError(`Failed to read config directory '${configDir}': ${message}`);
  }

  if (entries.length === 0) {
    throw new ConfigLoadError(`No YAML config files found in '${configDir}'`);
  }

  let merged: Record<string, unknown> = {};
  const rawParts: string[] = [];

  for (const filename of entries) {
    const filePath = join(configDir, filename);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown read error';
      throw new ConfigLoadError(`Failed to read config file '${filePath}': ${message}`);
    }

    const interpolated = interpolateEnv(raw);
    rawParts.push(interpolated);

    let parsed: unknown;
    try {
      parsed = YAML.parse(interpolated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      throw new ConfigLoadError(`Failed to parse YAML config '${filePath}': ${message}`);
    }

    // Skip files that only contain `version: 1` and nothing else meaningful
    if (parsed !== null && typeof parsed === 'object') {
      merged = deepMerge(merged, parsed as Record<string, unknown>);
    }
  }

  let config: AppConfig;
  try {
    config = validateConfig(merged);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown validation error';
    throw new ConfigValidationError('Config validation failed', [message]);
  }

  const combinedRaw = rawParts.join('\n---\n');
  const hash = createHash('sha256').update(combinedRaw).digest('hex');

  return {
    config,
    loadedAt: new Date().toISOString(),
    sourcePath: configDir,
    hash,
  };
};

/**
 * Loads config from a single file (legacy) or a directory of files.
 * If configPath is a directory, uses multi-file merge.
 * If configPath is a file, loads that single file.
 */
export const loadConfigSnapshot = async (configPath: string): Promise<ConfigSnapshot> => {
  // Check if configPath is a directory
  const { stat } = await import('node:fs/promises');
  let pathStat;
  try {
    pathStat = await stat(configPath);
  } catch {
    throw new ConfigLoadError(`Config path '${configPath}' does not exist`);
  }

  if (pathStat.isDirectory()) {
    return loadConfigFromDir(configPath);
  }

  // Single-file legacy mode
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown read error';
    throw new ConfigLoadError(`Failed to read config file '${configPath}': ${message}`);
  }

  const interpolated = interpolateEnv(raw);

  let parsed: unknown;
  try {
    parsed = YAML.parse(interpolated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    throw new ConfigLoadError(`Failed to parse YAML config '${configPath}': ${message}`);
  }

  let config: AppConfig;
  try {
    config = validateConfig(parsed);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown validation error';
    throw new ConfigValidationError('Config validation failed', [message]);
  }

  const hash = createHash('sha256').update(interpolated).digest('hex');

  return {
    config,
    loadedAt: new Date().toISOString(),
    sourcePath: configPath,
    hash,
  };
};
