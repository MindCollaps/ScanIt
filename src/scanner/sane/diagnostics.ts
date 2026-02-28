import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './commandRunner.js';
import { logger as rootLogger } from '../../server/logger.js';
import type {
  MdnsScanner,
  SaneRecommendation,
  SaneDiagnosticsReport,
} from '../../shared/types/domain.js';

// Re-export for route convenience
export type { MdnsScanner, SaneRecommendation, SaneDiagnosticsReport };

const logger = rootLogger.child({ module: 'sane-diagnostics' });

// ─── Constants ───────────────────────────────────────────────────────

const SANE_CONFIG_DIR = '/etc/sane.d';
const DLL_CONF = `${SANE_CONFIG_DIR}/dll.conf`;
const TIMEOUT_MS = 10_000;

/**
 * Map from mDNS service types to SANE backend info.
 * Used to determine which backend config to update.
 */
const SERVICE_BACKEND_MAP: Record<
  string,
  { backend: string; configFile: string; protocol: 'bjnp' | 'escl' | 'ipp' }
> = {
  '_canon-bjnp1._tcp': {
    backend: 'pixma',
    configFile: `${SANE_CONFIG_DIR}/pixma.conf`,
    protocol: 'bjnp',
  },
  '_canon-bjnp2._tcp': {
    backend: 'pixma',
    configFile: `${SANE_CONFIG_DIR}/pixma.conf`,
    protocol: 'bjnp',
  },
  '_uscan._tcp': { backend: 'escl', configFile: `${SANE_CONFIG_DIR}/escl.conf`, protocol: 'escl' },
  '_uscans._tcp': { backend: 'escl', configFile: `${SANE_CONFIG_DIR}/escl.conf`, protocol: 'escl' },
  '_scanner._tcp': {
    backend: 'pixma',
    configFile: `${SANE_CONFIG_DIR}/pixma.conf`,
    protocol: 'bjnp',
  },
  '_ipp._tcp': { backend: 'escl', configFile: `${SANE_CONFIG_DIR}/escl.conf`, protocol: 'escl' },
};

// ─── Parsing helpers ─────────────────────────────────────────────────

/** Parse avahi-browse -r -t output into structured records (one per service advertisement). */
const parseAvahiBrowse = (stdout: string): MdnsScanner[] => {
  const scanners: MdnsScanner[] = [];
  const blocks = stdout.split(/^=/m);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const nameMatch = block.match(/^\s*(\S+)\s+(IPv[46])\s+(.+?)\s{2,}(\S+)\s+local/m);
    if (!nameMatch) continue;

    const [, , , name, serviceType] = nameMatch;
    if (!name || !serviceType) continue;

    // Only care about scanner-related services
    const backendInfo = SERVICE_BACKEND_MAP[serviceType];
    if (!backendInfo) continue;

    const addressMatch = block.match(/address\s*=\s*\[([^\]]+)]/);
    const portMatch = block.match(/port\s*=\s*\[(\d+)]/);
    const txtMatch = block.match(/txt\s*=\s*\[([^\]]*)\]/);

    if (!addressMatch?.[1]) continue;
    const address = addressMatch[1];
    const port = portMatch?.[1] ? Number.parseInt(portMatch[1], 10) : 0;

    // Skip IPv6 link-local — SANE rarely handles them well
    if (address.startsWith('fe80:') || address.includes(':')) continue;

    // Parse txt record
    const txt: Record<string, string> = {};
    if (txtMatch?.[1]) {
      for (const part of txtMatch[1].split('" "')) {
        const cleaned = part.replace(/"/g, '');
        const eqIdx = cleaned.indexOf('=');
        if (eqIdx > 0) {
          txt[cleaned.slice(0, eqIdx)] = cleaned.slice(eqIdx + 1);
        }
      }
    }

    // Deduplicate exact same address + serviceType
    if (scanners.some((s) => s.address === address && s.serviceType === serviceType)) continue;

    scanners.push({
      name,
      address,
      port,
      protocol: backendInfo.protocol,
      serviceType,
      txt,
    });
  }

  logger.debug(
    { count: scanners.length, raw: scanners.map((s) => `${s.address} ${s.serviceType}`) },
    'Parsed avahi-browse output',
  );
  return scanners;
};

/** A device found by scanimage -L. */
interface SaneDevice {
  device: string;
  label: string;
}

/** Parse scanimage -L output. */
const parseScanImageList = (stdout: string): SaneDevice[] => {
  const devices: SaneDevice[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^device\s+[`']([^`']+)[`']\s+is\s+a?\s*(.+)$/);
    if (match?.[1] && match[2]) {
      devices.push({ device: match[1], label: match[2] });
    }
  }
  return devices;
};

/** Parse dll.conf to get enabled backends. */
const parseDllConf = (content: string): string[] => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean) as string[];
};

// ─── Diagnostic functions ────────────────────────────────────────────

/** Check if avahi-daemon is running. */
const checkAvahi = async (): Promise<boolean> => {
  try {
    const output = await runCommand('systemctl', ['is-active', 'avahi-daemon'], TIMEOUT_MS);
    const running = output.stdout.trim() === 'active';
    logger.debug({ running }, 'Avahi daemon status');
    return running;
  } catch {
    logger.warn('Avahi daemon check failed (systemctl not available or avahi not installed)');
    return false;
  }
};

/** Discover scanners via avahi-browse (mDNS). */
const discoverViaMdns = async (): Promise<MdnsScanner[]> => {
  try {
    logger.debug('Running avahi-browse for mDNS scanner discovery');
    const output = await runCommand('avahi-browse', ['-r', '-t', '-a'], TIMEOUT_MS);
    const scanners = parseAvahiBrowse(output.stdout);
    logger.info(
      { count: scanners.length, scanners: scanners.map((s) => `${s.name} (${s.address})`) },
      'mDNS discovery complete',
    );
    return scanners;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'mDNS discovery failed',
    );
    return [];
  }
};

/** Discover scanners via scanimage -L (SANE). */
const discoverViaSane = async (): Promise<SaneDevice[]> => {
  try {
    logger.debug('Running scanimage -L for SANE device discovery');
    const output = await runCommand('scanimage', ['-L'], TIMEOUT_MS);
    const devices = parseScanImageList(output.stdout);
    logger.info(
      { count: devices.length, devices: devices.map((d) => d.device) },
      'SANE discovery complete',
    );
    return devices;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'SANE discovery failed',
    );
    return [];
  }
};

/** Read dll.conf for enabled backends. */
const getEnabledBackends = async (): Promise<string[]> => {
  try {
    const content = await readFile(DLL_CONF, 'utf-8');
    return parseDllConf(content);
  } catch {
    return [];
  }
};

/** Check if the SANE config dir is writable by actually attempting a temp file write. */
const checkConfigWritable = async (): Promise<{ writable: boolean; error?: string }> => {
  const testFile = join(SANE_CONFIG_DIR, '.scanit-write-test');
  try {
    await writeFile(testFile, '', 'utf-8');
    await unlink(testFile);
    logger.debug({ configDir: SANE_CONFIG_DIR }, 'Config directory is writable');
    return { writable: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    logger.warn(
      { configDir: SANE_CONFIG_DIR, error: message, code },
      'Config directory is NOT writable',
    );
    return { writable: false, error: `${code ?? 'UNKNOWN'}: ${message}` };
  }
};

/** Get SANE version string. */
const getSaneVersion = async (): Promise<string | null> => {
  try {
    const output = await runCommand('scanimage', ['--version'], TIMEOUT_MS);
    const match = output.stdout.match(/scanimage\s+\(sane-backends\)\s+([\d.]+)/);
    return match?.[1] ?? output.stdout.trim();
  } catch {
    return null;
  }
};

/** Check if an IP is already referenced in a SANE config file. */
const isAddressInConfig = async (configFile: string, address: string): Promise<boolean> => {
  try {
    const content = await readFile(configFile, 'utf-8');
    return content.includes(address);
  } catch {
    return false;
  }
};

/**
 * Check if a known SANE device string contains the mDNS scanner's IP.
 * E.g. `pixma:MX520_10.0.20.104` contains `10.0.20.104`.
 */
const saneDeviceMatchesMdns = (saneDevice: SaneDevice, mdns: MdnsScanner): boolean => {
  return saneDevice.device.includes(mdns.address);
};

// ─── Main diagnostic runner ──────────────────────────────────────────

/**
 * Runs a full SANE diagnostics check:
 * 1. Checks avahi / SANE version / config state
 * 2. Discovers scanners via mDNS (avahi-browse)
 * 3. Discovers scanners via SANE (scanimage -L)
 * 4. Compares results and generates recommendations
 */
export const runDiagnostics = async (): Promise<SaneDiagnosticsReport> => {
  logger.info('Starting SANE diagnostics run');

  // Run independent checks in parallel
  const [saneVersion, avahiRunning, backendsEnabled, configCheck, mdnsScanners, saneDevices] =
    await Promise.all([
      getSaneVersion(),
      checkAvahi(),
      getEnabledBackends(),
      checkConfigWritable(),
      discoverViaMdns(),
      discoverViaSane(),
    ]);

  const configWritable = configCheck.writable;

  logger.info(
    {
      saneVersion,
      avahiRunning,
      backends: backendsEnabled.length,
      configWritable,
      configWriteError: configCheck.error,
      mdns: mdnsScanners.length,
      sane: saneDevices.length,
    },
    'Diagnostics parallel checks complete',
  );

  // Find mDNS scanners not reachable via SANE
  const unreachableScanners = mdnsScanners.filter(
    (mdns) => !saneDevices.some((sane) => saneDeviceMatchesMdns(sane, mdns)),
  );

  if (unreachableScanners.length > 0) {
    logger.warn(
      {
        count: unreachableScanners.length,
        scanners: unreachableScanners.map((s) => `${s.name} (${s.address})`),
      },
      'Unreachable scanners found (visible on network but not in SANE)',
    );
  }

  // Generate recommendations for each unreachable scanner entry
  // First, deduplicate by address + target backend to avoid duplicate recs
  const seenAddrBackend = new Set<string>();
  const uniqueUnreachable = unreachableScanners.filter((mdns) => {
    const backendInfo = SERVICE_BACKEND_MAP[mdns.serviceType];
    if (!backendInfo) return false;
    const key = `${mdns.address}::${backendInfo.backend}`;
    if (seenAddrBackend.has(key)) {
      logger.debug(
        { address: mdns.address, serviceType: mdns.serviceType, backend: backendInfo.backend },
        'Skipping duplicate unreachable entry (same IP + backend)',
      );
      return false;
    }
    seenAddrBackend.add(key);
    return true;
  });

  const recommendations: SaneRecommendation[] = [];

  for (const mdns of uniqueUnreachable) {
    const backendInfo = SERVICE_BACKEND_MAP[mdns.serviceType];
    if (!backendInfo) continue;

    // Check if the backend is enabled in dll.conf
    if (!backendsEnabled.includes(backendInfo.backend)) {
      recommendations.push({
        type: 'enable_backend',
        backend: backendInfo.backend,
        scanner: mdns.name,
        description: `Enable the '${backendInfo.backend}' backend in dll.conf to support ${mdns.name} (${mdns.protocol})`,
        configFile: DLL_CONF,
        configLine: backendInfo.backend,
        autoApplicable: configWritable,
      });
      continue;
    }

    // Backend is enabled but scanner not found — need to add its address
    const alreadyConfigured = await isAddressInConfig(backendInfo.configFile, mdns.address);
    if (!alreadyConfigured) {
      let configLine: string;
      if (backendInfo.protocol === 'bjnp') {
        configLine = `bjnp://${mdns.address}`;
      } else if (backendInfo.protocol === 'escl') {
        configLine = `http://${mdns.address}:${mdns.port || 80}/eSCL`;
      } else {
        configLine = mdns.address;
      }

      recommendations.push({
        type: 'add_backend_address',
        backend: backendInfo.backend,
        scanner: mdns.name,
        description: `Add ${mdns.name} (${mdns.address}) to ${backendInfo.backend} backend config via ${mdns.protocol}. Network auto-discovery may be blocked by a firewall.`,
        configFile: backendInfo.configFile,
        configLine,
        autoApplicable: configWritable,
      });
    }
  }

  // Safety dedup by configFile + configLine (should be no-op after address dedup above)
  const seen = new Set<string>();
  const deduped = recommendations.filter((rec) => {
    const key = `${rec.configFile ?? ''}::${rec.configLine ?? ''}`;
    if (seen.has(key)) {
      logger.debug(
        { key, type: rec.type, backend: rec.backend },
        'Deduplicating recommendation (same configFile + configLine)',
      );
      return false;
    }
    seen.add(key);
    return true;
  });

  logger.info(
    {
      total: recommendations.length,
      deduped: deduped.length,
      unreachable: unreachableScanners.length,
      uniqueUnreachable: uniqueUnreachable.length,
    },
    'Diagnostics complete',
  );

  const report: SaneDiagnosticsReport = {
    saneVersion,
    avahiRunning,
    backendsEnabled,
    configDir: SANE_CONFIG_DIR,
    configWritable,
    mdnsScanners,
    saneDevices,
    unreachableScanners,
    recommendations: deduped,
  };
  if (!configWritable) {
    report.configWriteError = configCheck.error ?? 'Write test failed (unknown reason)';
  }
  return report;
};
