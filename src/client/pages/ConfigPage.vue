<template>
  <section>
    <h2>Config Diagnostics</h2>
    <button @click="load">Refresh</button>
    <pre v-if="status">{{ status }}</pre>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi.js';

const api = useApi();
const status = ref<string>('');

const load = async (): Promise<void> => {
  const result = await api.getConfigStatus();
  status.value = JSON.stringify(result, null, 2);
};

onMounted(load);
</script>

<style scoped>
pre {
  margin-top: 1rem;
  padding: 1rem;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 0.5rem;
}
</style>
