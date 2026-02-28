import type {
  ScanJob,
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
  UserPreset,
  SaneDiagnosticsReport,
  SaneRecommendation,
} from '../../shared/types/domain.js';
import type { AppConfig, ScannerDefinition, PresetDefinition } from '../../shared/types/config.js';

interface ConfigStatusResponse {
  status: string;
  loadedAt: string;
  hash: string;
  sourcePath: string;
}

interface ScannersResponse {
  configured: ScannerDefinition[];
  discovered: DiscoveredScannerRecord[];
}

interface DiscoveryResponse {
  discovered: Array<DiscoveredScannerRecord & { capabilities: ScannerCapabilityDetails | null }>;
}

interface CreateJobRequest {
  profileId: string;
  scannerId: string;
  presetId: string;
  outputFilename?: string;
  overrides?: {
    device?: string;
    source?: string;
    mode?: string;
    resolutionDpi?: number;
  };
}

/** Config preset with origin marker */
interface ConfigPresetWithOrigin extends PresetDefinition {
  origin: 'config';
}

/** User preset with origin marker */
interface UserPresetWithOrigin extends UserPreset {
  origin: 'user';
}

interface ApplyRecommendationResponse {
  applied: boolean;
  diagnostics: SaneDiagnosticsReport;
}

export type AnyPreset = ConfigPresetWithOrigin | UserPresetWithOrigin;

export interface JobPage {
  index: number;
  filename: string;
  bytes: number;
  url: string;
}

export interface JobEvent {
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      /* response is not JSON — use status text */
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
};

/**
 * Typed frontend API client.
 */
export const useApi = () => {
  return {
    // ─── Config ────────────────────────────────────────────────────
    getConfigStatus: async (): Promise<ConfigStatusResponse> => fetchJson('/api/config/status'),
    getRuntimeConfig: async (): Promise<AppConfig> => fetchJson('/api/config/runtime'),

    // ─── Scanners ──────────────────────────────────────────────────
    getScanners: async (): Promise<ScannersResponse> => fetchJson('/api/scanners'),
    discoverScanners: async (): Promise<DiscoveryResponse> =>
      fetchJson('/api/scanners/discover', { method: 'POST' }),
    getDiscoveredScanners: async (): Promise<DiscoveredScannerRecord[]> =>
      fetchJson('/api/scanners/discovered'),
    getDiscoveredCapabilities: async (scannerId: string): Promise<ScannerCapabilityDetails> =>
      fetchJson(`/api/scanners/discovered/${scannerId}/capabilities`),
    refreshCapabilities: async (scannerId: string): Promise<ScannerCapabilityDetails> =>
      fetchJson(`/api/scanners/discovered/${scannerId}/refresh`, { method: 'POST' }),

    // ─── SANE Diagnostics ──────────────────────────────────────────
    getDiagnostics: async (): Promise<SaneDiagnosticsReport> =>
      fetchJson('/api/scanners/diagnostics'),
    applyRecommendation: async (rec: SaneRecommendation): Promise<ApplyRecommendationResponse> =>
      fetchJson('/api/scanners/diagnostics/apply', {
        method: 'POST',
        body: JSON.stringify({
          type: rec.type,
          backend: rec.backend,
          configFile: rec.configFile,
          configLine: rec.configLine,
        }),
      }),

    // ─── Presets ───────────────────────────────────────────────────
    getAllPresets: async (): Promise<AnyPreset[]> => fetchJson('/api/presets'),
    getUserPresets: async (): Promise<UserPreset[]> => fetchJson('/api/presets/user'),
    createPreset: async (preset: Partial<UserPreset>): Promise<UserPreset> =>
      fetchJson('/api/presets', {
        method: 'POST',
        body: JSON.stringify(preset),
      }),
    updatePreset: async (id: string, preset: Partial<UserPreset>): Promise<UserPreset> =>
      fetchJson(`/api/presets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(preset),
      }),
    deletePreset: async (id: string): Promise<void> => {
      const response = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    },

    // ─── Jobs ──────────────────────────────────────────────────────
    createJob: async (request: CreateJobRequest): Promise<ScanJob> =>
      fetchJson('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    getJob: async (jobId: string): Promise<ScanJob> => fetchJson(`/api/jobs/${jobId}`),
    getJobPages: async (jobId: string): Promise<JobPage[]> => fetchJson(`/api/jobs/${jobId}/pages`),
    getJobEvents: async (jobId: string): Promise<JobEvent[]> =>
      fetchJson(`/api/jobs/${jobId}/events`),
    getJobPdfUrl: (jobId: string): string => `/api/jobs/${jobId}/pdf`,
    getHistory: async (): Promise<ScanJob[]> => fetchJson('/api/history'),

    appendToJob: async (jobId: string): Promise<{ newPages: string[] }> =>
      fetchJson(`/api/jobs/${jobId}/append`, { method: 'POST' }),

    deletePage: async (jobId: string, filename: string): Promise<void> => {
      const response = await fetch(`/api/jobs/${jobId}/pages/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    },

    rotatePage: async (
      jobId: string,
      filename: string,
      degrees: number,
    ): Promise<{ ok: boolean }> =>
      fetchJson(`/api/jobs/${jobId}/pages/${encodeURIComponent(filename)}/rotate`, {
        method: 'POST',
        body: JSON.stringify({ degrees }),
      }),

    reorderPages: async (
      jobId: string,
      order: string[],
    ): Promise<{ ok: boolean; order: string[] }> =>
      fetchJson(`/api/jobs/${jobId}/pages/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ order }),
      }),

    interleavePages: async (
      jobId: string,
      splitIndex: number,
      reverseSecond: boolean,
    ): Promise<{ ok: boolean; order: string[] }> =>
      fetchJson(`/api/jobs/${jobId}/pages/interleave`, {
        method: 'POST',
        body: JSON.stringify({ splitIndex, reverseSecond }),
      }),

    deleteJob: async (jobId: string): Promise<void> => {
      const response = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    },

    batchDeleteJobs: async (params: {
      ids?: string[];
      state?: string;
    }): Promise<{ deleted: number }> =>
      fetchJson('/api/jobs/batch-delete', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    updateOutputFilename: async (
      jobId: string,
      filename: string,
    ): Promise<{ ok: boolean; filename: string }> =>
      fetchJson(`/api/jobs/${jobId}/filename`, {
        method: 'PUT',
        body: JSON.stringify({ filename }),
      }),
  };
};
