<template>
  <section class="page">
    <div class="page-header">
      <router-link to="/history" class="back-link">&larr; History</router-link>
      <h2>Job Detail</h2>
      <button v-if="job && isTerminal" class="btn-danger-sm" @click="confirmDeleteJob">
        Delete Job
      </button>
    </div>

    <div v-if="loading" class="muted">Loading...</div>

    <template v-if="job">
      <!-- Job Info Card -->
      <div class="info-card">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Status</span>
            <span :class="['state-badge', stateClass]">{{ job.state }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Scanner</span>
            <span>{{ job.scannerId }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Preset</span>
            <span>{{ formatPreset(job.presetId) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Created</span>
            <span>{{ formatDate(job.createdAt) }}</span>
          </div>
          <div v-if="job.startedAt" class="info-item">
            <span class="info-label">Started</span>
            <span>{{ formatDate(job.startedAt) }}</span>
          </div>
          <div v-if="job.finishedAt" class="info-item">
            <span class="info-label">Finished</span>
            <span>{{ formatDate(job.finishedAt) }}</span>
          </div>
          <div v-if="job.startedAt && job.finishedAt" class="info-item">
            <span class="info-label">Duration</span>
            <span>{{ duration }}</span>
          </div>
          <div v-if="job.trigger" class="info-item">
            <span class="info-label">Triggered by</span>
            <span>{{ formatTrigger(job.trigger) }}</span>
          </div>
          <div v-if="job.consumers?.length" class="info-item info-item--wide">
            <span class="info-label">Consumers</span>
            <div class="consumer-pills">
              <span v-for="c in job.consumers" :key="c" class="consumer-pill">{{ formatConsumer(c) }}</span>
            </div>
          </div>
        </div>

        <!-- Editable output filename -->
        <div class="filename-section">
          <label class="info-label">Output Filename</label>
          <div class="filename-edit">
            <input
              v-model="editFilename"
              type="text"
              :placeholder="`scan_${job.id.slice(0, 8)}`"
              class="filename-input"
              @keyup.enter="saveFilename"
            />
            <button
              class="btn-secondary btn-sm"
              :disabled="isSavingFilename || editFilename === (job.outputFilename ?? '')"
              @click="saveFilename"
            >
              {{ isSavingFilename ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </div>

        <div v-if="job.errorMessage" class="error-banner">
          <strong>Error:</strong> {{ job.errorMessage }}
        </div>
      </div>

      <!-- Actions Bar -->
      <div v-if="pages.length || job.state === 'SUCCEEDED'" class="actions-bar">
        <a v-if="pages.length" :href="api.getJobPdfUrl(job.id)" class="btn-primary" download>
          Download PDF
        </a>
        <button
          v-if="(job.state === 'SUCCEEDED' || job.state === 'APPENDING') && job.scanParams"
          class="btn-secondary"
          :disabled="isAppending || job.state === 'APPENDING'"
          @click="appendPages"
        >
          {{ isAppending || job.state === 'APPENDING' ? 'Scanning...' : 'Scan More Pages' }}
        </button>
        <span v-if="pages.length" class="page-count"
          >{{ pages.length }} page{{ pages.length !== 1 ? 's' : '' }}</span
        >
      </div>

      <!-- Manual deliver panel -->
      <div
        v-if="job.state === 'SUCCEEDED' && deliverableConsumers.length"
        class="deliver-panel"
      >
        <span class="deliver-label">Send to:</span>
        <button
          v-for="c in deliverableConsumers"
          :key="c"
          class="btn-secondary btn-sm"
          :disabled="deliveringTo === c"
          @click="doDeliver(c)"
        >
          {{ deliveringTo === c ? 'Sending…' : formatConsumer(c) }}
        </button>
        <span v-if="deliverMessage" :class="deliverMessageClass" class="deliver-message">{{ deliverMessage }}</span>
      </div>

      <!-- Interleave Controls -->
      <div v-if="pages.length >= 2 && job.state === 'SUCCEEDED'" class="interleave-panel">
        <h4>Duplex Interleave</h4>
        <p class="help-text">
          Split pages into two batches and interleave them. Use after scanning front sides, then
          back sides separately.
        </p>
        <div class="interleave-controls">
          <label>
            Split after page
            <select v-model.number="splitIndex">
              <option v-for="i in pages.length - 1" :key="i" :value="i">{{ i }}</option>
            </select>
          </label>
          <label class="checkbox-label">
            <input v-model="reverseSecond" type="checkbox" />
            Reverse 2nd batch
          </label>
          <button class="btn-secondary" :disabled="isInterleaving" @click="doInterleave">
            {{ isInterleaving ? 'Interleaving...' : 'Interleave' }}
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
      <p v-if="successMessage" class="success">{{ successMessage }}</p>

      <!-- Scanned Pages with reorder -->
      <div v-if="pages.length" class="gallery">
        <div
          v-for="(page, idx) in pages"
          :key="page.filename"
          class="page-card"
          :class="{ dragging: dragIdx === idx, 'drop-target': dropIdx === idx }"
          draggable="true"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent="onDragOver(idx)"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop(idx)"
          @dragend="onDragEnd"
        >
          <div class="page-img-wrapper" @click="previewFrom(idx)">
            <img :src="page.url" :alt="`Page ${idx + 1}`" loading="lazy" />
            <span class="zoom-hint">&#128269;</span>
          </div>
          <div class="page-footer">
            <span class="page-number">{{ idx + 1 }}</span>
            <div class="page-actions">
              <button
                class="move-btn"
                :disabled="idx === 0"
                title="Move up"
                @click="movePage(idx, idx - 1)"
              >
                &#9650;
              </button>
              <button
                class="move-btn"
                :disabled="idx === pages.length - 1"
                title="Move down"
                @click="movePage(idx, idx + 1)"
              >
                &#9660;
              </button>
              <a :href="page.url" :download="page.filename" class="dl-icon" title="Download"
                >&#8681;</a
              >
              <button
                class="rotate-btn"
                title="Rotate 90°"
                :disabled="rotatingFile !== null"
                @click="rotateSinglePage(page.filename)"
              >
                <SpinnerIcon v-if="rotatingFile === page.filename" size="xs" />
                <template v-else>&#8635;</template>
              </button>
              <button
                class="del-btn"
                title="Delete page"
                @click="deleteSinglePage(page.filename)"
              >
                &#10005;
              </button>
            </div>
          </div>
        </div>
      </div>

      <p v-else-if="!loading && job.state === 'SUCCEEDED'" class="muted">No page images found.</p>
      <p
        v-else-if="
          !loading &&
          (job.state === 'RUNNING' || job.state === 'PENDING' || job.state === 'APPENDING')
        "
        class="muted"
      >
        {{ job.state === 'APPENDING' ? 'Scanning more pages...' : 'Scan in progress...' }}
      </p>

      <!-- Lightbox via the shared PagePreview component -->
      <PagePreview
        ref="previewRef"
        :pages="pages"
        :show-gallery="false"
        :deletable="true"
        :rotatable="true"
        :rotating-file="rotatingFile"
        @delete="onDeleteFromLightbox"
        @rotate="onRotateFromLightbox"
      />

      <!-- Events Timeline -->
      <div v-if="events.length" class="events-panel">
        <h4>Activity Log</h4>
        <ul class="events-list">
          <li v-for="(evt, i) in events" :key="i" class="event-item">
            <span class="event-dot" :class="eventDotClass(evt)" />
            <div class="event-body">
              <span class="event-type">{{ formatEventType(evt) }}</span>
              <span class="event-time">{{ formatDate(evt.createdAt) }}</span>
            </div>
            <span v-if="eventDetail(evt)" class="event-detail">{{ eventDetail(evt) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <div v-if="!loading && !job" class="muted">Job not found.</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ScanJob } from '../../shared/types/domain.js';
import { useApi, type JobPage, type JobEvent } from '../composables/useApi.js';
import PagePreview from '../components/PagePreview.vue';
import SpinnerIcon from '../components/SpinnerIcon.vue';
import { formatDate } from '../utils/formatters.js';

const route = useRoute();
const router = useRouter();
const api = useApi();

const previewRef = ref<InstanceType<typeof PagePreview> | null>(null);

const job = ref<ScanJob | null>(null);
const pages = ref<JobPage[]>([]);
const events = ref<JobEvent[]>([]);
const loading = ref(true);
const isAppending = ref(false);
const isInterleaving = ref(false);
const isSavingFilename = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const splitIndex = ref(1);
const reverseSecond = ref(false);
const editFilename = ref('');
const availableConsumers = ref<string[]>([]);
const deliveringTo = ref<string | null>(null);
const deliverMessage = ref('');
const deliverMessageClass = ref('');
let pollTimer: ReturnType<typeof setInterval> | undefined;

const dragIdx = ref<number | null>(null);
const dropIdx = ref<number | null>(null);

const previewFrom = (idx: number): void => {
  previewRef.value?.openLightbox(idx);
};

const isTerminal = computed(
  () => job.value?.state === 'SUCCEEDED' || job.value?.state === 'FAILED',
);

/** Consumers that accept manual delivery (skip filesystem — it's automatic) */
const deliverableConsumers = computed(() =>
  availableConsumers.value.filter((c) => c !== 'filesystem'),
);

const stateClass = computed(() => {
  switch (job.value?.state) {
    case 'SUCCEEDED':
      return 'state-success';
    case 'FAILED':
      return 'state-error';
    case 'RUNNING':
      return 'state-running';
    case 'APPENDING':
      return 'state-appending';
    case 'PENDING':
      return 'state-pending';
    default:
      return '';
  }
});

const duration = computed(() => {
  if (!job.value?.startedAt || !job.value?.finishedAt) return '';
  const ms = new Date(job.value.finishedAt).getTime() - new Date(job.value.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
});

const formatPreset = (presetId: string): string =>
  !presetId || presetId === 'adhoc' ? 'Ad-hoc' : presetId;

const formatTrigger = (trigger: string): string => {
  const map: Record<string, string> = {
    webui: 'Web UI',
    api: 'API',
    hassio: 'Home Assistant',
  };
  return map[trigger] ?? trigger;
};

const formatConsumer = (consumer: string): string => {
  if (consumer === 'filesystem') return 'Filesystem';
  const [type, id] = consumer.split(':');
  if (type && id) return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${id}`;
  return consumer;
};

const formatEventType = (evt: JobEvent): string => {
  const p = evt.payload;
  const consumer = typeof p.consumer === 'string' ? formatConsumer(p.consumer) : null;
  if (evt.eventType === 'delivery_completed') {
    return consumer ? `Delivered to ${consumer}` : 'Delivered';
  }
  if (evt.eventType === 'delivery_failed') {
    return consumer ? `Delivery failed (${consumer})` : 'Delivery Failed';
  }
  if (evt.eventType === 'delivery_skipped') {
    return consumer ? `Delivery skipped (${consumer})` : 'Delivery Skipped';
  }
  const map: Record<string, string> = {
    progress: 'Scan Progress',
    completed: 'Scan Completed',
    failed: 'Scan Failed',
    appended: 'Pages Appended',
  };
  return map[evt.eventType] ?? evt.eventType;
};

const eventDotClass = (evt: JobEvent): string => {
  const type = evt.eventType;
  if (type === 'completed' || type === 'appended') return 'dot-success';
  if (type === 'failed' || type === 'delivery_failed') return 'dot-error';
  if (type === 'delivery_completed') {
    return evt.payload.success === true ? 'dot-success' : 'dot-error';
  }
  if (type === 'delivery_skipped') return 'dot-warn';
  return 'dot-info';
};

const eventDetail = (evt: JobEvent): string => {
  const p = evt.payload;
  if (evt.eventType === 'progress' && typeof p.percent === 'number') {
    return `${p.percent}%`;
  }
  if (evt.eventType === 'completed' && Array.isArray(p.pagePaths)) {
    return `${p.pagePaths.length} page(s) scanned`;
  }
  if (evt.eventType === 'appended' && Array.isArray(p.newPages)) {
    return `${p.newPages.length} page(s) added`;
  }
  if (evt.eventType === 'failed' && typeof p.message === 'string') {
    return p.message;
  }
  if (
    (evt.eventType === 'delivery_completed' || evt.eventType === 'delivery_failed') &&
    typeof p.error === 'string'
  ) {
    return p.error;
  }
  return '';
};

const loadJob = async (): Promise<void> => {
  const jobId = route.params.jobId as string;
  try {
    job.value = await api.getJob(jobId);
    if (job.value) editFilename.value = job.value.outputFilename ?? '';
    // Load pages for terminal states AND while appending (existing pages are still viewable)
    if (
      job.value?.state === 'SUCCEEDED' ||
      job.value?.state === 'FAILED' ||
      job.value?.state === 'APPENDING'
    ) {
      pages.value = (await api.getJobPages(jobId)).map((p) => ({
        ...p,
        url: `${p.url}?t=${Date.now()}`,
      }));
      events.value = await api.getJobEvents(jobId);
      if (pages.value.length >= 2) splitIndex.value = Math.ceil(pages.value.length / 2);
      // Stop polling only when fully terminal
      if ((job.value?.state === 'SUCCEEDED' || job.value?.state === 'FAILED') && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }
  } catch {
    job.value = null;
  } finally {
    loading.value = false;
  }
};

const appendPages = async (): Promise<void> => {
  if (!job.value) return;
  isAppending.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const res = await api.appendToJob(job.value.id);
    successMessage.value = `Added ${res.newPages.length} page(s)`;
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Append failed';
  } finally {
    isAppending.value = false;
  }
};

const doInterleave = async (): Promise<void> => {
  if (!job.value) return;
  isInterleaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await api.interleavePages(job.value.id, splitIndex.value, reverseSecond.value);
    successMessage.value = 'Pages interleaved';
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Interleave failed';
  } finally {
    isInterleaving.value = false;
  }
};

const movePage = async (from: number, to: number): Promise<void> => {
  if (!job.value || to < 0 || to >= pages.value.length) return;
  const names = pages.value.map((p) => p.filename);
  const item = names.splice(from, 1)[0];
  if (!item) return;
  names.splice(to, 0, item);
  try {
    await api.reorderPages(job.value.id, names);
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Reorder failed';
  }
};

const onDragStart = (idx: number, ev: DragEvent): void => {
  dragIdx.value = idx;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', String(idx));
  }
};
const onDragOver = (idx: number): void => {
  dropIdx.value = idx;
};
const onDragLeave = (): void => {
  dropIdx.value = null;
};
const onDrop = async (toIdx: number): Promise<void> => {
  const from = dragIdx.value;
  dragIdx.value = null;
  dropIdx.value = null;
  if (from === null || from === toIdx || !job.value) return;
  const names = pages.value.map((p) => p.filename);
  const item = names.splice(from, 1)[0];
  if (!item) return;
  names.splice(toIdx, 0, item);
  try {
    await api.reorderPages(job.value.id, names);
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Reorder failed';
  }
};
const onDragEnd = (): void => {
  dragIdx.value = null;
  dropIdx.value = null;
};

const confirmDeleteJob = async (): Promise<void> => {
  if (!job.value || !confirm('Delete this job and all its scanned pages?')) return;
  try {
    await api.deleteJob(job.value.id);
    router.push('/history');
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Delete failed';
  }
};

const deleteSinglePage = async (filename: string): Promise<void> => {
  if (!job.value || !confirm(`Delete page "${filename}"?`)) return;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await api.deletePage(job.value.id, filename);
    successMessage.value = 'Page deleted';
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Delete page failed';
  }
};

const rotatingFile = ref<string | null>(null);

const rotateSinglePage = async (filename: string, degrees = 90): Promise<void> => {
  if (!job.value) return;
  errorMessage.value = '';
  successMessage.value = '';
  rotatingFile.value = filename;
  try {
    await api.rotatePage(job.value.id, filename, degrees);
    successMessage.value = `Page rotated ${degrees}°`;
    await loadJob();
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Rotate failed';
  } finally {
    rotatingFile.value = null;
  }
};

const onDeleteFromLightbox = async (idx: number): Promise<void> => {
  const page = pages.value[idx];
  if (!page || !job.value) return;
  await deleteSinglePage(page.filename);
  // Adjust lightbox index after deletion if it was open
  if (previewRef.value) {
    if (pages.value.length === 0) {
      previewRef.value.openLightbox(-1); // will close
    } else if (idx >= pages.value.length) {
      previewRef.value.openLightbox(pages.value.length - 1);
    } else {
      previewRef.value.openLightbox(idx);
    }
  }
};

const onRotateFromLightbox = async (idx: number): Promise<void> => {
  const page = pages.value[idx];
  if (!page || !job.value) return;
  await rotateSinglePage(page.filename);
  // Re-open lightbox at same index to show rotated image
  if (previewRef.value) {
    previewRef.value.openLightbox(idx);
  }
};

const doDeliver = async (consumer: string): Promise<void> => {
  if (!job.value || deliveringTo.value) return;
  deliveringTo.value = consumer;
  deliverMessage.value = '';
  try {
    const result = await api.deliverJob(job.value.id, consumer);
    if (result.success) {
      deliverMessage.value = `Sent to ${formatConsumer(consumer)}`;
      deliverMessageClass.value = 'deliver-ok';
    } else {
      deliverMessage.value = result.error ?? 'Delivery failed';
      deliverMessageClass.value = 'deliver-err';
    }
    // Reload events so the new delivery_completed entry appears
    events.value = await api.getJobEvents(job.value.id);
  } catch (e: unknown) {
    deliverMessage.value = e instanceof Error ? e.message : 'Delivery failed';
    deliverMessageClass.value = 'deliver-err';
  } finally {
    deliveringTo.value = null;
  }
};

const saveFilename = async (): Promise<void> => {
  if (!job.value) return;
  const newName = editFilename.value.trim();
  if (newName === (job.value.outputFilename ?? '')) return;
  isSavingFilename.value = true;
  errorMessage.value = '';
  try {
    await api.updateOutputFilename(job.value.id, newName);
    job.value = { ...job.value, outputFilename: newName };
    successMessage.value = newName ? `Filename set to "${newName}"` : 'Filename cleared';
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : 'Failed to update filename';
  } finally {
    isSavingFilename.value = false;
  }
};

onMounted(async () => {
  await loadJob();
  // Also load events for terminal jobs that didn't enter the if-block above
  if (job.value && !events.value.length) {
    try {
      events.value = await api.getJobEvents(route.params.jobId as string);
    } catch {
      /* non-critical */
    }
  }
  try {
    availableConsumers.value = await api.getAvailableConsumers();
  } catch {
    /* non-critical */
  }
  if (
    job.value &&
    (job.value.state === 'PENDING' ||
      job.value.state === 'RUNNING' ||
      job.value.state === 'APPENDING')
  ) {
    pollTimer = setInterval(loadJob, 2000);
  }
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.page {
  display: grid;
  gap: 1.25rem;
}
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.page-header h2 {
  flex: 1;
}
.back-link {
  color: var(--text-muted);
  font-size: 0.9rem;
  text-decoration: none;
}
.back-link:hover {
  color: var(--text-heading);
}

.info-card {
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}
.info-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.info-item--wide {
  grid-column: 1 / -1;
}
.consumer-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.1rem;
}
.consumer-pill {
  display: inline-block;
  padding: 0.15em 0.55em;
  border: 1px solid var(--border-default);
  border-radius: 1rem;
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-family: monospace;
}
.info-label {
  color: var(--text-faint);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.state-badge {
  display: inline-block;
  width: fit-content;
  padding: 0.15em 0.5em;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}
.state-success {
  background: var(--state-success-bg);
  color: var(--state-success-fg);
}
.state-error {
  background: var(--state-error-bg);
  color: var(--state-error-fg);
}
.state-running {
  background: var(--state-running-bg);
  color: var(--state-running-fg);
}
.state-pending {
  background: var(--state-pending-bg);
  color: var(--state-pending-fg);
}
.state-appending {
  background: var(--state-appending-bg);
  color: var(--state-appending-fg);
}

.error-banner {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-error-banner-border);
  border-radius: 0.4rem;
  background: var(--color-error-banner-bg);
  color: var(--color-error-banner-text);
  font-size: 0.85rem;
  word-break: break-word;
}

.filename-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 1rem;
}
.filename-edit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 400px;
}
.filename-input {
  flex: 1;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.85rem;
}
.filename-input::placeholder {
  color: var(--text-placeholder);
}
.btn-sm {
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
}

.actions-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.page-count {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.25rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
.btn-primary:hover {
  background: var(--btn-primary-bg-hover);
}

.btn-secondary {
  padding: 0.55rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.85rem;
  cursor: pointer;
}
.btn-secondary:hover {
  border-color: var(--border-hover);
  color: var(--text-heading);
}
.btn-secondary:disabled {
  cursor: default;
  opacity: 0.5;
}

.btn-danger-sm {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--btn-danger-border);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--color-error);
  font-size: 0.8rem;
  cursor: pointer;
}
.btn-danger-sm:hover {
  background: var(--btn-danger-bg-hover);
}

.interleave-panel {
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}
.interleave-panel h4 {
  margin: 0 0 0.25rem;
  color: var(--text-heading);
  font-size: 0.9rem;
}
.help-text {
  margin: 0 0 0.75rem;
  color: var(--text-faint);
  font-size: 0.8rem;
}
.interleave-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
}
.interleave-controls label {
  display: grid;
  gap: 0.3rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}
.interleave-controls select {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.85rem;
}
.checkbox-label {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}
.checkbox-label input[type='checkbox'] {
  accent-color: var(--btn-primary-bg);
}

.error {
  color: var(--color-error);
  font-size: 0.85rem;
}
.success {
  color: var(--color-success);
  font-size: 0.85rem;
}

.gallery {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.page-card {
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-surface);
  cursor: grab;
  transition:
    border-color 0.15s,
    opacity 0.15s,
    transform 0.15s;
}
.page-card:active {
  cursor: grabbing;
}
.page-card.dragging {
  opacity: 0.4;
  transform: scale(0.95);
}
.page-card.drop-target {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--overlay-glow);
}

.page-img-wrapper {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  aspect-ratio: 210 / 297;
  overflow: hidden;
  background: var(--bg-elevated);
  cursor: pointer;
}
.page-img-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.zoom-hint {
  position: absolute;
  right: 0.4rem;
  bottom: 0.4rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.3rem;
  background: var(--overlay-nav);
  font-size: 0.85rem;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s;
}
.page-img-wrapper:hover .zoom-hint {
  opacity: 1;
}

.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.6rem;
  border-top: 1px solid var(--border-default);
  font-size: 0.8rem;
}
.page-number {
  color: var(--text-heading);
  font-size: 0.9rem;
  font-weight: 700;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.move-btn {
  padding: 0.15rem 0.35rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.65rem;
  line-height: 1;
  cursor: pointer;
}
.move-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-heading);
}
.move-btn:disabled {
  cursor: default;
  opacity: 0.3;
}

.dl-icon {
  color: var(--accent);
  font-size: 1rem;
  line-height: 1;
  text-decoration: none;
}
.dl-icon:hover {
  color: var(--accent-secondary);
}

.rotate-btn {
  padding: 0.15rem 0.35rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
}
.rotate-btn:hover:not(:disabled) {
  border-color: var(--btn-primary-bg);
  color: var(--text-heading);
}
.rotate-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.del-btn {
  padding: 0.15rem 0.35rem;
  border: 1px solid var(--btn-danger-border);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--color-error);
  font-size: 0.65rem;
  line-height: 1;
  cursor: pointer;
}
.del-btn:hover {
  background: var(--btn-danger-bg-hover);
}

/* ── Events Timeline ────────────────────────────────────────── */
.events-panel {
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}
.events-panel h4 {
  margin: 0 0 0.75rem;
  color: var(--text-heading);
  font-size: 0.9rem;
}
.events-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.event-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-default);
  font-size: 0.8rem;
}
.event-item:last-child {
  border-bottom: none;
}
.event-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}
.dot-success {
  background: var(--color-success);
}
.dot-error {
  background: var(--color-error);
}
.dot-warn {
  background: var(--color-warning, #f59e0b);
}
.dot-info {
  background: var(--accent);
}

/* ── Manual Deliver ─────────────────────────────────────────── */
.deliver-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}
.deliver-label {
  color: var(--text-faint);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: 0.25rem;
}
.deliver-message {
  font-size: 0.8rem;
  margin-left: 0.25rem;
}
.deliver-ok {
  color: var(--color-success);
}
.deliver-err {
  color: var(--color-error);
}
.event-body {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
}
.event-type {
  color: var(--text-heading);
  font-weight: 600;
}
.event-time {
  color: var(--text-faint);
  font-size: 0.7rem;
}
.event-detail {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-align: right;
}

.muted {
  color: var(--text-faint);
  font-size: 0.9rem;
}
</style>
