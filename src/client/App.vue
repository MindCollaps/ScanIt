<template>
  <div class="layout">
    <header class="topbar">
      <h1>ScanIt</h1>
      <nav>
        <RouterLink to="/scan">Scan</RouterLink>
        <RouterLink to="/history">History</RouterLink>
        <RouterLink to="/config">Config</RouterLink>
        <RouterLink to="/diagnostics">Diagnostics</RouterLink>
      </nav>
      <p>
        <span
          :class="[
            'status-indicator',
            isConnected ? 'connected' : hasConnected ? 'disconnected' : 'connecting',
          ]"
        ></span>
        {{ isConnected ? 'Connected' : hasConnected ? 'Disconnected' : 'Connecting...' }}
      </p>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue';
import { useEventStream, EventStreamKey } from './composables/useEventStream.js';

const { isConnected, hasConnected, messages } = useEventStream();
provide(EventStreamKey, { isConnected, hasConnected, messages });
</script>

<style scoped>
:global(body) {
  margin: 0;
  background: var(--bg-body);
  color: var(--text-primary);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    Ubuntu,
    Cantarell,
    'Noto Sans',
    sans-serif;
}

.layout {
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-topbar);
}

nav {
  display: flex;
  gap: 1rem;
}

a {
  color: var(--text-secondary);
  text-decoration: none;
}

a.router-link-active {
  color: var(--accent);
}

main {
  padding: 1.5rem;
}
</style>
