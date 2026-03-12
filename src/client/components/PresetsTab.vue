<template>
  <div class="tab-content">
    <div class="section-header">
      <h3>Preset Builder</h3>
    </div>

    <!-- Preset creation form -->
    <div class="preset-builder">
      <p v-if="!discoveredScanners.length && !configuredScanners.length" class="muted-text">
        Discover scanners first to build presets from their actual capabilities.
      </p>

      <div class="form-grid">
        <label>
          Label
          <input
            :value="presetForm.label"
            type="text"
            placeholder="My Scan Preset"
            @input="updateField('label', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label>
          Based on Scanner
          <select
            :value="presetForm.scannerId"
            @change="
              updateField('scannerId', ($event.target as HTMLSelectElement).value);
              emit('scannerChange');
            "
          >
            <option value="">Any scanner</option>
            <optgroup label="Discovered">
              <option v-for="s in discoveredScanners" :key="s.id" :value="s.id">
                {{ s.label }}
              </option>
            </optgroup>
            <optgroup v-if="configuredScanners.length" label="Configured">
              <option v-for="s in configuredScanners" :key="s.id" :value="s.id">
                {{ s.label }}
              </option>
            </optgroup>
          </select>
        </label>

        <label>
          Source
          <select
            :value="presetForm.source"
            @change="updateField('source', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="s in availableSources" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>

        <label>
          Color Mode
          <select
            :value="presetForm.mode"
            @change="updateField('mode', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in availableModes" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>

        <label>
          Resolution (DPI)
          <select
            :value="presetForm.resolutionDpi"
            @change="
              updateField('resolutionDpi', Number(($event.target as HTMLSelectElement).value))
            "
          >
            <option v-for="r in availableResolutions" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>

        <label>
          Page Size
          <select
            :value="presetForm.pageSize"
            @change="updateField('pageSize', ($event.target as HTMLSelectElement).value)"
          >
            <option value="A4">A4</option>
            <option value="A3">A3</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
            <option value="Auto">Auto</option>
          </select>
        </label>

        <label>
          Brightness ({{ presetForm.brightness }})
          <input
            :value="presetForm.brightness"
            type="range"
            min="-50"
            max="50"
            @input="updateField('brightness', Number(($event.target as HTMLInputElement).value))"
          />
        </label>

        <label>
          Contrast ({{ presetForm.contrast }})
          <input
            :value="presetForm.contrast"
            type="range"
            min="-50"
            max="50"
            @input="updateField('contrast', Number(($event.target as HTMLInputElement).value))"
          />
        </label>

        <label>
          Output Format
          <select
            :value="presetForm.outputFormat"
            @change="updateField('outputFormat', ($event.target as HTMLSelectElement).value)"
          >
            <option value="pdf">PDF</option>
            <option value="images">Images</option>
          </select>
        </label>

        <label v-if="presetForm.outputFormat === 'images'">
          Image Format
          <select
            :value="presetForm.imageFormat"
            @change="updateField('imageFormat', ($event.target as HTMLSelectElement).value)"
          >
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="tiff">TIFF</option>
          </select>
        </label>
      </div>

      <!-- Consumers -->
      <div v-if="availableConsumers.length" class="consumers-section">
        <span class="consumers-label">
          Consumers <span class="optional">(where scan output goes)</span>
        </span>
        <div class="consumer-checkboxes">
          <label v-for="c in availableConsumers" :key="c" class="consumer-check">
            <input
              type="checkbox"
              :value="c"
              :checked="presetForm.consumers?.includes(c)"
              @change="toggleConsumer(c)"
            />
            {{ c }}
          </label>
        </div>
      </div>

      <button
        class="btn-primary"
        :disabled="!presetForm.label || isSavingPreset"
        @click="emit('save')"
      >
        {{ isSavingPreset ? 'Saving...' : editingPresetId ? 'Update Preset' : 'Create Preset' }}
      </button>
      <button v-if="editingPresetId" class="btn-secondary" @click="emit('reset')">
        Cancel Edit
      </button>
      <p v-if="presetError" class="error">{{ presetError }}</p>
      <p v-if="presetSuccess" class="success">{{ presetSuccess }}</p>
    </div>

    <!-- Existing presets -->
    <div class="section-header" style="margin-top: 1.5rem">
      <h3>All Presets</h3>
      <button class="btn-secondary" @click="emit('refresh')">Refresh</button>
    </div>

    <div class="card-grid">
      <div v-for="preset in allPresets" :key="preset.id" class="card">
        <div class="card-header">
          <span class="card-title">{{ preset.label }}</span>
          <span :class="['badge', preset.origin === 'config' ? 'config' : '']">
            {{ preset.origin }}
          </span>
        </div>
        <div class="card-id-row">
          <code class="card-id">{{ preset.id }}</code>
          <button class="btn-copy" title="Copy preset ID" @click="copyPresetId(preset.id)">
            {{ copiedId === preset.id ? '✓' : '⧉' }}
          </button>
        </div>
        <div class="card-meta">
          <template v-if="preset.origin === 'config'">
            {{ preset.scan.source }} · {{ preset.scan.mode }} · {{ preset.scan.resolutionDpi }} DPI
          </template>
          <template v-else>
            {{ preset.source }} · {{ preset.mode }} · {{ preset.resolutionDpi }} DPI
          </template>
        </div>
        <div
          v-if="preset.origin === 'user' && preset.consumers?.length"
          class="card-consumers"
        >
          Consumers: {{ preset.consumers.join(', ') }}
        </div>
        <div v-if="preset.origin === 'user'" class="card-actions">
          <button class="btn-sm" @click="emit('edit', preset as any)">Edit</button>
          <button class="btn-sm btn-danger" @click="emit('remove', preset.id)">Delete</button>
        </div>
      </div>
    </div>

    <p v-if="!allPresets.length" class="muted-text">No presets yet.</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ScannerDefinition } from '../../shared/types/config.js';
import type { DiscoveredScannerRecord, UserPreset } from '../../shared/types/domain.js';
import type { AnyPreset } from '../composables/useApi.js';

const props = defineProps<{
  discoveredScanners: DiscoveredScannerRecord[];
  configuredScanners: ScannerDefinition[];
  allPresets: AnyPreset[];
  editingPresetId: string;
  isSavingPreset: boolean;
  presetError: string;
  presetSuccess: string;
  presetForm: ReturnType<typeof Object>;
  availableSources: string[];
  availableModes: string[];
  availableResolutions: number[];
  availableConsumers: string[];
}>();

const emit = defineEmits<{
  'update:presetForm': [field: string, value: unknown];
  save: [];
  edit: [preset: UserPreset];
  remove: [id: string];
  reset: [];
  refresh: [];
  scannerChange: [];
}>();

// Two-way binding helpers via emit
const updateField = (field: string, value: unknown) => emit('update:presetForm', field, value);

const copiedId = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const copyPresetId = async (id: string) => {
  await navigator.clipboard.writeText(id);
  copiedId.value = id;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedId.value = ''; }, 1500);
};

const toggleConsumer = (consumer: string) => {
  const current: string[] = (props.presetForm as Record<string, unknown>).consumers as string[] ?? [];
  const next = current.includes(consumer)
    ? current.filter((c: string) => c !== consumer)
    : [...current, consumer];
  updateField('consumers', next);
};
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

.preset-builder {
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.form-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  margin-bottom: 1rem;
}

.form-grid label {
  display: grid;
  gap: 0.3rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

input[type='text'],
select {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border-default);
  border-radius: 0.35rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.9rem;
}

input[type='range'] {
  width: 100%;
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

.card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
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

.muted-text {
  color: var(--text-faint);
  font-size: 0.9rem;
}

.error {
  color: var(--color-error);
  font-size: 0.9rem;
}

.success {
  color: var(--color-success);
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

.btn-sm {
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.btn-sm:hover {
  border-color: var(--border-hover);
  color: var(--text-heading);
}

.btn-danger {
  border-color: var(--btn-danger-border-alt);
  color: var(--color-error);
}

.btn-danger:hover {
  border-color: var(--btn-danger-border-alt-hover);
  color: var(--btn-danger-text-hover);
}

.consumers-section {
  margin-bottom: 1rem;
}

.consumers-label {
  display: block;
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
}

.optional {
  color: var(--text-faint);
  font-size: 0.75rem;
}

.consumer-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
}

.consumer-check {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9rem;
  color: var(--text-primary);
  cursor: pointer;
}

.card-id-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}

.card-id {
  padding: 0.15em 0.45em;
  border-radius: 0.25rem;
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: 0.75rem;
  user-select: all;
}

.btn-copy {
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--border-default);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  line-height: 1;
}

.btn-copy:hover {
  border-color: var(--border-hover);
  color: var(--text-heading);
}

.card-consumers {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
}
</style>
