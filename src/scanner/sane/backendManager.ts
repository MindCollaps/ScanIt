import { readFile, writeFile, appendFile, access, constants } from 'node:fs/promises';
import { logger as rootLogger } from '../../server/logger.js';

const logger = rootLogger.child({ module: 'sane-config' });

const SANE_CONFIG_DIR = '/etc/sane.d';
const DLL_CONF = `${SANE_CONFIG_DIR}/dll.conf`;

/**
 * Append a line to a SANE backend config file (e.g. pixma.conf).
 * Creates the file if it doesn't exist.
 */
export const addBackendAddress = async (
  configFile: string,
  line: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Check if already present
    try {
      const content = await readFile(configFile, 'utf-8');
      if (content.includes(line)) {
        logger.info({ configFile, line }, 'Address already present in config');
        return { success: true };
      }
    } catch {
      // File doesn't exist — that's fine, appendFile will create it
    }

    await appendFile(configFile, `\n${line}\n`, 'utf-8');
    logger.info({ configFile, line }, 'Added address to backend config');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ configFile, line, error: message }, 'Failed to add backend address');
    return { success: false, error: message };
  }
};

/**
 * Enable a backend in dll.conf by adding its name as a new line.
 */
export const enableBackend = async (
  backend: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const content = await readFile(DLL_CONF, 'utf-8');
    const lines = content.split('\n');

    // Check if already enabled (uncommented line)
    const isEnabled = lines.some(
      (l) => l.trim() === backend || (l.trim().startsWith(backend) && !l.trim().startsWith('#')),
    );
    if (isEnabled) {
      logger.info({ backend }, 'Backend already enabled in dll.conf');
      return { success: true };
    }

    // Check if it exists but is commented out
    const commentedIdx = lines.findIndex(
      (l) => l.trim().startsWith('#') && l.replace(/^#\s*/, '').trim() === backend,
    );

    if (commentedIdx >= 0) {
      // Uncomment it
      lines[commentedIdx] = backend;
      await writeFile(DLL_CONF, lines.join('\n'), 'utf-8');
      logger.info({ backend }, 'Uncommented backend in dll.conf');
    } else {
      // Add at end
      await appendFile(DLL_CONF, `\n${backend}\n`, 'utf-8');
      logger.info({ backend }, 'Added backend to dll.conf');
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ backend, error: message }, 'Failed to enable backend');
    return { success: false, error: message };
  }
};

/**
 * Apply a recommendation (from diagnostics) to the SANE config.
 */
export const applyRecommendation = async (rec: {
  type: string;
  backend: string;
  configFile?: string;
  configLine?: string;
}): Promise<{ success: boolean; error?: string }> => {
  switch (rec.type) {
    case 'add_backend_address': {
      if (!rec.configFile || !rec.configLine) {
        return { success: false, error: 'Missing configFile or configLine' };
      }
      return addBackendAddress(rec.configFile, rec.configLine);
    }
    case 'enable_backend': {
      return enableBackend(rec.backend);
    }
    default:
      return { success: false, error: `Unknown recommendation type: ${rec.type}` };
  }
};

/**
 * Check if SANE config directory is writable.
 */
export const isConfigWritable = async (): Promise<boolean> => {
  try {
    await access(SANE_CONFIG_DIR, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
