<template>
  <div class="diag-report">
    <!-- System Info (collapsible) -->
    <details class="diag-section">
      <summary class="diag-summary">System Info</summary>
      <div class="diag-kv-grid" style="margin-top: 0.5rem">
        <div class="diag-kv">
          <span class="diag-key">SANE version</span>
          <span class="diag-val">{{ report.saneVersion ?? 'Not installed' }}</span>
        </div>
        <div class="diag-kv">
          <span class="diag-key">Avahi (mDNS)</span>
          <span :class="['diag-val', report.avahiRunning ? 'ok' : 'warn']">
            {{ report.avahiRunning ? 'Running' : 'Not running' }}
          </span>
        </div>
        <div class="diag-kv">
          <span class="diag-key">Config directory</span>
          <code class="diag-val">{{ report.configDir }}</code>
        </div>
        <div class="diag-kv">
          <span class="diag-key">Config writable</span>
          <span :class="['diag-val', report.configWritable ? 'ok' : 'warn']">
            {{ report.configWritable ? 'Yes' : 'No' }}
          </span>
        </div>
        <div v-if="report.configWriteError" class="diag-kv">
          <span class="diag-key">Write error</span>
          <code class="diag-val warn">{{ report.configWriteError }}</code>
        </div>
        <div class="diag-kv">
          <span class="diag-key">Backends enabled</span>
          <span class="diag-val">{{ report.backendsEnabled.length }}</span>
        </div>
      </div>
    </details>

    <!-- Network Scanners (mDNS) -->
    <div class="diag-section">
      <h4>
        Network Scanners (mDNS) · {{ groupedMdnsScanners.length }} device{{
          groupedMdnsScanners.length !== 1 ? 's' : ''
        }}
      </h4>
      <div v-if="groupedMdnsScanners.length" class="card-grid">
        <div v-for="g in groupedMdnsScanners" :key="g.address" class="card">
          <div class="card-header">
            <span class="card-title">{{ g.name }}</span>
            <div class="badge-group">
              <span v-for="p in uniqueProtocols(g)" :key="p" class="badge">{{ p }}</span>
            </div>
          </div>
          <div class="card-meta">
            <code>{{ g.address }}</code>
          </div>
          <details v-if="g.services.length > 1" class="services-details">
            <summary class="services-summary">{{ g.services.length }} services</summary>
            <div class="services-list">
              <div v-for="svc in g.services" :key="svc.serviceType" class="service-row">
                <code class="service-type">{{ svc.serviceType }}</code>
                <span class="service-meta">:{{ svc.port }} · {{ svc.protocol }}</span>
              </div>
            </div>
          </details>
          <div v-else class="card-meta">
            <code class="service-type">{{ g.services[0]?.serviceType }}</code>
            <span class="service-meta"> :{{ g.services[0]?.port }}</span>
          </div>
        </div>
      </div>
      <p v-else class="muted-text">
        No scanners found via mDNS. Is your scanner powered on and on the same network?
      </p>
    </div>

    <!-- SANE Devices -->
    <div class="diag-section">
      <h4>SANE Devices (scanimage -L)</h4>
      <div v-if="report.saneDevices.length" class="card-grid">
        <div v-for="d in report.saneDevices" :key="d.device" class="card">
          <div class="card-header">
            <span class="card-title">{{ d.label }}</span>
          </div>
          <div class="card-meta">
            <code>{{ d.device }}</code>
          </div>
        </div>
      </div>
      <p v-else class="muted-text">No devices found by SANE. Check recommendations below.</p>
    </div>

    <!-- Unreachable Scanners -->
    <div v-if="groupedUnreachable.length" class="diag-section">
      <h4>Unreachable Scanners</h4>
      <p class="muted-text" style="margin-bottom: 0.5rem">
        These scanners are visible on the network but not accessible to SANE:
      </p>
      <div class="card-grid">
        <div v-for="g in groupedUnreachable" :key="g.address" class="card warn-card">
          <div class="card-header">
            <span class="card-title">{{ g.name }}</span>
            <span class="badge warn-badge">unreachable</span>
          </div>
          <div class="card-meta">
            <code>{{ g.address }}</code>
            · {{ uniqueProtocols(g).join(', ') }}
          </div>
          <details v-if="g.services.length > 1" class="services-details">
            <summary class="services-summary">{{ g.services.length }} services</summary>
            <div class="services-list">
              <div v-for="svc in g.services" :key="svc.serviceType" class="service-row">
                <code class="service-type">{{ svc.serviceType }}</code>
                <span class="service-meta">:{{ svc.port }} · {{ svc.protocol }}</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    <div v-if="report.recommendations.length" class="diag-section">
      <h4>Recommendations</h4>
      <div class="rec-list">
        <div v-for="(rec, idx) in report.recommendations" :key="idx" class="rec-card">
          <div class="rec-header">
            <span class="rec-type-badge">{{ rec.type.replace(/_/g, ' ') }}</span>
            <span class="rec-backend">{{ rec.backend }}</span>
          </div>
          <p class="rec-description">{{ rec.description }}</p>
          <div v-if="rec.configLine" class="rec-config">
            <code>{{ rec.configFile }}</code>
            <pre class="rec-line">{{ rec.configLine }}</pre>
          </div>
          <div class="rec-actions">
            <button
              v-if="rec.autoApplicable"
              class="btn-primary"
              :disabled="applyingIdx !== null"
              @click="emit('apply', rec, idx)"
            >
              Add to SANE Config
            </button>
            <span v-else class="muted-text">
              Manual fix required (no write permission — run in Docker or as root)
            </span>
          </div>
          <p v-if="applyError && applyingIdx === idx" class="error">{{ applyError }}</p>
          <p v-if="applySuccess && lastAppliedIdx === idx" class="success">{{ applySuccess }}</p>
        </div>
      </div>
    </div>

    <!-- All Clear -->
    <div v-if="!report.recommendations.length && report.saneDevices.length" class="diag-section">
      <div class="all-clear">All network scanners are accessible to SANE. You're good to go!</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SaneDiagnosticsReport, SaneRecommendation } from '../../shared/types/domain.js';

const props = defineProps<{
  report: SaneDiagnosticsReport;
  applyingIdx: number | null;
  lastAppliedIdx: number | null;
  applyError: string;
  applySuccess: string;
}>();

const emit = defineEmits<{
  apply: [rec: SaneRecommendation, idx: number];
}>();

/** Group mDNS scanners by IP for display. */
interface GroupedScanner {
  address: string;
  name: string;
  services: Array<{ serviceType: string; protocol: string; port: number }>;
}

const groupedMdnsScanners = computed<GroupedScanner[]>(() => {
  const byIp = new Map<string, GroupedScanner>();

  for (const s of props.report.mdnsScanners) {
    const existing = byIp.get(s.address);
    if (existing) {
      if (!existing.services.some((svc) => svc.serviceType === s.serviceType)) {
        existing.services.push({ serviceType: s.serviceType, protocol: s.protocol, port: s.port });
      }
    } else {
      byIp.set(s.address, {
        address: s.address,
        name: s.name,
        services: [{ serviceType: s.serviceType, protocol: s.protocol, port: s.port }],
      });
    }
  }

  return [...byIp.values()];
});

/** Group unreachable scanners by IP too. */
const groupedUnreachable = computed<GroupedScanner[]>(() => {
  const byIp = new Map<string, GroupedScanner>();

  for (const s of props.report.unreachableScanners) {
    const existing = byIp.get(s.address);
    if (existing) {
      if (!existing.services.some((svc) => svc.serviceType === s.serviceType)) {
        existing.services.push({ serviceType: s.serviceType, protocol: s.protocol, port: s.port });
      }
    } else {
      byIp.set(s.address, {
        address: s.address,
        name: s.name,
        services: [{ serviceType: s.serviceType, protocol: s.protocol, port: s.port }],
      });
    }
  }

  return [...byIp.values()];
});

/** Unique protocol badges for a grouped scanner. */
const uniqueProtocols = (group: GroupedScanner): string[] => {
  return [...new Set(group.services.map((s) => s.protocol))];
};
</script>

<style scoped>
.diag-report {
  display: grid;
  gap: 1.25rem;
}

.diag-section h4 {
  margin: 0 0 0.6rem;
  color: var(--text-heading);
  font-size: 0.95rem;
}

.diag-summary {
  padding: 0.4rem 0;
  color: var(--text-muted);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.diag-summary:hover {
  color: var(--text-heading);
}

.diag-kv-grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.diag-kv {
  display: flex;
  justify-content: space-between;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border-default);
  border-radius: 0.35rem;
  background: var(--bg-elevated);
  font-size: 0.85rem;
}

.diag-key {
  color: var(--text-muted);
}

.diag-val {
  color: var(--text-heading);
  font-weight: 500;
}

.diag-val.ok {
  color: var(--color-success);
}

.diag-val.warn {
  color: var(--color-warning);
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

.card-meta code {
  padding: 0.1em 0.4em;
  border-radius: 0.25rem;
  background: var(--bg-surface);
  font-size: 0.75rem;
}

.badge-group {
  display: flex;
  gap: 0.25rem;
}

.services-details {
  margin-top: 0.35rem;
}

.services-summary {
  color: var(--text-faint);
  font-size: 0.75rem;
  cursor: pointer;
  user-select: none;
}

.services-summary:hover {
  color: var(--text-muted);
}

.services-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
  padding-left: 0.4rem;
  border-left: 2px solid var(--border-default);
}

.service-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.service-type {
  padding: 0.1em 0.35em;
  border-radius: 0.2rem;
  background: var(--bg-surface);
  color: var(--text-muted);
  font-family: monospace;
  font-size: 0.7rem;
}

.service-meta {
  color: var(--text-faint);
  font-size: 0.7rem;
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

.warn-card {
  border-color: var(--warn-card-border);
}

.warn-badge {
  background: var(--warn-card-border) !important;
  color: var(--color-warning) !important;
}

.rec-list {
  display: grid;
  gap: 0.75rem;
}

.rec-card {
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.rec-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.rec-type-badge {
  padding: 0.2em 0.5em;
  border-radius: 0.25rem;
  background: var(--badge-discovered-bg);
  color: var(--badge-discovered-fg);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
}

.rec-backend {
  color: var(--text-heading);
  font-size: 0.85rem;
  font-weight: 600;
}

.rec-description {
  margin: 0 0 0.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
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

.rec-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.all-clear {
  padding: 1rem;
  border: 1px solid var(--success-all-clear-border);
  border-radius: 0.5rem;
  background: var(--state-success-bg);
  color: var(--color-success);
  font-size: 0.9rem;
  font-weight: 500;
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
</style>
