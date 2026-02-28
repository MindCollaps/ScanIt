<template>
  <section class="page">
    <div class="page-header">
      <h2>Scan History</h2>
      <div class="header-actions">
        <button
          v-if="failedCount > 0"
          class="btn-danger-sm"
          :disabled="isDeleting"
          @click="deleteAllFailed"
        >
          {{ isDeleting ? 'Deleting...' : `Delete ${failedCount} Failed` }}
        </button>
        <button
          v-if="selectedIds.size > 0"
          class="btn-danger-sm"
          :disabled="isDeleting"
          @click="deleteSelected"
        >
          Delete {{ selectedIds.size }} Selected
        </button>
        <button class="btn-secondary" @click="load">Refresh</button>
      </div>
    </div>

    <p v-if="statusMsg" :class="statusMsg.startsWith('Error') ? 'error' : 'success'">
      {{ statusMsg }}
    </p>
    <p v-if="!jobs.length && !loading" class="muted">No scan jobs yet.</p>

    <table v-if="jobs.length">
      <thead>
        <tr>
          <th class="col-check">
            <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          </th>
          <th>Status</th>
          <th>Filename</th>
          <th>Correspondence</th>
          <th>Scanner</th>
          <th>Preset</th>
          <th>Created</th>
          <th>Duration</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in jobs"
          :key="item.id"
          class="clickable"
          @click="$router.push(`/jobs/${item.id}`)"
        >
          <td class="col-check" @click.stop>
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleSelect(item.id)"
            />
          </td>
          <td>
            <span :class="['state-badge', stateClass(item.state)]">{{ item.state }}</span>
          </td>
          <td class="truncate">{{ item.outputFilename || '—' }}</td>
          <td>{{ item.profileId }}</td>
          <td class="truncate">{{ item.scannerId }}</td>
          <td>{{ formatPreset(item.presetId) }}</td>
          <td>{{ formatDate(item.createdAt) }}</td>
          <td>{{ formatDuration(item) }}</td>
          <td>
            <router-link :to="`/jobs/${item.id}`" class="view-link">View &rarr;</router-link>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue';
import type { ScanJob } from '../../shared/types/domain.js';
import { useApi } from '../composables/useApi.js';
import { formatDate } from '../utils/formatters.js';

const api = useApi();
const jobs = ref<ScanJob[]>([]);
const loading = ref(true);
const isDeleting = ref(false);
const statusMsg = ref('');
const selectedIds = reactive(new Set<string>());

const failedCount = computed(() => jobs.value.filter((j) => j.state === 'FAILED').length);
const allSelected = computed(() => jobs.value.length > 0 && selectedIds.size === jobs.value.length);

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    jobs.value = await api.getHistory();
    selectedIds.clear();
  } catch (e: unknown) {
    statusMsg.value = e instanceof Error ? e.message : 'Failed to load history';
  } finally {
    loading.value = false;
  }
};

const stateClass = (state: string): string => {
  switch (state) {
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
};

const formatPreset = (presetId: string): string => {
  if (!presetId || presetId === 'adhoc') return 'Ad-hoc';
  return presetId;
};

const formatDuration = (job: ScanJob): string => {
  if (!job.startedAt || !job.finishedAt) {
    if (job.state === 'RUNNING') return 'In progress';
    if (job.state === 'PENDING') return 'Queued';
    return '—';
  }
  const ms = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const toggleSelect = (id: string): void => {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
};

const toggleAll = (): void => {
  if (allSelected.value) {
    selectedIds.clear();
  } else {
    for (const j of jobs.value) selectedIds.add(j.id);
  }
};

const deleteAllFailed = async (): Promise<void> => {
  if (!confirm(`Delete all ${failedCount.value} failed jobs and their files?`)) return;
  isDeleting.value = true;
  statusMsg.value = '';
  try {
    const res = await api.batchDeleteJobs({ state: 'FAILED' });
    statusMsg.value = `Deleted ${res.deleted} failed job(s)`;
    await load();
  } catch (e: unknown) {
    statusMsg.value = `Error: ${e instanceof Error ? e.message : 'Delete failed'}`;
  } finally {
    isDeleting.value = false;
  }
};

const deleteSelected = async (): Promise<void> => {
  const ids = [...selectedIds];
  if (!confirm(`Delete ${ids.length} selected job(s) and their files?`)) return;
  isDeleting.value = true;
  statusMsg.value = '';
  try {
    const res = await api.batchDeleteJobs({ ids });
    statusMsg.value = `Deleted ${res.deleted} job(s)`;
    await load();
  } catch (e: unknown) {
    statusMsg.value = `Error: ${e instanceof Error ? e.message : 'Delete failed'}`;
  } finally {
    isDeleting.value = false;
  }
};

onMounted(load);
</script>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  padding: 0.6rem 0.75rem;
  border-bottom: 2px solid var(--border-default);
  color: var(--text-faint);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
}

td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.85rem;
}

.col-check {
  width: 2rem;
  text-align: center;
}

.col-check input[type='checkbox'] {
  accent-color: var(--btn-primary-bg);
}

.clickable {
  cursor: pointer;
  transition: background 0.1s;
}

.clickable:hover {
  background: var(--bg-elevated);
}

.truncate {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state-badge {
  display: inline-block;
  padding: 0.15em 0.5em;
  border-radius: 0.25rem;
  font-size: 0.7rem;
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

.view-link {
  color: var(--accent);
  font-size: 0.8rem;
  text-decoration: none;
  white-space: nowrap;
}

.view-link:hover {
  text-decoration: underline;
}

.muted {
  color: var(--text-muted);
  font-size: 0.9rem;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
}
.success {
  color: var(--color-success);
  font-size: 0.85rem;
}

.btn-secondary {
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--btn-secondary-text);
  font-size: 0.8rem;
  cursor: pointer;
}

.btn-secondary:hover {
  border-color: var(--btn-secondary-border-hover);
  color: var(--btn-secondary-text-hover);
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
.btn-danger-sm:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
