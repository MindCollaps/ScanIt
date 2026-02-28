import type { ScannerDefinition } from '../shared/types/config.js';

/**
 * Scanner capability model normalized for API responses.
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
  scanner: ScannerDefinition;
  source: string;
  mode: string;
  resolutionDpi: number;
  outputDir: string;
}

export interface PreviewRequest {
  scanner: ScannerDefinition;
  resolutionDpi: number;
  outputPath: string;
}

export interface ScanProgress {
  pageNumber: number;
  totalPages?: number;
  message: string;
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
  previewScan(request: PreviewRequest): Promise<PreviewResult>;
  executeScan(request: ScanRequest, onProgress: (progress: ScanProgress) => void): Promise<ScanResult>;
}
