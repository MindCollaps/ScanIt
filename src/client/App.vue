<template>
  <div class="layout">
    <header class="topbar">
      <h1>ScanIt</h1>
      <nav>
        <RouterLink to="/scan">Scan</RouterLink>
        <RouterLink to="/history">History</RouterLink>
        <RouterLink to="/config">Config</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
:global(body) {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell,
    Noto Sans, sans-serif;
  background: #0e1117;
  color: #f1f5f9;
}

.layout {
  min-height: 100vh;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #334155;
  background: #111827;
}

nav {
  display: flex;
  gap: 1rem;
}

a {
  color: #cbd5e1;
  text-decoration: none;
}

a.router-link-active {
  color: #38bdf8;
}

main {
  padding: 1.5rem;
}
</style>
