import { computed, ref, reactive } from 'vue';
import type {
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
  UserPreset,
} from '../../shared/types/domain.js';
import type { ScannerDefinition } from '../../shared/types/config.js';
import { useApi, type AnyPreset } from './useApi.js';

/**
 * Composable that manages preset CRUD state and form logic.
 */
export const usePresets = (
  discoveredScanners: { value: DiscoveredScannerRecord[] },
  _configuredScanners: { value: ScannerDefinition[] },
) => {
  const api = useApi();

  const allPresets = ref<AnyPreset[]>([]);
  const editingPresetId = ref('');
  const isSavingPreset = ref(false);
  const presetError = ref('');
  const presetSuccess = ref('');

  const defaultPresetForm = () => ({
    label: '',
    scannerId: '',
    source: 'Flatbed',
    mode: 'Color',
    resolutionDpi: 300,
    brightness: 0,
    contrast: 0,
    pageSize: 'A4',
    outputFormat: 'pdf' as 'pdf' | 'images',
    imageFormat: 'jpeg' as 'jpeg' | 'png' | 'tiff',
    jpegQuality: 85,
    combinePages: true,
  });

  const presetForm = reactive(defaultPresetForm());

  const presetScannerCaps = ref<ScannerCapabilityDetails | null>(null);

  const availableSources = computed(() => {
    if (presetScannerCaps.value) return presetScannerCaps.value.sources;
    return ['Flatbed', 'ADF Front', 'ADF Duplex'];
  });

  const availableModes = computed(() => {
    if (presetScannerCaps.value) return presetScannerCaps.value.colorModes;
    return ['Color', 'Gray', 'Lineart'];
  });

  const availableResolutions = computed(() => {
    if (presetScannerCaps.value) return presetScannerCaps.value.resolutionsDpi;
    return [75, 100, 150, 200, 300, 600, 1200];
  });

  const onPresetScannerChange = async (): Promise<void> => {
    if (!presetForm.scannerId) {
      presetScannerCaps.value = null;
      return;
    }
    console.log(`[presets] Scanner changed to ${presetForm.scannerId}, loading capabilities...`);
    const discovered = discoveredScanners.value.find((s) => s.id === presetForm.scannerId);
    if (discovered?.capabilities) {
      presetScannerCaps.value = discovered.capabilities;
      return;
    }
    try {
      const caps = await api.getDiscoveredCapabilities(presetForm.scannerId);
      presetScannerCaps.value = caps;
    } catch {
      console.warn(`[presets] Failed to load capabilities for ${presetForm.scannerId}`);
      presetScannerCaps.value = null;
    }
  };

  const loadPresets = async (): Promise<void> => {
    try {
      allPresets.value = await api.getAllPresets();
      console.log(`[presets] Loaded ${allPresets.value.length} preset(s)`);
    } catch (err) {
      console.error('[presets] Failed to load presets:', err);
    }
  };

  const savePreset = async (): Promise<void> => {
    isSavingPreset.value = true;
    presetError.value = '';
    presetSuccess.value = '';
    console.log(
      `[presets] Saving preset "${presetForm.label}" (${editingPresetId.value ? 'update' : 'create'})...`,
    );
    try {
      if (editingPresetId.value) {
        await api.updatePreset(editingPresetId.value, { ...presetForm });
        presetSuccess.value = 'Preset updated!';
        console.log(`[presets] Updated preset ${editingPresetId.value}`);
      } else {
        await api.createPreset({ ...presetForm });
        presetSuccess.value = 'Preset created!';
        console.log(`[presets] Created new preset "${presetForm.label}"`);
      }
      resetPresetForm();
      await loadPresets();
    } catch (error: unknown) {
      presetError.value = error instanceof Error ? error.message : 'Failed to save preset';
      console.error('[presets] Save failed:', presetError.value);
    } finally {
      isSavingPreset.value = false;
    }
  };

  const editPreset = (preset: UserPreset): void => {
    editingPresetId.value = preset.id;
    Object.assign(presetForm, {
      label: preset.label,
      scannerId: preset.scannerId ?? '',
      source: preset.source,
      mode: preset.mode,
      resolutionDpi: preset.resolutionDpi,
      brightness: preset.brightness,
      contrast: preset.contrast,
      pageSize: preset.pageSize,
      outputFormat: preset.outputFormat,
      imageFormat: preset.imageFormat,
      jpegQuality: preset.jpegQuality,
      combinePages: preset.combinePages,
    });
  };

  const removePreset = async (id: string): Promise<void> => {
    console.log(`[presets] Deleting preset ${id}`);
    try {
      await api.deletePreset(id);
      console.log(`[presets] Deleted preset ${id}`);
      await loadPresets();
    } catch (err) {
      console.error(`[presets] Failed to delete preset ${id}:`, err);
    }
  };

  const resetPresetForm = (): void => {
    editingPresetId.value = '';
    Object.assign(presetForm, defaultPresetForm());
    presetScannerCaps.value = null;
  };

  return {
    allPresets,
    editingPresetId,
    isSavingPreset,
    presetError,
    presetSuccess,
    presetForm,
    availableSources,
    availableModes,
    availableResolutions,
    onPresetScannerChange,
    loadPresets,
    savePreset,
    editPreset,
    removePreset,
    resetPresetForm,
  };
};
