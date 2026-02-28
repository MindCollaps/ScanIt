/**
 * Runtime configuration interfaces.
 */

export interface AppConfig {
  version: 1;
  app: {
    name: string;
    host: string;
    port: number;
    baseUrl: string;
    timezone: string;
    health: {
      exposeDetails: boolean;
    };
  };
  paths: {
    configDir: string;
    outputDir: string;
    tempDir: string;
    dbFile: string;
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
    redactKeys: string[];
  };
  realtime: {
    transport: 'sse';
    heartbeatSeconds: number;
    replayBufferSize: number;
  };
  resilience: {
    scanner: {
      timeoutMs: number;
      retries: number;
      backoffMs: number;
    };
    integration: {
      timeoutMs: number;
      retries: number;
      backoffMs: number;
    };
  };
  scanners: ScannerDefinition[];
  profiles: ProfileDefinition[];
  presets: PresetDefinition[];
  workflows: WorkflowDefinition[];
  processing: {
    pdf: {
      engine: 'img2pdf' | 'qpdf';
      optimize: boolean;
      metadata: {
        producer: string;
      };
    };
    image: {
      autoRotate: boolean;
      deskew: boolean;
      removeBlankPages: boolean;
      blankPageThreshold: number;
    };
    thumbnails: {
      enabled: boolean;
      maxWidth: number;
      format: 'jpeg' | 'png';
      quality: number;
    };
    ocr: {
      enabled: boolean;
      provider: 'none' | 'tesseract' | 'external';
      language: string;
    };
  };
  destinations: DestinationDefinition[];
  integrations: {
    paperless?: {
      baseUrl: string;
      timeoutMs: number;
      verifyTls: boolean;
      defaultDocumentType: string;
    };
  };
  features: {
    preview: boolean;
    historySearch: boolean;
    darkMode: boolean;
    configDiagnosticsUi: boolean;
  };
}

export interface ScannerDefinition {
  id: string;
  label: string;
  enabled: boolean;
  backend: 'sane';
  connection: {
    mode: 'network' | 'local' | 'manual';
    device?: string;
    discover: boolean;
  };
  capabilities: {
    adf: boolean;
    flatbed: boolean;
    duplex: boolean;
  };
  defaults: {
    source: string;
    mode: string;
    resolutionDpi: number;
    format: 'png' | 'jpeg' | 'tiff';
  };
}

export interface ProfileDefinition {
  id: string;
  label: string;
  enabled: boolean;
  defaultScannerId?: string;
  defaultPresetId?: string;
  naming: {
    template: string;
    sanitize: boolean;
  };
  integrations?: {
    paperless?: {
      enabled: boolean;
      tokenEnv: string;
      defaultTags: string[];
      correspondent?: string;
    };
  };
}

export interface PresetDefinition {
  id: string;
  label: string;
  scan: {
    source: string;
    mode: string;
    resolutionDpi: number;
    brightness: number;
    contrast: number;
    pageSize: string;
  };
  output: {
    format: 'pdf' | 'images';
    imageFormat: 'jpeg' | 'png' | 'tiff';
    jpegQuality: number;
    combinePages: boolean;
  };
}

export interface WorkflowDefinition {
  id: string;
  label: string;
  profileId: string;
  scannerId: string;
  presetId: string;
  destinationIds: string[];
  askForCustomName: boolean;
  previewBeforeScan: boolean;
}

export interface DestinationDefinition {
  id: string;
  type: 'filesystem' | 'integration';
  enabled: boolean;
  path?: string;
  namingTemplate?: string;
  adapter?: 'paperless';
  profileScoped?: boolean;
}

export interface ConfigSnapshot {
  config: AppConfig;
  loadedAt: string;
  sourcePath: string;
  hash: string;
}

/**
 * Diagnostic status of the config subsystem, exposed via `/api/config/status`.
 */
export interface ConfigStatus {
  status: 'valid' | 'degraded';
  loadedAt: string;
  hash: string;
  sourcePath: string;
  lastError?: {
    message: string;
    occurredAt: string;
  };
}
