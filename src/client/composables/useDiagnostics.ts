import { ref } from 'vue';
import type { SaneDiagnosticsReport, SaneRecommendation } from '../../shared/types/domain.js';
import { useApi } from './useApi.js';

/**
 * Composable that manages extended mDNS discovery / SANE diagnostics state.
 */
export const useDiagnostics = () => {
  const api = useApi();

  const diagnostics = ref<SaneDiagnosticsReport | null>(null);
  const isDiagnosing = ref(false);

  const applyingIdx = ref<number | null>(null);
  const lastAppliedIdx = ref<number | null>(null);
  const applyError = ref('');
  const applySuccess = ref('');

  const confirmRec = ref<SaneRecommendation | null>(null);
  const confirmRecIdx = ref<number | null>(null);

  const runExtendedDiscovery = async (): Promise<void> => {
    isDiagnosing.value = true;
    applyError.value = '';
    applySuccess.value = '';
    console.log('[diagnostics] Starting extended discovery (SANE diagnostics)...');
    try {
      diagnostics.value = await api.getDiagnostics();
      const d = diagnostics.value;
      console.log(
        `[diagnostics] Complete: ${d.mdnsScanners.length} mDNS, ${d.saneDevices.length} SANE, ${d.unreachableScanners.length} unreachable, ${d.recommendations.length} recommendations, configWritable=${d.configWritable}`,
      );
      if (d.configWriteError)
        console.warn(`[diagnostics] Config write error: ${d.configWriteError}`);
    } catch (err) {
      console.error('[diagnostics] Extended discovery failed:', err);
      diagnostics.value = null;
    } finally {
      isDiagnosing.value = false;
    }
  };

  /** Open confirmation modal before applying a recommendation. */
  const confirmApply = (rec: SaneRecommendation, idx: number): void => {
    console.log(
      `[diagnostics] Confirm apply recommendation #${idx}: ${rec.type} for ${rec.backend}`,
    );
    confirmRec.value = rec;
    confirmRecIdx.value = idx;
    applyError.value = '';
    applySuccess.value = '';
  };

  /** Actually apply after user confirms in the modal. */
  const applyConfirmed = async (): Promise<void> => {
    const rec = confirmRec.value;
    const idx = confirmRecIdx.value;
    if (!rec || idx === null) return;

    console.log(
      `[diagnostics] Applying recommendation #${idx}: ${rec.type} → ${rec.configFile} += ${rec.configLine}`,
    );
    confirmRec.value = null;
    applyingIdx.value = idx;
    applyError.value = '';
    applySuccess.value = '';
    try {
      const result = await api.applyRecommendation(rec);
      diagnostics.value = result.diagnostics;
      lastAppliedIdx.value = idx;
      applySuccess.value = 'Applied successfully! Re-run discovery to verify.';
      console.log(`[diagnostics] Recommendation #${idx} applied successfully`);
    } catch (error: unknown) {
      applyError.value = error instanceof Error ? error.message : 'Failed to apply fix';
      console.error(`[diagnostics] Failed to apply recommendation #${idx}:`, applyError.value);
    } finally {
      applyingIdx.value = null;
    }
  };

  const cancelConfirm = (): void => {
    confirmRec.value = null;
    confirmRecIdx.value = null;
  };

  return {
    diagnostics,
    isDiagnosing,
    applyingIdx,
    lastAppliedIdx,
    applyError,
    applySuccess,
    confirmRec,
    confirmRecIdx,
    runExtendedDiscovery,
    confirmApply,
    applyConfirmed,
    cancelConfirm,
  };
};
