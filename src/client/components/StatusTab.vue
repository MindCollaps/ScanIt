<template>
  <div class="tab-content">
    <div class="section-header">
      <h3>Config Status</h3>
      <button class="btn-secondary" @click="loadStatus">Refresh</button>
    </div>

    <div v-if="configStatus" class="status-card">
      <div class="status-row">
        <span class="label">Status</span>
        <StatusBadge :status="configStatus.status" />
      </div>
      <div class="status-row">
        <span class="label">Loaded at</span>
        <span>{{ configStatus.loadedAt }}</span>
      </div>
      <div class="status-row">
        <span class="label">Source</span>
        <span class="mono">{{ configStatus.sourcePath }}</span>
      </div>
      <div class="status-row">
        <span class="label">Hash</span>
        <span class="mono">{{ configStatus.hash.slice(0, 12) }}&hellip;</span>
      </div>
    </div>

    <div v-if="configStatus?.lastError" class="error-card">
      <h4>Validation Errors</h4>
      <p class="error-timestamp">
        Occurred at {{ configStatus.lastError.occurredAt }}
      </p>
      <ul v-if="configStatus.lastError.issues?.length" class="issue-list">
        <li v-for="(issue, i) in configStatus.lastError.issues" :key="i">{{ issue }}</li>
      </ul>
      <p v-else class="error-message">{{ configStatus.lastError.message }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '../composables/useApi.js';
import { ref, onMounted } from 'vue';
import StatusBadge from './StatusBadge.vue';

interface ConfigStatusResponse {
  status: 'valid' | 'degraded';
  loadedAt: string;
  hash: string;
  sourcePath: string;
  lastError?: {
    message: string;
    issues?: string[];
    occurredAt: string;
  };
}

const api = useApi();
const configStatus = ref<ConfigStatusResponse | null>(null);

const loadStatus = async (): Promise<void> => {
  configStatus.value = await api.getConfigStatus() as ConfigStatusResponse;
};

onMounted(loadStatus);

defineExpose({ loadStatus });
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

.status-card {
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-surface);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.status-row .label {
  min-width: 5rem;
  color: var(--text-muted);
  font-weight: 500;
}

.mono {
  font-family: monospace;
  font-size: 0.8rem;
}

.error-card {
  padding: 1rem;
  border: 1px solid var(--color-error);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--color-error) 6%, var(--bg-surface));
}

.error-card h4 {
  margin: 0 0 0.5rem;
  color: var(--color-error);
  font-size: 0.9rem;
}

.error-timestamp {
  margin: 0 0 0.75rem;
  color: var(--text-faint);
  font-size: 0.75rem;
}

.issue-list {
  margin: 0;
  padding-left: 1.25rem;
  list-style: disc;
}

.issue-list li {
  padding: 0.15rem 0;
  color: var(--color-error);
  font-family: monospace;
  font-size: 0.8rem;
}

.error-message {
  margin: 0;
  color: var(--color-error);
  font-size: 0.85rem;
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
