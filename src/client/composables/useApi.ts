import type { ScanJob } from '../../shared/types/domain.js';
import type { AppConfig, ScannerDefinition } from '../../shared/types/config.js';

interface ConfigStatusResponse {
  status: string;
  loadedAt: string;
  hash: string;
  sourcePath: string;
}

interface ScannersResponse {
  configured: ScannerDefinition[];
  discovered: Array<{ id: string; label: string; device: string }>;
}

interface CreateJobRequest {
  profileId: string;
  scannerId: string;
  presetId: string;
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
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
};

/**
 * Typed frontend API client.
 */
export const useApi = () => {
  return {
    getConfigStatus: async (): Promise<ConfigStatusResponse> => fetchJson('/api/config/status'),
    getRuntimeConfig: async (): Promise<AppConfig> => fetchJson('/api/config/runtime'),
    getScanners: async (): Promise<ScannersResponse> => fetchJson('/api/scanners'),
    createJob: async (request: CreateJobRequest): Promise<ScanJob> =>
      fetchJson('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    getHistory: async (): Promise<ScanJob[]> => fetchJson('/api/history'),
  };
};
