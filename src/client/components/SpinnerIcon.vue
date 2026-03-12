<template>
  <span class="spinner" :class="sizeClass" />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    size?: 'xs' | 'sm' | 'md' | 'lg';
  }>(),
  { size: 'md' },
);

const sizeClass = computed(() => `spinner-${props.size}`);
</script>

<style scoped>
.spinner {
  display: inline-block;
  border: 2px solid rgb(255 255 255 / 30%);
  border-top-color: var(--text-heading, #fff);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.spinner-xs {
  width: 0.6rem;
  height: 0.6rem;
  border-width: 1.5px;
  vertical-align: middle;
}

.spinner-sm {
  width: 0.7rem;
  height: 0.7rem;
  border-width: 1.5px;
  vertical-align: middle;
}

.spinner-md {
  width: 1.2rem;
  height: 1.2rem;
}

.spinner-lg {
  width: 2.5rem;
  height: 2.5rem;
  border-width: 3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
