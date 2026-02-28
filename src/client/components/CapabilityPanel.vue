<template>
  <div class="detail-panel">
    <div class="section-header">
      <h3>Capabilities: {{ label }}</h3>
      <button class="btn-secondary" :disabled="isRefreshing" @click="emit('refresh')">
        {{ isRefreshing ? 'Refreshing...' : 'Refresh' }}
      </button>
    </div>

    <div class="caps-grid">
      <div class="caps-group">
        <h4>Sources</h4>
        <div class="chip-list">
          <span v-for="s in capabilities.sources" :key="s" class="chip">{{ s }}</span>
        </div>
      </div>

      <div class="caps-group">
        <h4>Color Modes</h4>
        <div class="chip-list">
          <span v-for="m in capabilities.colorModes" :key="m" class="chip">{{ m }}</span>
        </div>
      </div>

      <div class="caps-group">
        <h4>Resolutions (DPI)</h4>
        <div class="chip-list">
          <span v-for="r in capabilities.resolutionsDpi" :key="r" class="chip">{{ r }}</span>
        </div>
      </div>

      <div v-if="capabilities.geometry" class="caps-group">
        <h4>Scan Area</h4>
        <p>{{ capabilities.geometry.maxWidthMm }}mm × {{ capabilities.geometry.maxHeightMm }}mm</p>
      </div>

      <div class="caps-group">
        <h4>All Options</h4>
        <table class="options-table">
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Values</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(opt, name) in capabilities.options" :key="name">
              <td>
                <code>{{ name }}</code>
              </td>
              <td>{{ opt.type }}</td>
              <td>
                <template v-if="opt.type === 'enum'">{{ opt.values.join(' | ') }}</template>
                <template v-else-if="opt.type === 'range'"
                  >{{ opt.min }}–{{ opt.max }}{{ opt.unit || '' }}</template
                >
                <template v-else-if="opt.type === 'bool'">yes/no</template>
              </td>
              <td>
                <template v-if="opt.type === 'bool'">{{
                  opt.inactive ? 'inactive' : opt.default
                }}</template>
                <template v-else>{{ opt.default ?? '—' }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ScannerCapabilityDetails } from '../../shared/types/domain.js';

defineProps<{
  label: string;
  capabilities: ScannerCapabilityDetails;
  isRefreshing: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
}>();
</script>

<style scoped>
.detail-panel {
  margin-top: 1.5rem;
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-header h3 {
  margin: 0;
}

.caps-grid {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.caps-group h4 {
  margin: 0 0 0.35rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.caps-group p {
  margin: 0;
  font-size: 0.9rem;
}

.chip {
  padding: 0.15em 0.5em;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.options-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.options-table th,
.options-table td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--bg-elevated);
  text-align: left;
}

.options-table th {
  color: var(--text-muted);
  border-bottom-color: var(--border-default);
}

.options-table code {
  font-size: 0.75rem;
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
