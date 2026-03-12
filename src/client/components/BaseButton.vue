<template>
  <button :class="['btn', `btn-${variant}`, { 'btn-sm': size === 'sm' }]" :disabled="disabled || loading" v-bind="$attrs">
    <SpinnerIcon v-if="loading" :size="size === 'sm' ? 'xs' : 'sm'" />
    <slot />
  </button>
</template>

<script setup lang="ts">
import SpinnerIcon from './SpinnerIcon.vue';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'danger-sm';
    size?: 'md' | 'sm';
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { variant: 'secondary', size: 'md', disabled: false, loading: false },
);
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.btn:disabled {
  cursor: default;
  opacity: 0.5;
}

/* ── Primary ──────────────────────────────── */
.btn-primary {
  padding: 0.6rem 1.25rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  font-size: 0.9rem;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: var(--btn-primary-bg-hover);
}

/* ── Secondary ────────────────────────────── */
.btn-secondary {
  padding: 0.55rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-heading);
}

/* ── Danger ────────────────────────────────── */
.btn-danger {
  padding: 0.55rem 1rem;
  border: 1px solid var(--btn-danger-border);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--color-error);
  font-size: 0.85rem;
}

.btn-danger:hover:not(:disabled) {
  background: var(--btn-danger-bg-hover);
}

/* ── Danger Small ─────────────────────────── */
.btn-danger-sm {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--btn-danger-border);
  border-radius: 0.4rem;
  background: transparent;
  color: var(--color-error);
  font-size: 0.8rem;
}

.btn-danger-sm:hover:not(:disabled) {
  background: var(--btn-danger-bg-hover);
}

/* ── Small size modifier ──────────────────── */
.btn-sm {
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
}
</style>
