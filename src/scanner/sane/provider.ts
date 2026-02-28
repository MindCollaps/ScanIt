import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  DiscoveredScanner,
  PreviewRequest,
  PreviewResult,
  ScanProgress,
  ScanRequest,
  ScanResult,
  ScannerCapabilities,
  ScannerProvider,
} from '../provider.js';
import type { ScannerDefinition } from '../../shared/types/config.js';
import type { ScannerCapabilityDetails } from '../../shared/types/domain.js';
import { runCommand, CommandError } from './commandRunner.js';
import { parseCapabilities } from './capabilityParser.js';
import { logger as rootLogger } from '../../server/logger.js';

const providerLogger = rootLogger.child({ module: 'sane-provider' });

const parseDiscoveryOutput = (stdout: string): DiscoveredScanner[] => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const discovered: DiscoveredScanner[] = [];

  for (const line of lines) {
    const match = line.match(/^device\s+[`']([^`']+)[`']\s+is\s+a?\s*(.+)$/);
    if (!match) {
      continue;
    }

    const device = match[1];
    const label = match[2];
    if (!device || !label) {
      continue;
    }

    discovered.push({
      id: device.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase(),
      device,
      label,
    });
  }

  return discovered;
};

const buildScanArgs = (device: string, resolutionDpi: number, mode: string): string[] => {
  return ['--device-name', device, '--resolution', String(resolutionDpi), '--mode', mode];
};

/**
 * SANE-backed scanner provider implementation.
 */
export class SaneScannerProvider implements ScannerProvider {
  private readonly scannerTimeoutMs: number;

  public constructor(scannerTimeoutMs: number) {
    this.scannerTimeoutMs = scannerTimeoutMs;
  }

  public async discoverScanners(): Promise<DiscoveredScanner[]> {
    providerLogger.info(
      { timeoutMs: this.scannerTimeoutMs },
      'Running scanimage -L for scanner discovery',
    );
    try {
      const output = await runCommand('scanimage', ['-L'], this.scannerTimeoutMs);
      providerLogger.debug(
        { stdout: output.stdout, stderr: output.stderr },
        'scanimage -L raw output',
      );
      const discovered = parseDiscoveryOutput(output.stdout);
      providerLogger.info(
        { count: discovered.length, devices: discovered.map((d) => d.device) },
        'Scanner discovery complete',
      );
      return discovered;
    } catch (error) {
      providerLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'scanimage -L failed',
      );
      throw error;
    }
  }

  /**
   * Query real capabilities from scanner hardware via `scanimage -A`.
   */
  public async queryCapabilities(device: string): Promise<ScannerCapabilityDetails> {
    const output = await runCommand(
      'scanimage',
      ['-A', '--device-name', device],
      this.scannerTimeoutMs,
    );
    return parseCapabilities(output.stdout, device);
  }

  /**
   * Legacy capability getter from config-defined scanner.
   * Tries to query hardware first, falls back to config-derived values.
   */
  public async getCapabilities(scanner: ScannerDefinition): Promise<ScannerCapabilities> {
    const device = scanner.connection.device;
    if (device) {
      try {
        const details = await this.queryCapabilities(device);
        return {
          adf: details.hasAdf,
          flatbed: details.hasFlatbed,
          duplex: details.hasDuplex,
          sources: details.sources,
          colorModes: details.colorModes,
          resolutionsDpi: details.resolutionsDpi,
        };
      } catch (err) {
        providerLogger.debug(
          { device, error: err instanceof Error ? err.message : String(err) },
          'Hardware capability query failed, falling back to config',
        );
      }
    }

    return {
      adf: scanner.capabilities.adf,
      flatbed: scanner.capabilities.flatbed,
      duplex: scanner.capabilities.duplex,
      sources: scanner.capabilities.adf ? ['ADF Front', 'ADF Duplex', 'Flatbed'] : ['Flatbed'],
      colorModes: ['Color', 'Gray', 'Lineart'],
      resolutionsDpi: [150, 200, 300, 600],
    };
  }

  public async previewScan(request: PreviewRequest): Promise<PreviewResult> {
    const args = [
      ...buildScanArgs(request.device, request.resolutionDpi, request.mode),
      '--format',
      'png',
      '--output-file',
      request.outputPath,
    ];

    await runCommand('scanimage', args, this.scannerTimeoutMs);

    return {
      previewPath: request.outputPath,
    };
  }

  public async executeScan(
    request: ScanRequest,
    onProgress: (progress: ScanProgress) => void,
  ): Promise<ScanResult> {
    await mkdir(request.outputDir, { recursive: true });

    const isFlatbed = /flatbed/i.test(request.source);
    const batchTemplate = join(request.outputDir, `${request.jobId}_page_%03d.png`);

    const args = [
      ...buildScanArgs(request.device, request.resolutionDpi, request.mode),
      '--source',
      request.source,
      '--format',
      'png',
    ];

    if (isFlatbed) {
      // Flatbed = single page, no batch mode.  Use --output-file directly.
      const pageNum = request.batchStart && request.batchStart > 1 ? request.batchStart : 1;
      const outputFile = batchTemplate.replace('%03d', String(pageNum).padStart(3, '0'));
      args.push('--output-file', outputFile);
    } else {
      // ADF / multi-page: use --batch
      args.push(`--batch=${batchTemplate}`);
      if (request.batchStart && request.batchStart > 1) {
        args.push(`--batch-start=${request.batchStart}`);
      }
    }

    onProgress({
      pageNumber: 0,
      message: 'Starting scan operation',
    });

    const fullCmd = ['scanimage', ...args].join(' ');
    providerLogger.info(
      { fullCmd, isFlatbed, outputDir: request.outputDir, jobId: request.jobId },
      'Executing scan command',
    );

    // ── Live page polling ──────────────────────────────────────────
    // While the scan runs, poll the output directory for newly-produced
    // page files and emit a progress event for each one.  This lets the
    // client show thumbnails as soon as each page is available on disk.
    const pagePrefix = `${request.jobId}_page_`;
    const knownPages = new Set<string>();
    let polling = true;
    const PAGE_POLL_MS = 600;

    const pollPages = async (): Promise<void> => {
      while (polling) {
        try {
          const allFiles = await readdir(request.outputDir);
          const pageFiles = allFiles
            .filter((f) => f.startsWith(pagePrefix) && f.endsWith('.png'))
            .sort();

          for (const file of pageFiles) {
            if (knownPages.has(file)) continue;
            const filePath = join(request.outputDir, file);
            try {
              const info = await stat(filePath);
              if (info.size > 0) {
                knownPages.add(file);
                const pageNum = knownPages.size;
                providerLogger.debug({ file, pageNum, bytes: info.size }, 'Live page detected');
                onProgress({
                  pageNumber: pageNum,
                  message: `Page ${pageNum} scanned`,
                  filename: file,
                });
              }
            } catch {
              /* file not fully written yet — will catch next poll */
            }
          }
        } catch {
          /* readdir may fail transiently */
        }
        await delay(PAGE_POLL_MS);
      }
    };

    // Start polling in background (not awaited until scan finishes)
    const pollPromise = pollPages();

    // ── Execute the scan ───────────────────────────────────────────
    // Many SANE backends (notably pixma) exit non-zero after successfully
    // scanning because the follow-up sane_read returns SANE_STATUS_INVAL.
    // Instead of trusting the exit code we always check whether page files
    // were actually produced on disk and only fail when there are none.
    // Scan operations must not be killed by a timeout — a multi-page ADF
    // scan can take many minutes.  Use 0 (unlimited).
    let scanError: unknown = null;
    try {
      const output = await runCommand('scanimage', args, 0);
      providerLogger.debug(
        { stdout: output.stdout, stderr: output.stderr, exitCode: output.exitCode },
        'scanimage completed successfully',
      );
    } catch (err) {
      scanError = err;
      if (err instanceof CommandError) {
        providerLogger.warn(
          { exitCode: err.exitCode, stderr: err.stderr, stdout: err.stdout },
          'scanimage exited with error — will check for produced files',
        );
      } else {
        providerLogger.error({ error: String(err) }, 'scanimage threw unexpected error');
      }
    }

    // Stop the page poller now that scanimage has exited
    polling = false;
    await pollPromise;

    // ── Post-scan file verification ────────────────────────────────
    // Some backends / Docker bind-mounts may not flush files instantly,
    // so we retry up to 3 times with a short delay between attempts.
    const FILE_CHECK_DELAY_MS = 300;
    const FILE_CHECK_RETRIES = 3;

    const discoverValidFiles = async (): Promise<string[]> => {
      const allFiles = await readdir(request.outputDir);
      providerLogger.debug(
        { allFiles, outputDir: request.outputDir },
        'Files in output directory after scan',
      );
      const pagePaths = allFiles
        .filter((f) => f.startsWith(pagePrefix) && f.endsWith('.png'))
        .sort()
        .map((f) => join(request.outputDir, f));

      providerLogger.debug({ matchedPages: pagePaths }, 'Matched page files');

      const valid: string[] = [];
      for (const p of pagePaths) {
        try {
          const info = await stat(p);
          providerLogger.debug({ path: p, size: info.size }, 'Page file stat');
          if (info.size > 0) valid.push(p);
          else providerLogger.warn({ path: p }, 'Page file exists but has zero bytes — skipping');
        } catch (statErr) {
          providerLogger.warn(
            { path: p, error: String(statErr) },
            'Failed to stat page file — skipping',
          );
        }
      }
      return valid;
    };

    let validPaths: string[] = [];
    for (let attempt = 1; attempt <= FILE_CHECK_RETRIES; attempt++) {
      if (attempt > 1) {
        providerLogger.info(
          { attempt, delayMs: FILE_CHECK_DELAY_MS },
          'Retrying file detection after delay',
        );
        await delay(FILE_CHECK_DELAY_MS);
      }
      validPaths = await discoverValidFiles();
      if (validPaths.length > 0) break;
    }

    providerLogger.info(
      { validPages: validPaths.length, hadError: !!scanError },
      'Post-scan file verification complete',
    );

    if (scanError) {
      if (validPaths.length === 0) {
        providerLogger.error(
          { error: scanError instanceof CommandError ? scanError.message : String(scanError) },
          'Scan failed with no usable page files produced',
        );
        throw scanError;
      }
      const combined =
        scanError instanceof CommandError ? scanError.stderr + scanError.stdout : String(scanError);
      providerLogger.warn(
        { exitStderr: combined, pagesProduced: validPaths.length, isFlatbed },
        'scanimage exited with error but produced pages — treating as success',
      );
    }

    if (validPaths.length === 0) {
      // No files produced and no error — e.g. empty ADF tray.
      throw new Error('Scan completed but no page files were produced (empty feeder?)');
    }

    // Emit any pages not caught by the live poller (e.g. flatbed single‑page)
    for (const p of validPaths) {
      const fname = p.split('/').pop()!;
      if (!knownPages.has(fname)) {
        knownPages.add(fname);
        onProgress({
          pageNumber: knownPages.size,
          message: `Page ${knownPages.size} scanned`,
          filename: fname,
        });
      }
    }

    onProgress({
      pageNumber: validPaths.length,
      totalPages: validPaths.length,
      message: `Scan completed: ${validPaths.length} page(s) scanned`,
    });

    return { pagePaths: validPaths };
  }
}
