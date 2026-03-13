/**
 * Shared domain types used across server and client.
 */

export type JobState =
  | 'PENDING'
  | 'RUNNING'
  | 'APPENDING'
  | 'HOLD'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';

export type JobTrigger = 'webui' | 'api' | 'hassio';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  details?: Record<string, string>;
}

export interface ScanParams {
  device: string;
  source: string;
  mode: string;
  resolutionDpi: number;
}

export interface ScanJob {
  id: string;
  scannerId: string;
  presetId: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  pageOrder?: string[];
  scanParams?: ScanParams;
  outputFilename?: string;
  trigger?: JobTrigger;
  consumers?: string[];
}

export interface ScanArtifact {
  id: string;
  jobId: string;
  kind: 'pdf' | 'image' | 'thumbnail' | 'preview';
  path: string;
  mimeType: string;
  bytes: number;
}

export interface JobProgressEvent {
  jobId: string;
  pageNumber: number;
  totalPages?: number;
  message: string;
  timestamp: string;
}

export interface SseEvent<TPayload> {
  id: string;
  type: string;
  payload: TPayload;
  timestamp: string;
}

// ─── Scanner Discovery & Capabilities ───────────────────────────────

/** Range option from scanimage -A (e.g. brightness -50..50, geometry 0..215.9mm) */
export interface ScanOptionRange {
  type: 'range';
  min: number;
  max: number;
  step?: number;
  unit?: string;
  default?: number;
}

/** Enum option from scanimage -A (e.g. mode Color|Gray, resolution 100|200|300) */
export interface ScanOptionEnum {
  type: 'enum';
  values: string[];
  unit?: string;
  default?: string;
}

/** Boolean option from scanimage -A (e.g. duplex, adf) */
export interface ScanOptionBool {
  type: 'bool';
  default?: boolean;
  inactive?: boolean;
}

export type ScanOption = ScanOptionRange | ScanOptionEnum | ScanOptionBool;

/** Full capabilities as parsed from scanimage -A */
export interface ScannerCapabilityDetails {
  device: string;
  queriedAt: string;
  options: Record<string, ScanOption>;
  /** Derived convenience fields */
  sources: string[];
  colorModes: string[];
  resolutionsDpi: number[];
  hasAdf: boolean;
  hasFlatbed: boolean;
  hasDuplex: boolean;
  geometry?: {
    maxWidthMm: number;
    maxHeightMm: number;
  };
}

/** A discovered scanner persisted to SQLite */
export interface DiscoveredScannerRecord {
  id: string;
  device: string;
  label: string;
  lastSeenAt: string;
  capabilities?: ScannerCapabilityDetails;
}

// ─── SANE Diagnostics & Management ──────────────────────────────────

/** A scanner visible on the network via mDNS/DNS-SD (avahi). */
export interface MdnsScanner {
  name: string;
  address: string;
  port: number;
  protocol: 'bjnp' | 'escl' | 'ipp' | 'unknown';
  serviceType: string;
  txt: Record<string, string>;
}

/** A recommendation for fixing scanner discovery. */
export interface SaneRecommendation {
  type: 'add_backend_address' | 'enable_backend' | 'install_package';
  backend: string;
  scanner: string;
  description: string;
  configFile?: string;
  configLine?: string;
  autoApplicable: boolean;
}

/** Full SANE diagnostics report. */
export interface SaneDiagnosticsReport {
  saneVersion: string | null;
  avahiRunning: boolean;
  backendsEnabled: string[];
  configDir: string;
  configWritable: boolean;
  configWriteError?: string;
  mdnsScanners: MdnsScanner[];
  saneDevices: Array<{ device: string; label: string }>;
  unreachableScanners: MdnsScanner[];
  recommendations: SaneRecommendation[];
}

/** Result of applying a recommendation. */
export interface ApplyRecommendationResult {
  success: boolean;
  error?: string;
}

/** User-created preset (persisted in SQLite, not YAML config) */
export interface UserPreset {
  id: string;
  label: string;
  scannerId?: string;
  source: string;
  mode: string;
  resolutionDpi: number;
  brightness: number;
  contrast: number;
  pageSize: string;
  outputFormat: 'pdf' | 'images';
  imageFormat: 'jpeg' | 'png' | 'tiff';
  jpegQuality: number;
  combinePages: boolean;
  consumers?: string[];
  createdAt: string;
  updatedAt: string;
}
