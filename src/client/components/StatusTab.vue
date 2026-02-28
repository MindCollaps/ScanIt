<template>
  <div class="tab-content">
    <div class="section-header">
      <h3>Config Status</h3>
      <button class="btn-secondary" @click="loadStatus">Refresh</button>
    </div>
    <pre v-if="configStatus">{{ configStatus }}</pre>
  </div>
</template>

<script setup lang="ts">
import { useApi } from '../composables/useApi.js';
import { ref } from 'vue';

const api = useApi();
const configStatus = ref('');

const loadStatus = async (): Promise<void> => {
  const result = await api.getConfigStatus();
  configStatus.value = JSON.stringify(result, null, 2);
};

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

pre {
  margin-top: 1rem;
  padding: 1rem;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-surface);
  font-size: 0.8rem;
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
