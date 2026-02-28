<template>
  <section class="page">
    <h2>Configuration</h2>

    <!-- Tab bar -->
    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- ═══ Scanners Tab ═══ -->
    <ScannersTab
      v-if="activeTab === 'scanners'"
      :discovered-scanners="scanners.discoveredScanners.value"
      :configured-scanners="scanners.configuredScanners.value"
      :is-discovering="scanners.isDiscovering.value"
      :discovery-error="scanners.discoveryError.value"
      :selected-scanner-id="scanners.selectedScannerId.value"
      :selected-scanner-label="scanners.selectedScannerLabel.value"
      :selected-capabilities="scanners.selectedCapabilities.value"
      :is-refreshing="scanners.isRefreshing.value"
      @discover="scanners.runDiscovery"
      @select-scanner="scanners.selectScanner"
      @refresh-caps="scanners.refreshSelectedCaps"
    />

    <!-- ═══ Presets Tab ═══ -->
    <PresetsTab
      v-if="activeTab === 'presets'"
      :discovered-scanners="scanners.discoveredScanners.value"
      :configured-scanners="scanners.configuredScanners.value"
      :all-presets="presets.allPresets.value"
      :editing-preset-id="presets.editingPresetId.value"
      :is-saving-preset="presets.isSavingPreset.value"
      :preset-error="presets.presetError.value"
      :preset-success="presets.presetSuccess.value"
      :preset-form="presets.presetForm"
      :available-sources="presets.availableSources.value"
      :available-modes="presets.availableModes.value"
      :available-resolutions="presets.availableResolutions.value"
      @update:preset-form="
        (field: string, value: unknown) => {
          (presets.presetForm as any)[field] = value;
        }
      "
      @save="presets.savePreset"
      @edit="presets.editPreset"
      @remove="presets.removePreset"
      @reset="presets.resetPresetForm"
      @refresh="presets.loadPresets"
      @scanner-change="presets.onPresetScannerChange"
    />

    <!-- ═══ Status Tab ═══ -->
    <StatusTab v-if="activeTab === 'status'" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useScanners } from '../composables/useScanners.js';
import { usePresets } from '../composables/usePresets.js';
import ScannersTab from '../components/ScannersTab.vue';
import PresetsTab from '../components/PresetsTab.vue';
import StatusTab from '../components/StatusTab.vue';

// ─── Tab state ───────────────────────────────────────────────────────

const tabs = [
  { id: 'scanners', label: 'Scanners' },
  { id: 'presets', label: 'Presets' },
  { id: 'status', label: 'Status' },
] as const;

type TabId = (typeof tabs)[number]['id'];
const activeTab = ref<TabId>('scanners');

// ─── Composables ─────────────────────────────────────────────────────

const scanners = useScanners();
const presets = usePresets(scanners.discoveredScanners, scanners.configuredScanners);

// ─── Init ────────────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([scanners.loadScanners(), presets.loadPresets()]);
});
</script>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-default);
}

.tab {
  padding: 0.6rem 1.25rem;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.tab:hover {
  color: var(--text-heading);
}

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
</style>
