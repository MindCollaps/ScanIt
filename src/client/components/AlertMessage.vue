<template>
  <p v-if="message" :class="['alert', `alert-${variant}`]">
    <slot>{{ message }}</slot>
  </p>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    message?: string;
    variant?: 'error' | 'success' | 'muted';
  }>(),
  { message: '', variant: 'error' },
);
</script>

<style scoped>
.alert {
  font-size: 0.85rem;
}

.alert-error {
  color: var(--color-error);
}

.alert-success {
  color: var(--color-success);
}

.alert-muted {
  color: var(--text-faint);
}
</style>
