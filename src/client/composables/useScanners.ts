import { ref } from 'vue';
import type { ScannerDefinition } from '../../shared/types/config.js';
import type {
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
} from '../../shared/types/domain.js';
import { useApi } from './useApi.js';

/**
 * Composable that manages scanner discovery state and actions.
 */
export const useScanners = () => {
  const api = useApi();

  const discoveredScanners = ref<DiscoveredScannerRecord[]>([]);
  const configuredScanners = ref<ScannerDefinition[]>([]);
  const isDiscovering = ref(false);
  const discoveryError = ref('');

  const selectedScannerId = ref('');
  const selectedScannerLabel = ref('');
  const selectedCapabilities = ref<ScannerCapabilityDetails | null>(null);
  const isRefreshing = ref(false);

  const runDiscovery = async (): Promise<void> => {
    isDiscovering.value = true;
    discoveryError.value = '';
    console.log('[scanners] Starting scanner discovery...');
    try {
      const result = await api.discoverScanners();
      discoveredScanners.value = result.discovered;
      console.log(`[scanners] Discovery complete: ${result.discovered.length} scanner(s) found`);
    } catch (error: unknown) {
      discoveryError.value = error instanceof Error ? error.message : 'Discovery failed';
      console.error('[scanners] Discovery failed:', discoveryError.value);
    } finally {
      isDiscovering.value = false;
    }
  };

  const selectScanner = (scanner: DiscoveredScannerRecord): void => {
    console.log(`[scanners] Selected scanner: ${scanner.label} (${scanner.id})`);
    selectedScannerId.value = scanner.id;
    selectedScannerLabel.value = scanner.label;
    selectedCapabilities.value = scanner.capabilities ?? null;
  };

  const refreshSelectedCaps = async (): Promise<void> => {
    if (!selectedScannerId.value) return;
    isRefreshing.value = true;
    console.log(`[scanners] Refreshing capabilities for ${selectedScannerId.value}...`);
    try {
      const caps = await api.refreshCapabilities(selectedScannerId.value);
      selectedCapabilities.value = caps;
      console.log(
        `[scanners] Capabilities refreshed: ${caps.sources.length} source(s), ${caps.resolutionsDpi.length} resolution(s)`,
      );
      const idx = discoveredScanners.value.findIndex((s) => s.id === selectedScannerId.value);
      if (idx >= 0 && discoveredScanners.value[idx]) {
        discoveredScanners.value[idx].capabilities = caps;
      }
    } catch {
      console.warn(`[scanners] Failed to refresh capabilities for ${selectedScannerId.value}`);
    } finally {
      isRefreshing.value = false;
    }
  };

  const loadScanners = async (): Promise<void> => {
    console.log('[scanners] Loading scanners...');
    const data = await api.getScanners();
    configuredScanners.value = data.configured;
    discoveredScanners.value = data.discovered;
    console.log(
      `[scanners] Loaded ${data.configured.length} configured, ${data.discovered.length} discovered`,
    );
  };

  return {
    discoveredScanners,
    configuredScanners,
    isDiscovering,
    discoveryError,
    selectedScannerId,
    selectedScannerLabel,
    selectedCapabilities,
    isRefreshing,
    runDiscovery,
    selectScanner,
    refreshSelectedCaps,
    loadScanners,
  };
};
