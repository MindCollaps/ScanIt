<template>
  <span class="state-badge" :class="variantClass">
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { JobState } from '../../shared/types/domain.js';

const props = defineProps<{
  state: JobState;
  label?: string;
}>();

const stateMap: Record<JobState, string> = {
  SUCCEEDED: 'state-success',
  FAILED: 'state-error',
  RUNNING: 'state-running',
  HOLD: 'state-hold',
  PENDING: 'state-pending',
  APPENDING: 'state-appending',
  CANCELED: 'state-pending',
};

const variantClass = computed(() => stateMap[props.state] ?? 'state-pending');
</script>

<style scoped>
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

.state-hold {
  background: var(--state-hold-bg);
  color: var(--state-hold-fg);
}

.state-pending {
  background: var(--state-pending-bg);
  color: var(--state-pending-fg);
}

.state-appending {
  background: var(--state-appending-bg);
  color: var(--state-appending-fg);
}
</style>
