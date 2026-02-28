<template>
  <section>
    <h2>Scan History</h2>
    <button @click="load">Refresh</button>

    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Profile</th>
          <th>Scanner</th>
          <th>Preset</th>
          <th>State</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in jobs" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.profileId }}</td>
          <td>{{ item.scannerId }}</td>
          <td>{{ item.presetId }}</td>
          <td>{{ item.state }}</td>
          <td>{{ item.createdAt }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ScanJob } from '../../shared/types/domain.js';
import { useApi } from '../composables/useApi.js';

const api = useApi();
const jobs = ref<ScanJob[]>([]);

const load = async (): Promise<void> => {
  jobs.value = await api.getHistory();
};

onMounted(load);
</script>

<style scoped>
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

th,
td {
  text-align: left;
  border-bottom: 1px solid #334155;
  padding: 0.5rem;
  font-size: 0.875rem;
}
</style>
