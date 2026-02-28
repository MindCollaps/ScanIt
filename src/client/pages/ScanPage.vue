<template>
  <section class="page">
    <h2>Scan</h2>

    <!-- No scanners configured and no discovered banner -->
    <div v-if="loaded && !hasScanners && !discoveredScanners.length" class="notice">
      <p><strong>No scanners available.</strong></p>
      <p>Discover scanners in the Config tab, or add one to your config file.</p>
      <router-link to="/config" class="notice-link">Open Config &rarr;</router-link>
    </div>

    <div v-if="loaded && (hasScanners || discoveredScanners.length)" class="grid">
      <label>
        Correspondence
        <select v-model="selectedProfileId">
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profile.label }}
          </option>
        </select>
      </label>

      <label>
        Scanner
        <select v-model="selectedScannerId" @change="onScannerChange">
          <optgroup v-if="configuredScanners.length" label="Configured">
            <option v-for="scanner in configuredScanners" :key="scanner.id" :value="scanner.id">
              {{ scanner.label }}
            </option>
          </optgroup>
          <optgroup v-if="discoveredScanners.length" label="Discovered">
            <option v-for="scanner in discoveredScanners" :key="scanner.id" :value="scanner.id">
              {{ scanner.label }}
            </option>
          </optgroup>
        </select>
      </label>

      <label>
        Preset
        <select v-model="selectedPresetId" @change="onPresetChange">
          <option value="__adhoc">Ad-hoc (custom settings)</option>
          <option v-for="preset in allPresets" :key="preset.id" :value="preset.id">
            {{ preset.label }}
            <template v-if="preset.origin === 'user'"> (user)</template>
          </option>
        </select>
      </label>
    </div>

    <!-- Ad-hoc scan settings (when using discovered scanner or ad-hoc preset) -->
    <div v-if="showAdHocSettings" class="adhoc-panel">
      <h4>Scan Settings</h4>
      <div class="grid">
        <label>
          Source
          <select v-model="adhocSettings.source">
            <option v-for="s in adhocSources" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <label>
          Color Mode
          <select v-model="adhocSettings.mode">
            <option v-for="m in adhocModes" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>

        <label>
          Resolution (DPI)
          <select v-model.number="adhocSettings.resolutionDpi">
            <option v-for="r in adhocResolutions" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
      </div>
    </div>

    <!-- Output filename -->
    <div v-if="loaded && (hasScanners || discoveredScanners.length)" class="filename-row">
      <label>
        Output Filename <span class="optional">(optional)</span>
        <input
          v-model="outputFilename"
          type="text"
          placeholder="e.g. Invoice_2026-02"
          class="filename-input"
        />
      </label>
    </div>

    <div v-if="loaded && (hasScanners || discoveredScanners.length)" class="actions">
      <button class="btn-primary" :disabled="isSubmitting || !canSubmit" @click="submitJob">
        {{ isSubmitting ? 'Scanning...' : 'Start Scan' }}
      </button>

      <button
        v-if="showAdHocSettings"
        class="btn-secondary"
        :disabled="isSavingPreset"
        @click="saveAsPreset"
      >
        {{ isSavingPreset ? 'Saving...' : 'Save as Preset' }}
      </button>
    </div>

    <p v-if="lastJobId" class="job-info">
      Last submitted job: <code>{{ lastJobId }}</code>
      <router-link :to="`/jobs/${lastJobId}`" class="job-link">View &rarr;</router-link>
    </p>
    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    <p v-if="successMessage" class="success">{{ successMessage }}</p>

    <!-- Live scanned pages -->
    <div v-if="livePages.length || isSubmitting" class="live-pages-section">
      <h3>
        {{ activeJobDone ? 'Scanned Pages' : 'Scanning...' }}
        <span v-if="livePages.length" class="page-count-badge">{{ livePages.length }}</span>
      </h3>
      <div v-if="!livePages.length && isSubmitting" class="muted">Waiting for first page...</div>
      <PagePreview :pages="livePages" />
      <div v-if="activeJobDone && lastJobId" class="live-pages-actions">
        <router-link :to="`/jobs/${lastJobId}`" class="btn-secondary"
          >Open Job Detail &rarr;</router-link
        >
      </div>
    </div>

    <h3>Realtime Events</h3>
    <div class="event-status">
      <span :class="['status-dot', eventsConnected ? 'connected' : 'disconnected']"></span>
      {{ eventsConnected ? 'Connected' : eventsHasConnected ? 'Reconnecting...' : 'Connecting...' }}
    </div>
    <div v-if="!eventMessages.length" class="muted">
      No events yet — start a scan to see activity.
    </div>
    <ul class="event-list">
      <li
        v-for="(msg, index) in eventMessages.slice(0, 20)"
        :key="index"
        :class="['event-card', `event-${msg.event}`]"
      >
        <div class="event-header">
          <span class="event-icon">{{ eventIcon(msg.event) }}</span>
          <span class="event-label">{{ eventLabel(msg.event) }}</span>
          <span class="event-time">{{ formatEventTime(msg.receivedAt) }}</span>
        </div>
        <div class="event-body">
          <template v-if="msg.event === 'job_created'">
            Job <code>{{ shortId(msg.data.jobId as string) }}</code> created
          </template>
          <template v-else-if="msg.event === 'job_running'">
            Job <code>{{ shortId(msg.data.jobId as string) }}</code> is now scanning...
          </template>
          <template v-else-if="msg.event === 'job_progress'">
            <span v-if="msg.data.pageNumber">Page {{ msg.data.pageNumber }} scanned</span>
            <span v-else-if="msg.data.line">{{ msg.data.line }}</span>
            <span v-else>Progress update</span>
          </template>
          <template v-else-if="msg.event === 'job_succeeded'">
            Job <code>{{ shortId(msg.data.jobId as string) }}</code> completed
            <span v-if="Array.isArray(msg.data.pagePaths)">
              — {{ (msg.data.pagePaths as unknown[]).length }} page{{
                (msg.data.pagePaths as unknown[]).length !== 1 ? 's' : ''
              }}
            </span>
            <router-link :to="`/jobs/${msg.data.jobId}`" class="goto-btn"
              >View Job &rarr;</router-link
            >
          </template>
          <template v-else-if="msg.event === 'job_failed'">
            Job <code>{{ shortId(msg.data.jobId as string) }}</code> failed: {{ msg.data.message }}
            <router-link :to="`/jobs/${msg.data.jobId}`" class="goto-btn goto-btn-error"
              >View Job &rarr;</router-link
            >
          </template>
          <template v-else>
            {{ JSON.stringify(msg.data) }}
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive, watch } from 'vue';
import type { AppConfig } from '../../shared/types/config.js';
import type {
  DiscoveredScannerRecord,
  ScannerCapabilityDetails,
} from '../../shared/types/domain.js';
import { useApi, type AnyPreset } from '../composables/useApi.js';
import PagePreview from '../components/PagePreview.vue';
import { useGlobalEvents } from '../composables/useEventStream.js';

const api = useApi();
const loaded = ref(false);
const runtimeConfig = ref<AppConfig | null>(null);
const discoveredScanners = ref<DiscoveredScannerRecord[]>([]);
const allPresets = ref<AnyPreset[]>([]);

const selectedProfileId = ref('');
const selectedScannerId = ref('');
const selectedPresetId = ref('__adhoc');
const isSubmitting = ref(false);
const isSavingPreset = ref(false);
const lastJobId = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const outputFilename = ref('');

// ─── Live page display ─────────────────────────────────────────────
interface LivePage {
  url: string;
  filename: string;
}
const livePages = ref<LivePage[]>([]);
const activeJobDone = ref(false);

const adhocSettings = reactive({
  source: 'Flatbed',
  mode: 'Color',
  resolutionDpi: 300,
});

// Capabilities for the currently selected discovered scanner
const selectedCaps = ref<ScannerCapabilityDetails | null>(null);

const profiles = computed(() => runtimeConfig.value?.profiles ?? []);
const configuredScanners = computed(() => runtimeConfig.value?.scanners ?? []);
const hasScanners = computed(() => configuredScanners.value.length > 0);

const isDiscoveredScanner = computed(() => {
  return discoveredScanners.value.some((s) => s.id === selectedScannerId.value);
});

const showAdHocSettings = computed(() => {
  return (
    selectedPresetId.value === '__adhoc' &&
    (hasScanners.value || discoveredScanners.value.length > 0)
  );
});

const canSubmit = computed(() => {
  return selectedProfileId.value && selectedScannerId.value;
});

// Dropdown options based on selected scanner capabilities
const adhocSources = computed(() => {
  if (selectedCaps.value) return selectedCaps.value.sources;
  return ['Flatbed', 'ADF Front', 'ADF Duplex'];
});

const adhocModes = computed(() => {
  if (selectedCaps.value) return selectedCaps.value.colorModes;
  return ['Color', 'Gray', 'Lineart'];
});

const adhocResolutions = computed(() => {
  if (selectedCaps.value) return selectedCaps.value.resolutionsDpi;
  return [75, 100, 150, 200, 300, 600, 1200];
});

const {
  isConnected: eventsConnected,
  hasConnected: eventsHasConnected,
  messages: eventMessages,
} = useGlobalEvents();

// Watch SSE messages and populate live page gallery for the active job
watch(
  eventMessages,
  (msgs) => {
    if (!lastJobId.value) return;
    const jobId = lastJobId.value;
    const knownUrls = new Set(livePages.value.map((p) => p.url));

    for (const msg of msgs) {
      if (msg.data.jobId !== jobId) continue;

      if (
        msg.event === 'job_progress' &&
        msg.data.pageUrl &&
        !knownUrls.has(msg.data.pageUrl as string)
      ) {
        const url = msg.data.pageUrl as string;
        const filename = (msg.data.filename as string) || `page_${livePages.value.length + 1}`;
        livePages.value = [...livePages.value, { url, filename }];
        knownUrls.add(url);
      }

      if (msg.event === 'job_succeeded' || msg.event === 'job_failed') {
        isSubmitting.value = false;
        activeJobDone.value = true;
      }
    }
  },
  { deep: true },
);

const eventIcon = (type: string): string => {
  switch (type) {
    case 'job_created':
      return '📋';
    case 'job_running':
      return '⏳';
    case 'job_progress':
      return '📄';
    case 'job_succeeded':
      return '✅';
    case 'job_failed':
      return '❌';
    default:
      return '💬';
  }
};

const eventLabel = (type: string): string => {
  switch (type) {
    case 'job_created':
      return 'Created';
    case 'job_running':
      return 'Scanning';
    case 'job_progress':
      return 'Progress';
    case 'job_succeeded':
      return 'Completed';
    case 'job_failed':
      return 'Failed';
    default:
      return type;
  }
};

const shortId = (id: string): string => id?.slice(0, 8) ?? '';

const formatEventTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return '';
  }
};

const onScannerChange = async (): Promise<void> => {
  selectedCaps.value = null;
  const discovered = discoveredScanners.value.find((s) => s.id === selectedScannerId.value);
  if (discovered) {
    if (discovered.capabilities) {
      selectedCaps.value = discovered.capabilities;
    } else {
      try {
        selectedCaps.value = await api.getDiscoveredCapabilities(discovered.id);
      } catch {
        // ignore
      }
    }
    // Set defaults from capabilities
    if (selectedCaps.value) {
      adhocSettings.source = selectedCaps.value.sources[0] ?? 'Flatbed';
      adhocSettings.mode = selectedCaps.value.colorModes[0] ?? 'Color';
      adhocSettings.resolutionDpi = selectedCaps.value.resolutionsDpi.includes(300)
        ? 300
        : (selectedCaps.value.resolutionsDpi[0] ?? 300);
    }
  }
};

const onPresetChange = (): void => {
  if (selectedPresetId.value !== '__adhoc') {
    const preset = allPresets.value.find((p) => p.id === selectedPresetId.value);
    if (preset) {
      if (preset.origin === 'config') {
        adhocSettings.source = preset.scan.source;
        adhocSettings.mode = preset.scan.mode;
        adhocSettings.resolutionDpi = preset.scan.resolutionDpi;
      } else {
        adhocSettings.source = preset.source;
        adhocSettings.mode = preset.mode;
        adhocSettings.resolutionDpi = preset.resolutionDpi;
      }
    }
  }
};

const submitJob = async (): Promise<void> => {
  isSubmitting.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  // Reset live page gallery for the new scan
  livePages.value = [];
  activeJobDone.value = false;

  try {
    const request: Record<string, unknown> = {
      profileId: selectedProfileId.value,
      scannerId: selectedScannerId.value,
      presetId: selectedPresetId.value === '__adhoc' ? '' : selectedPresetId.value,
    };

    // Include output filename if provided
    if (outputFilename.value.trim()) {
      request.outputFilename = outputFilename.value.trim();
    }

    // For ad-hoc or discovered scanners, send overrides
    if (selectedPresetId.value === '__adhoc' || isDiscoveredScanner.value) {
      const discovered = discoveredScanners.value.find((s) => s.id === selectedScannerId.value);
      request.overrides = {
        ...(discovered ? { device: discovered.device } : {}),
        source: adhocSettings.source,
        mode: adhocSettings.mode,
        resolutionDpi: adhocSettings.resolutionDpi,
      };
    }

    const job = await api.createJob(request as Parameters<typeof api.createJob>[0]);
    lastJobId.value = job.id;
    // Don't reset isSubmitting here — SSE watcher will do it when job finishes
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to submit job';
    isSubmitting.value = false;
  }
};

const saveAsPreset = async (): Promise<void> => {
  isSavingPreset.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const label = `${adhocSettings.mode} ${adhocSettings.resolutionDpi}dpi ${adhocSettings.source}`;
    await api.createPreset({
      label,
      scannerId: isDiscoveredScanner.value ? selectedScannerId.value : undefined,
      source: adhocSettings.source,
      mode: adhocSettings.mode,
      resolutionDpi: adhocSettings.resolutionDpi,
    });
    successMessage.value = `Preset "${label}" saved!`;
    allPresets.value = await api.getAllPresets();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to save preset';
  } finally {
    isSavingPreset.value = false;
  }
};

onMounted(async () => {
  try {
    const [config, scannersData, presets] = await Promise.all([
      api.getRuntimeConfig(),
      api.getScanners(),
      api.getAllPresets(),
    ]);

    runtimeConfig.value = config;
    discoveredScanners.value = scannersData.discovered;
    allPresets.value = presets;

    const firstProfile = config.profiles[0];
    selectedProfileId.value = firstProfile?.id ?? '';

    // Pick first configured scanner, or first discovered
    const firstConfigured = config.scanners[0];
    const firstDiscovered = scannersData.discovered[0];
    selectedScannerId.value = firstConfigured?.id ?? firstDiscovered?.id ?? '';

    // If using a discovered scanner, load its caps
    if (!firstConfigured && firstDiscovered) {
      await onScannerChange();
    }
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to load page data';
  } finally {
    loaded.value = true;
  }
});
</script>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.notice {
  padding: 1rem 1.25rem;
  border: 1px solid var(--notice-border);
  border-radius: 0.5rem;
  background: var(--notice-bg);
  color: var(--notice-text);
}

.notice p {
  margin: 0 0 0.25rem;
}

.notice-link {
  display: inline-block;
  margin-top: 0.5rem;
  color: var(--notice-link);
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
  color: var(--text-muted);
  font-size: 0.85rem;
}

select {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border-default);
  border-radius: 0.35rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.adhoc-panel {
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.adhoc-panel h4 {
  margin: 0 0 0.75rem;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.filename-row {
  max-width: 400px;
}

.filename-row label {
  display: grid;
  gap: 0.3rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.filename-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.filename-input::placeholder {
  color: var(--text-placeholder);
}

.optional {
  color: var(--text-faint);
  font-size: 0.75rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.btn-primary {
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 0.5rem;
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

.job-info code {
  padding: 0.15em 0.4em;
  border-radius: 0.25rem;
  background: var(--bg-surface);
  font-size: 0.8rem;
}

.job-link {
  margin-left: 0.75rem;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}

.job-link:hover {
  text-decoration: underline;
}

.error {
  color: var(--color-error);
}

.success {
  color: var(--color-success);
}

.muted {
  color: var(--text-faint);
  font-size: 0.85rem;
}

.event-list {
  display: grid;
  gap: 0.4rem;
  padding: 0;
  list-style: none;
}

.event-card {
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--border-default);
  border-radius: 0.4rem;
  background: var(--bg-surface);
}

.event-card.event-job_created {
  border-left-color: var(--color-warning);
}

.event-card.event-job_running {
  border-left-color: var(--event-running-border);
}

.event-card.event-job_progress {
  border-left-color: var(--event-progress-border);
}

.event-card.event-job_succeeded {
  border-left-color: var(--color-success);
}

.event-card.event-job_failed {
  border-left-color: var(--color-error);
}

.event-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.2rem;
  font-size: 0.75rem;
}

.event-icon {
  font-size: 0.85rem;
}

.event-label {
  color: var(--text-heading);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.event-time {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 0.7rem;
}

.event-body {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.event-body code {
  padding: 0.1em 0.35em;
  border-radius: 0.2rem;
  background: var(--bg-elevated);
  color: var(--text-heading);
  font-size: 0.75rem;
}

.goto-btn {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.2em 0.6em;
  border-radius: 0.3rem;
  background: var(--color-success);
  color: var(--bg-surface);
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: none;
}

.goto-btn:hover {
  background: var(--state-success-fg-hover);
}

.goto-btn-error {
  background: var(--color-error);
}

.goto-btn-error:hover {
  background: var(--state-error-fg-hover);
}

.event-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.connected {
  background: var(--color-success);
}

.status-dot.disconnected {
  background: var(--color-warning);
}

/* ── Live page gallery ──────────────────────────────────────────── */

.live-pages-section {
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-surface);
}

.live-pages-section h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  font-size: 1rem;
}

.page-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.4rem;
  border-radius: 9999px;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 0.75rem;
  font-weight: 700;
}

.live-pages-actions {
  margin-top: 0.75rem;
}
</style>
