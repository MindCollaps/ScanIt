<template>
  <section class="page">
    <h2>Scan</h2>

    <!-- No scanners configured banner -->
    <div v-if="runtimeConfig && !hasScanners" class="notice">
      <p><strong>No scanners configured.</strong></p>
      <p>Add a scanner to your config file to start scanning.</p>
      <router-link to="/config" class="notice-link">Open Config &rarr;</router-link>
    </div>

    <div v-if="runtimeConfig && hasScanners" class="grid">
      <label>
        Profile
        <select v-model="selectedProfileId">
          <option v-for="profile in runtimeConfig.profiles" :key="profile.id" :value="profile.id">
            {{ profile.label }}
          </option>
        </select>
      </label>

      <label>
        Scanner
        <select v-model="selectedScannerId">
          <option v-for="scanner in runtimeConfig.scanners" :key="scanner.id" :value="scanner.id">
            {{ scanner.label }}
          </option>
        </select>
      </label>

      <label>
        Preset
        <select v-model="selectedPresetId">
          <option v-for="preset in runtimeConfig.presets" :key="preset.id" :value="preset.id">
            {{ preset.label }}
          </option>
        </select>
      </label>
    </div>

    <button v-if="hasScanners" :disabled="isSubmitting" @click="submitJob">
      {{ isSubmitting ? 'Submitting...' : 'Start Scan' }}
    </button>

    <p v-if="lastJobId">Last submitted job: {{ lastJobId }}</p>
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

    <h3>Realtime Events</h3>
    <button @click="toggleEvents">{{ eventsConnected ? 'Disconnect Stream' : 'Connect Stream' }}</button>
    <ul>
      <li v-for="(message, index) in eventMessages.slice(0, 8)" :key="index">
        [{{ message.event }}] {{ message.data }}
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { AppConfig } from '../../shared/types/config.js';
import { useApi } from '../composables/useApi.js';
import { useEventStream } from '../composables/useEventStream.js';

const api = useApi();
const runtimeConfig = ref<AppConfig | null>(null);
const selectedProfileId = ref('');
const selectedScannerId = ref('');
const selectedPresetId = ref('');
const isSubmitting = ref(false);
const lastJobId = ref('');
const errorMessage = ref('');

const hasScanners = computed(() => (runtimeConfig.value?.scanners.length ?? 0) > 0);

const {
  isConnected: eventsConnected,
  messages: eventMessages,
  connect,
  disconnect,
} = useEventStream();

const submitJob = async (): Promise<void> => {
  if (!selectedProfileId.value || !selectedScannerId.value || !selectedPresetId.value) {
    errorMessage.value = 'Please select profile, scanner, and preset.';
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = '';

  try {
    const job = await api.createJob({
      profileId: selectedProfileId.value,
      scannerId: selectedScannerId.value,
      presetId: selectedPresetId.value,
    });
    lastJobId.value = job.id;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to submit job';
  } finally {
    isSubmitting.value = false;
  }
};

const toggleEvents = (): void => {
  if (eventsConnected.value) {
    disconnect();
    return;
  }
  connect();
};

onMounted(async () => {
  runtimeConfig.value = await api.getRuntimeConfig();

  const firstProfile = runtimeConfig.value.profiles[0];
  const firstScanner = runtimeConfig.value.scanners[0];
  const firstPreset = runtimeConfig.value.presets[0];

  selectedProfileId.value = firstProfile?.id ?? '';
  selectedScannerId.value = firstScanner?.id ?? '';
  selectedPresetId.value = firstPreset?.id ?? '';
});
</script>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.notice {
  padding: 1rem 1.25rem;
  border: 1px solid #fbbf24;
  border-radius: 0.5rem;
  background: #fef3c7;
  color: #92400e;
}

.notice p {
  margin: 0 0 0.25rem;
}

.notice-link {
  display: inline-block;
  margin-top: 0.5rem;
  color: #d97706;
  font-weight: 600;
  text-decoration: underline;
}

.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

label {
  display: grid;
  gap: 0.35rem;
}

button {
  width: fit-content;
  padding: 0.6rem 1rem;
  background: #0284c7;
  color: white;
  border: 0;
  border-radius: 0.5rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
}

.error {
  color: #fb7185;
}
</style>
