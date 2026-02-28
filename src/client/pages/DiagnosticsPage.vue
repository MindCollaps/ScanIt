<template>
  <section class="page">
    <h2>Diagnostics</h2>

    <p class="intro">
      Run an extended network scan to discover scanners via mDNS, check SANE configuration, and get
      recommendations for connecting unreachable devices.
    </p>

    <div class="actions">
      <button
        class="btn-primary"
        :disabled="diag.isDiagnosing.value"
        @click="diag.runExtendedDiscovery"
      >
        {{ diag.isDiagnosing.value ? 'Scanning network...' : 'Run Diagnostics' }}
      </button>
    </div>

    <DiagnosticsPanel
      v-if="diag.diagnostics.value"
      :report="diag.diagnostics.value"
      :applying-idx="diag.applyingIdx.value"
      :last-applied-idx="diag.lastAppliedIdx.value"
      :apply-error="diag.applyError.value"
      :apply-success="diag.applySuccess.value"
      @apply="(rec, idx) => diag.confirmApply(rec, idx)"
    />

    <p v-else-if="!diag.isDiagnosing.value" class="muted-text">
      Click "Run Diagnostics" to scan your network and check SANE configuration.
    </p>

    <ConfirmModal
      v-if="diag.confirmRec.value"
      :recommendation="diag.confirmRec.value"
      :applying="diag.applyingIdx.value !== null"
      @confirm="diag.applyConfirmed"
      @cancel="diag.cancelConfirm"
    />
  </section>
</template>

<script setup lang="ts">
import { useDiagnostics } from '../composables/useDiagnostics.js';
import DiagnosticsPanel from '../components/DiagnosticsPanel.vue';
import ConfirmModal from '../components/ConfirmModal.vue';

const diag = useDiagnostics();
</script>

<style scoped>
.page {
  display: grid;
  gap: 1rem;
}

.intro {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  gap: 0.75rem;
}

.muted-text {
  color: var(--text-faint);
  font-size: 0.9rem;
}

.btn-primary {
  padding: 0.6rem 1rem;
  border: 0;
  border-radius: 0.5rem;
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
