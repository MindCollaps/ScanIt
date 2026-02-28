<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('cancel')">
      <div class="modal-card">
        <h3>Confirm SANE Config Change</h3>
        <p class="modal-desc">This will write the following to your SANE configuration:</p>
        <div class="rec-config">
          <code>{{ props.recommendation.configFile }}</code>
          <pre class="rec-line">{{ props.recommendation.configLine }}</pre>
        </div>
        <p class="muted-text">{{ props.recommendation.description }}</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
          <button class="btn-primary" :disabled="props.applying" @click="emit('confirm')">
            {{ props.applying ? 'Applying...' : 'Confirm & Apply' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { SaneRecommendation } from '../../shared/types/domain.js';

const props = defineProps<{
  recommendation: SaneRecommendation;
  applying: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-modal);
}

.modal-card {
  width: 90%;
  max-width: 500px;
  padding: 1.5rem;
  border: 1px solid var(--border-default);
  border-radius: 0.75rem;
  background: var(--bg-elevated);
}

.modal-card h3 {
  margin: 0 0 0.75rem;
  color: var(--text-heading);
  font-size: 1.05rem;
}

.modal-desc {
  margin: 0 0 0.75rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.rec-config {
  margin-bottom: 0.75rem;
}

.rec-config code {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.rec-line {
  margin: 0.25rem 0 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border-default);
  border-radius: 0.3rem;
  background: var(--bg-surface);
  color: var(--accent);
  font-family: monospace;
  font-size: 0.8rem;
}

.muted-text {
  color: var(--text-faint);
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
</style>
