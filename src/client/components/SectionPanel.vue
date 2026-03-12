<template>
  <div class="panel">
    <h4 v-if="title">{{ title }}</h4>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<style scoped>
.panel {
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.panel h4 {
  margin: 0 0 0.75rem;
  color: var(--text-heading);
  font-size: 0.9rem;
}
</style>
