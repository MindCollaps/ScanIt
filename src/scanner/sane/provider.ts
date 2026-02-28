import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
import { runCommand } from './commandRunner.js';

const parseDiscoveryOutput = (stdout: string): DiscoveredScanner[] => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const discovered: DiscoveredScanner[] = [];

  for (const line of lines) {
    const match = line.match(/^device\s+`([^`]+)`\s+is\s+(.+)$/);
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

const buildCommonArgs = (scanner: ScannerDefinition, resolutionDpi: number, mode: string): string[] => {
  const device = scanner.connection.device;
  if (!device) {
    throw new Error(`Scanner '${scanner.id}' is missing connection.device`);
  }

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
    const output = await runCommand('scanimage', ['-L'], this.scannerTimeoutMs);
    return parseDiscoveryOutput(output.stdout);
  }

  public async getCapabilities(scanner: ScannerDefinition): Promise<ScannerCapabilities> {
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
      ...buildCommonArgs(request.scanner, request.resolutionDpi, request.scanner.defaults.mode),
      '--format',
      'png',
      '--output-file',
      request.outputPath,
      '--batch-count',
      '1',
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

    const batchTemplate = join(request.outputDir, `${request.jobId}_page_%03d.png`);

    const args = [
      ...buildCommonArgs(request.scanner, request.resolutionDpi, request.mode),
      '--source',
      request.source,
      '--format',
      'png',
      '--batch',
      batchTemplate,
      '--batch-prompt',
    ];

    onProgress({
      pageNumber: 0,
      message: 'Starting scan operation',
    });

    await runCommand('scanimage', args, this.scannerTimeoutMs);

    onProgress({
      pageNumber: 1,
      message: 'Scan operation completed',
    });

    return {
      pagePaths: [batchTemplate.replace('%03d', '001')],
    };
  }
}
