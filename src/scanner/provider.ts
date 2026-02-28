import type { ScannerDefinition } from '../shared/types/config.js';
import type { ScannerCapabilityDetails } from '../shared/types/domain.js';

/**
 * Scanner capability model normalized for API responses (legacy compat).
 */
export interface ScannerCapabilities {
  adf: boolean;
  flatbed: boolean;
  duplex: boolean;
  sources: string[];
  colorModes: string[];
  resolutionsDpi: number[];
}

export interface DiscoveredScanner {
  id: string;
  label: string;
  device: string;
}

export interface ScanRequest {
  jobId: string;
  device: string;
  source: string;
  mode: string;
  resolutionDpi: number;
  outputDir: string;
  batchStart?: number;
}

export interface PreviewRequest {
  device: string;
  resolutionDpi: number;
  mode: string;
  outputPath: string;
}

export interface ScanProgress {
  pageNumber: number;
  totalPages?: number;
  message: string;
  /** Filename of the page just produced (for live display). */
  filename?: string;
}

export interface ScanResult {
  pagePaths: string[];
}

export interface PreviewResult {
  previewPath: string;
}

/**
 * Contract for scanner backends.
 */
export interface ScannerProvider {
  discoverScanners(): Promise<DiscoveredScanner[]>;
  getCapabilities(scanner: ScannerDefinition): Promise<ScannerCapabilities>;
  /** Query real capabilities from hardware via device string */
  queryCapabilities(device: string): Promise<ScannerCapabilityDetails>;
  previewScan(request: PreviewRequest): Promise<PreviewResult>;
  executeScan(
    request: ScanRequest,
    onProgress: (progress: ScanProgress) => void,
  ): Promise<ScanResult>;
}
