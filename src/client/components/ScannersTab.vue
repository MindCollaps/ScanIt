<template>
  <div class="tab-content">
    <div class="section-header">
      <h3>Scanner Discovery</h3>
      <div style="display: flex; gap: 0.5rem">
        <button class="btn-primary" :disabled="isDiscovering" @click="emit('discover')">
          {{ isDiscovering ? 'Discovering...' : 'Discover Scanners' }}
        </button>
      </div>
    </div>

    <p v-if="discoveryError" class="error">{{ discoveryError }}</p>

    <!-- Discovered Scanners -->
    <div v-if="discoveredScanners.length" class="card-grid">
      <div
        v-for="scanner in discoveredScanners"
        :key="scanner.id"
        :class="['card', { selected: selectedScannerId === scanner.id }]"
        @click="emit('selectScanner', scanner)"
      >
        <div class="card-header">
          <span class="card-title">{{ scanner.label }}</span>
          <span class="badge">discovered</span>
        </div>
        <div class="card-meta">
          <code>{{ scanner.device }}</code>
        </div>
        <div class="card-meta">Last seen: {{ formatDate(scanner.lastSeenAt) }}</div>
        <div v-if="scanner.capabilities" class="card-caps">
          <span v-if="scanner.capabilities.hasAdf" class="chip">ADF</span>
          <span v-if="scanner.capabilities.hasFlatbed" class="chip">Flatbed</span>
          <span v-if="scanner.capabilities.hasDuplex" class="chip">Duplex</span>
          <span class="chip">{{ scanner.capabilities.resolutionsDpi.length }} resolutions</span>
          <span class="chip">{{ scanner.capabilities.colorModes.length }} modes</span>
        </div>
        <div v-else class="card-caps">
          <span class="chip muted">No capabilities queried</span>
        </div>
      </div>
    </div>

    <p v-else-if="!isDiscovering" class="muted-text">
      No discovered scanners. Click "Discover Scanners" to find devices, or run
      <router-link to="/diagnostics">Diagnostics</router-link> for extended network discovery.
    </p>

    <!-- Configured Scanners -->
    <div v-if="configuredScanners.length" class="section-header" style="margin-top: 1.5rem">
      <h3>Configured Scanners</h3>
    </div>
    <div v-if="configuredScanners.length" class="card-grid">
      <div v-for="scanner in configuredScanners" :key="scanner.id" class="card">
        <div class="card-header">
          <span class="card-title">{{ scanner.label }}</span>
          <span class="badge config">config</span>
        </div>
        <div class="card-meta">
          <code>{{ scanner.connection.device || 'auto-discover' }}</code>
        </div>
        <div class="card-caps">
          <span v-if="scanner.capabilities.adf" class="chip">ADF</span>
          <span v-if="scanner.capabilities.flatbed" class="chip">Flatbed</span>
          <span v-if="scanner.capabilities.duplex" class="chip">Duplex</span>
        </div>
      </div>
    </div>

    <!-- Capability Detail Panel -->
    <CapabilityPanel
      v-if="selectedCapabilities"
      :label="selectedScannerLabel"
      :capabilities="selectedCapabilities"
      :is-refreshing="isRefreshing"
      @refresh="emit('refreshCaps')"
    />
  </div>
</template>

<script setup lang="ts">
import type { ScannerDefinition } from '../../shared/types/config.js';
import type {
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
} from '../../shared/types/domain.js';
import { formatDate } from '../utils/formatters.js';
import CapabilityPanel from './CapabilityPanel.vue';

defineProps<{
  discoveredScanners: DiscoveredScannerRecord[];
  configuredScanners: ScannerDefinition[];
  isDiscovering: boolean;
  discoveryError: string;
  selectedScannerId: string;
  selectedScannerLabel: string;
  selectedCapabilities: ScannerCapabilityDetails | null;
  isRefreshing: boolean;
}>();

const emit = defineEmits<{
  discover: [];
  selectScanner: [scanner: DiscoveredScannerRecord];
  refreshCaps: [];
}>();
</script>

<style scoped>
.tab-content {
  display: grid;
  gap: 1rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-header h3 {
  margin: 0;
}

.card-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.card {
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
  cursor: default;
  transition: border-color 0.15s;
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  cursor: pointer;
}

.card:not(.selected):hover {
  border-color: var(--border-hover);
  cursor: pointer;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.card-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.card-meta {
  margin-bottom: 0.25rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.card-meta code {
  padding: 0.1em 0.4em;
  border-radius: 0.25rem;
  background: var(--bg-surface);
  font-size: 0.75rem;
}

.card-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.badge {
  padding: 0.15em 0.5em;
  border-radius: 0.25rem;
  background: var(--badge-discovered-bg);
  color: var(--badge-discovered-fg);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge.config {
  background: var(--badge-config-bg);
  color: var(--badge-config-fg);
}

.chip {
  padding: 0.15em 0.5em;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.chip.muted {
  color: var(--text-faint);
}

.muted-text {
  color: var(--text-faint);
  font-size: 0.9rem;
}

.error {
  color: var(--color-error);
  font-size: 0.9rem;
}

.btn-primary {
  padding: 0.55rem 1rem;
  border: 0;
  border-radius: 0.4rem;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:disabled {
  cursor: default;
  opacity: 0.5;
}

.btn-secondary {
  padding: 0.55rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.btn-secondary:hover {
  border-color: var(--border-hover);
  color: var(--text-heading);
}
</style>
