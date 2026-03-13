import type { HomeAssistantConfig, HassButton, AppConfig } from '../../shared/types/config.js';
import type {
  DestinationAdapter,
  DeliveryContext,
  DeliveryResult,
  AdapterFactory,
  IntegrationEventCallback,
  IntegrationHost,
} from '../../integration-core/adapter.js';
import { ScanItMqttClient } from './client.js';
import { HassDiscovery } from './discovery.js';

/** How long (ms) to show succeeded/failed before returning to idle. */
const STATUS_COOLDOWN_MS = 10_000;

type HassScanMode = 'default' | 'double_sided' | 'endless';

interface HeldJobContext {
  jobId: string;
  buttonId: string;
  mode: Exclude<HassScanMode, 'default'>;
  secondPassCaptured?: boolean;
  splitIndex?: number;
}

const MODE_CYCLE: HassScanMode[] = ['default', 'double_sided', 'endless'];
const MODE_RUNTIME_KEY = 'ha_mode';
const HELD_JOB_RUNTIME_KEY = 'ha_held_job';

/**
 * Home Assistant integration adapter.
 *
 * Implements the full DestinationAdapter lifecycle so HA is managed
 * by the AdapterRegistry like every other integration:
 *
 * - initialize() → connects MQTT, publishes discovery, subscribes to buttons
 * - onConfigReload() → re-publishes discovery with updated buttons
 * - shutdown() → disconnects MQTT, removes broker listeners
 * - deliver() → no-op (HA triggers scans, it doesn't receive output)
 */
export class HomeAssistantService implements DestinationAdapter {
  public readonly type = 'homeassistant' as const;
  public readonly isConsumer = false as const;

  private mqtt: ScanItMqttClient;
  private discovery: HassDiscovery;

  /** Maps buttonId → actively running jobId (if any). */
  private readonly activeJobs = new Map<string, string>();

  /** Maps jobId → buttonId for reverse lookup on job events. */
  private readonly jobToButton = new Map<string, string>();

  /** Tracks event unsubscribe functions for cleanup. */
  private readonly eventSubscriptions: Array<() => void> = [];

  private mode: HassScanMode = 'default';
  private heldJob: HeldJobContext | null = null;
  private statusResetTimer: ReturnType<typeof setTimeout> | undefined;

  private config: HomeAssistantConfig;

  public constructor(
    private readonly host: IntegrationHost,
    haConfig: HomeAssistantConfig,
  ) {
    this.config = haConfig;
    this.mqtt = new ScanItMqttClient(haConfig, this.host.logger);
    this.discovery = new HassDiscovery(this.mqtt, haConfig, this.host.logger);
  }

  // ─── DestinationAdapter lifecycle ───────────────────────────────────

  /**
   * HA triggers scans — it doesn't receive output, so deliver is a no-op.
   */
  public async deliver(_context: DeliveryContext): Promise<DeliveryResult> {
    return { success: true };
  }

  /**
   * Connect MQTT, publish discovery, subscribe to button commands, and listen for job events.
   */
  public async initialize(): Promise<void> {
    this.restoreRuntimeState();

    await this.mqtt.connect();
    await this.discovery.publishAll(this.config.buttons);

    await this.subscribeButtons();
    this.listenForJobEvents();

    await this.publishModeState();
    if (this.heldJob) {
      await this.publishGlobalStatus('hold', this.statusAttributes({
        jobId: this.heldJob.jobId,
        buttonId: this.heldJob.buttonId,
      }));
    } else {
      await this.publishGlobalStatus('idle', this.statusAttributes());
    }

    this.host.logger.info('Home Assistant integration started', {
      buttons: this.config.buttons.length,
      mode: this.mode,
      heldJobId: this.heldJob?.jobId,
    });
  }

  /**
   * Called when configuration is hot-reloaded to update buttons.
   */
  public async onConfigReload(config: AppConfig): Promise<void> {
    const newConfig = config.integrations.homeassistant;
    if (!newConfig?.enabled) return;

    this.config = newConfig;
    this.discovery = new HassDiscovery(this.mqtt, newConfig, this.host.logger);
    await this.discovery.publishAll(newConfig.buttons);
    await this.publishModeState();
    this.host.logger.info('HA discovery updated after config reload', {
      buttons: newConfig.buttons.length,
    });
  }

  /**
   * Cleanly disconnect MQTT and remove broker listeners.
   */
  public async shutdown(): Promise<void> {
    if (this.statusResetTimer) clearTimeout(this.statusResetTimer);
    for (const unsubscribe of this.eventSubscriptions) {
      unsubscribe();
    }
    this.eventSubscriptions.length = 0;
    await this.mqtt.disconnect();
    this.host.logger.info('Home Assistant integration stopped');
  }

  // ─── Button Subscription ────────────────────────────────────────────

  private async subscribeButtons(): Promise<void> {
    const prefix = this.mqtt.prefix;
    await this.mqtt.subscribe(`${prefix}/button/+/command`, (topic, payload) => {
      const message = payload.toString();
      if (message !== 'PRESS') return;

      // Extract buttonId from topic: {prefix}/button/{buttonId}/command
      const parts = topic.split('/');
      const buttonId = parts[parts.length - 2];
      if (!buttonId) return;

      void this.handleButtonPress(buttonId);
    });

    await this.mqtt.subscribe(`${prefix}/mode/command`, (_topic, payload) => {
      if (payload.toString() !== 'PRESS') return;
      void this.handleModeCyclePress();
    });

    await this.mqtt.subscribe(`${prefix}/continue/command`, (_topic, payload) => {
      if (payload.toString() !== 'PRESS') return;
      void this.handleContinuePress();
    });

    await this.mqtt.subscribe(`${prefix}/discard/command`, (_topic, payload) => {
      if (payload.toString() !== 'PRESS') return;
      void this.handleDiscardPress();
    });

    await this.mqtt.subscribe(`${prefix}/finalize/command`, (_topic, payload) => {
      if (payload.toString() !== 'PRESS') return;
      void this.handleFinalizePress();
    });
  }

  private async handleButtonPress(buttonId: string): Promise<void> {
    const button = this.config.buttons.find((b) => b.id === buttonId);
    if (!button) {
      this.host.logger.warn('HA button press for unknown button', { buttonId });
      return;
    }

    const activeEntry = this.activeJobs.entries().next().value as [string, string] | undefined;
    if (activeEntry) {
      const [activeButtonId, activeJobId] = activeEntry;
      const msg =
        activeButtonId === buttonId
          ? `Job '${activeJobId}' is still running for this button`
          : `Job '${activeJobId}' is still running (triggered by '${activeButtonId}')`;

      this.host.logger.warn('HA button press ignored – job still running', {
        buttonId,
        activeButtonId,
        activeJobId,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: activeJobId,
        buttonId,
        message: msg,
      }));

      this.scheduleStatusReset(
        this.heldJob ? 'hold' : 'scanning',
        this.heldJob
          ? this.statusAttributes({ jobId: this.heldJob.jobId, buttonId: this.heldJob.buttonId })
          : this.statusAttributes({ jobId: activeJobId, buttonId: activeButtonId }),
      );
      return;
    }

    const config = this.host.config.getCurrent();

    try {
      if (this.heldJob) {
        if (this.heldJob.buttonId === buttonId) {
          await this.continueHeldJob();
          return;
        }

        const msg = `Held job '${this.heldJob.jobId}' is not finished (triggered by '${this.heldJob.buttonId}'). Press the same preset again or use Continue Held Job.`;
        this.host.logger.warn(msg, {
          buttonId,
          heldJobId: this.heldJob.jobId,
          heldButtonId: this.heldJob.buttonId,
        });
        await this.publishGlobalStatus('failed', this.statusAttributes({
          jobId: this.heldJob.jobId,
          buttonId,
          message: msg,
        }));
        this.scheduleStatusReset('hold', this.statusAttributes({
          jobId: this.heldJob.jobId,
          buttonId: this.heldJob.buttonId,
        }));
        return;
      }

      await this.publishGlobalStatus('scanning', this.statusAttributes({ buttonId }));

      const deferDelivery = this.mode !== 'default';
      const job = await this.host.jobs.create(
        {
          scannerId: this.resolveScannerId(button, config),
          presetId: button.presetId,
          trigger: 'hassio',
          deferDelivery,
          ...(button.consumerOverride ? { consumers: button.consumerOverride } : {}),
        },
      );

      this.activeJobs.set(buttonId, job.id);
      this.jobToButton.set(job.id, buttonId);

      if (deferDelivery && this.mode !== 'default') {
        this.heldJob = {
          jobId: job.id,
          buttonId,
          mode: this.mode,
          ...(this.mode === 'double_sided' ? { secondPassCaptured: false } : {}),
        };
        this.persistHeldJob();
      }

      this.host.logger.info('HA button triggered scan job', {
        buttonId,
        jobId: job.id,
        mode: this.mode,
      });
    } catch (error) {
      this.host.logger.error('HA button scan failed', {
        buttonId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        buttonId,
        message: error instanceof Error ? error.message : String(error),
      }));
      this.scheduleStatusReset(this.heldJob ? 'hold' : 'idle', this.heldJob
        ? this.statusAttributes({ jobId: this.heldJob.jobId, buttonId: this.heldJob.buttonId })
        : this.statusAttributes());
    }
  }

  private async handleContinuePress(): Promise<void> {
    if (!this.heldJob) {
      const msg = 'No held job is waiting. Start a scan first.';
      this.host.logger.warn(msg);
      await this.publishGlobalStatus('failed', this.statusAttributes({ message: msg }));
      this.scheduleStatusReset('idle', this.statusAttributes());
      return;
    }

    const activeEntry = this.activeJobs.entries().next().value as [string, string] | undefined;
    if (activeEntry) {
      const [activeButtonId, activeJobId] = activeEntry;
      const msg = `Job '${activeJobId}' is still running (triggered by '${activeButtonId}')`;
      this.host.logger.warn('HA continue ignored – job still running', {
        activeButtonId,
        activeJobId,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: activeJobId,
        buttonId: activeButtonId,
        message: msg,
      }));
      this.scheduleStatusReset('scanning', this.statusAttributes({
        jobId: activeJobId,
        buttonId: activeButtonId,
      }));
      return;
    }

    await this.continueHeldJob();
  }

  private async continueHeldJob(): Promise<void> {
    const held = this.heldJob;
    if (!held) return;

    if (held.mode === 'double_sided' && held.secondPassCaptured) {
      const msg = 'Double-sided second pass already captured. Press mode button to finalize.';
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: held.jobId,
        buttonId: held.buttonId,
        message: msg,
      }));
      this.scheduleStatusReset('hold', this.statusAttributes({
        jobId: held.jobId,
        buttonId: held.buttonId,
      }));
      return;
    }

    const config = this.host.config.getCurrent();
    const pagesBefore = await this.host.jobs.getPages(held.jobId);

    this.activeJobs.set(held.buttonId, held.jobId);
    await this.publishGlobalStatus('scanning', this.statusAttributes({
      jobId: held.jobId,
      buttonId: held.buttonId,
    }));

    try {
      await this.host.jobs.append(held.jobId);

      if (held.mode === 'double_sided' && !held.secondPassCaptured) {
        held.secondPassCaptured = true;
        held.splitIndex = pagesBefore.length;
        this.persistHeldJob();
      }

      this.host.logger.info('HA hold job appended', {
        buttonId: held.buttonId,
        jobId: held.jobId,
        mode: held.mode,
      });
    } catch (error) {
      this.activeJobs.delete(held.buttonId);
      const msg = error instanceof Error ? error.message : 'Append scan failed';
      this.host.logger.error('HA held append failed', {
        buttonId: held.buttonId,
        jobId: held.jobId,
        error: msg,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: held.jobId,
        buttonId: held.buttonId,
        message: msg,
      }));
      this.scheduleStatusReset('hold', this.statusAttributes({
        jobId: held.jobId,
        buttonId: held.buttonId,
      }));
    }
  }

  private async handleFinalizePress(): Promise<void> {
    if (!this.heldJob) {
      const msg = 'No held scan to finalize. Start a scan first.';
      this.host.logger.warn(msg);
      await this.publishGlobalStatus('failed', this.statusAttributes({ message: msg }));
      this.scheduleStatusReset('idle', this.statusAttributes());
      return;
    }

    const activeEntry = this.activeJobs.entries().next().value as [string, string] | undefined;
    if (activeEntry) {
      const [activeButtonId, activeJobId] = activeEntry;
      const msg = `Job '${activeJobId}' is still running (triggered by '${activeButtonId}'). Wait for it to finish before finalizing.`;
      this.host.logger.warn('HA finalize ignored – job still running', {
        activeButtonId,
        activeJobId,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: activeJobId,
        buttonId: activeButtonId,
        message: msg,
      }));
      this.scheduleStatusReset('hold', this.statusAttributes({
        jobId: this.heldJob.jobId,
        buttonId: this.heldJob.buttonId,
      }));
      return;
    }

    try {
      await this.finalizeHeldWorkflow();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Finalize failed';
      this.host.logger.error('HA finalize held scan failed', {
        jobId: this.heldJob?.jobId,
        error: msg,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({ message: msg }));
      this.scheduleStatusReset('idle', this.statusAttributes());
    }
  }

  private async handleDiscardPress(): Promise<void> {
    if (!this.heldJob) {
      const msg = 'No held scan to discard. Start a scan first.';
      this.host.logger.warn(msg);
      await this.publishGlobalStatus('failed', this.statusAttributes({ message: msg }));
      this.scheduleStatusReset('idle', this.statusAttributes());
      return;
    }

    const activeEntry = this.activeJobs.entries().next().value as [string, string] | undefined;
    if (activeEntry) {
      const [activeButtonId, activeJobId] = activeEntry;
      const msg = `Job '${activeJobId}' is still running (triggered by '${activeButtonId}'). Wait for it to finish before discarding.`;
      this.host.logger.warn('HA discard ignored – job still running', {
        activeButtonId,
        activeJobId,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: activeJobId,
        buttonId: activeButtonId,
        message: msg,
      }));
      this.scheduleStatusReset('hold', this.statusAttributes({
        jobId: this.heldJob.jobId,
        buttonId: this.heldJob.buttonId,
      }));
      return;
    }

    const held = this.heldJob;
    this.host.logger.info('HA discarding held scan', {
      jobId: held.jobId,
      buttonId: held.buttonId,
    });

    try {
      this.jobToButton.delete(held.jobId);
      this.clearHeldJob();
      this.mode = 'default';
      this.persistMode();
      await this.publishModeState();

      await this.host.jobs.discard(held.jobId);

      await this.publishGlobalStatus('idle', this.statusAttributes());
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Discard failed';
      this.host.logger.error('HA discard held scan failed', {
        jobId: held.jobId,
        error: msg,
      });
      await this.publishGlobalStatus('failed', this.statusAttributes({ message: msg }));
      this.scheduleStatusReset('idle', this.statusAttributes());
    }
  }

  private async handleModeCyclePress(): Promise<void> {
    try {
      if (this.heldJob) {
        await this.finalizeHeldWorkflow();
      } else {
        this.mode = this.nextMode(this.mode);
        this.persistMode();
        await this.publishModeState();

        if (this.activeJobs.size === 0) {
          await this.publishGlobalStatus('idle', this.statusAttributes());
        }
      }

      this.host.logger.info('HA mode changed', { mode: this.mode });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Mode change failed';
      this.host.logger.error('HA mode cycle failed', { error: msg });
      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId: this.heldJob?.jobId,
        buttonId: this.heldJob?.buttonId,
        message: msg,
      }));
      this.scheduleStatusReset(this.heldJob ? 'hold' : 'idle', this.heldJob
        ? this.statusAttributes({ jobId: this.heldJob.jobId, buttonId: this.heldJob.buttonId })
        : this.statusAttributes());
    }
  }

  private async finalizeHeldWorkflow(): Promise<void> {
    const held = this.heldJob;
    if (!held) return;

    const currentConfig = this.host.config.getCurrent();

    if (held.mode === 'double_sided' && held.secondPassCaptured && held.splitIndex !== undefined) {
      const pages = await this.host.jobs.getPages(held.jobId);
      if (held.splitIndex > 0 && held.splitIndex < pages.length) {
        await this.host.jobs.interleave(held.jobId, held.splitIndex, true);
        this.host.jobs.addEvent(held.jobId, 'ha_double_sided_interleaved', {
          splitIndex: held.splitIndex,
          reverseSecond: true,
        });
      }
    }

    await this.host.jobs.finalize(held.jobId);
    this.clearHeldJob();
  }

  // ─── Job Event Listeners ────────────────────────────────────────────

  private listenForJobEvents(): void {
    const onSucceeded: IntegrationEventCallback = (payload) => {
      const { jobId } = payload as { jobId: string };
      void this.onJobFinished(jobId, 'succeeded');
    };

    const onFailed: IntegrationEventCallback = (payload) => {
      const { jobId, message } = payload as { jobId: string; message?: string };
      void this.onJobFinished(jobId, 'failed', message);
    };

    const onHold: IntegrationEventCallback = (payload) => {
      const { jobId } = payload as { jobId: string };
      void this.onJobHeld(jobId);
    };

    this.eventSubscriptions.push(
      this.host.events.on('job_succeeded', onSucceeded),
      this.host.events.on('job_failed', onFailed),
      this.host.events.on('job_hold', onHold),
    );
  }

  private async onJobHeld(jobId: string): Promise<void> {
    const buttonId = this.jobToButton.get(jobId) ?? this.heldJob?.buttonId;
    if (!buttonId) return; // Not an HA-triggered job

    this.activeJobs.delete(buttonId);

    if (!this.heldJob || this.heldJob.jobId !== jobId) {
      if (this.mode === 'default') return;
      this.heldJob = {
        jobId,
        buttonId,
        mode: this.mode,
        ...(this.mode === 'double_sided' ? { secondPassCaptured: false } : {}),
      };
      this.persistHeldJob();
    }

    await this.publishGlobalStatus('hold', this.statusAttributes({ jobId, buttonId }));
  }

  private async onJobFinished(
    jobId: string,
    state: 'succeeded' | 'failed',
    message?: string,
  ): Promise<void> {
    const buttonId = this.jobToButton.get(jobId) ?? this.heldJob?.buttonId;
    if (!buttonId) return; // Not an HA-triggered job

    this.activeJobs.delete(buttonId);

    if (state === 'failed' && this.heldJob?.jobId === jobId) {
      const currentJob = this.host.jobs.get(jobId);
      const stillHeld = currentJob?.state === 'HOLD';
      if (!stillHeld) {
        this.clearHeldJob();
      }

      await this.publishGlobalStatus('failed', this.statusAttributes({
        jobId,
        buttonId,
        message,
      }));
      if (stillHeld && this.heldJob) {
        this.scheduleStatusReset('hold', this.statusAttributes({
          jobId,
          buttonId: this.heldJob.buttonId,
        }));
      } else {
        this.scheduleStatusReset('idle', this.statusAttributes());
      }
      return;
    }

    this.jobToButton.delete(jobId);

    if (state === 'succeeded' && this.heldJob?.jobId === jobId) {
      this.mode = 'default';
      this.persistMode();
      await this.publishModeState();
    }

    if (this.heldJob?.jobId === jobId) {
      this.clearHeldJob();
    }

    await this.publishGlobalStatus(state, this.statusAttributes({ jobId, buttonId, message }));
    this.scheduleStatusReset('idle', this.statusAttributes());
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private statusAttributes(payload?: {
    jobId?: string | undefined;
    buttonId?: string | undefined;
    message?: string | undefined;
  }): Record<string, unknown> {
    return {
      mode: this.mode,
      ...(payload?.jobId ? { jobId: payload.jobId } : {}),
      ...(payload?.buttonId ? { buttonId: payload.buttonId } : {}),
      ...(payload?.message ? { message: payload.message } : {}),
    };
  }

  private async publishGlobalStatus(state: string, attrs: Record<string, unknown>): Promise<void> {
    const prefix = this.mqtt.prefix;
    await this.mqtt.publish(`${prefix}/job/state`, state, true);
    await this.mqtt.publish(`${prefix}/job/attributes`, JSON.stringify(attrs), true);
    const jobId = typeof attrs.jobId === 'string' && attrs.jobId.length > 0 ? attrs.jobId : 'none';
    await this.mqtt.publish(`${prefix}/job/id`, jobId, true);
    const message = typeof attrs.message === 'string' ? attrs.message : '';
    await this.mqtt.publish(`${prefix}/job/message`, message, true);
  }

  private async publishModeState(): Promise<void> {
    await this.mqtt.publish(`${this.mqtt.prefix}/mode/state`, this.mode, true);
  }

  private scheduleStatusReset(
    state: 'idle' | 'hold' | 'scanning',
    attrs: Record<string, unknown>,
  ): void {
    if (this.statusResetTimer) {
      clearTimeout(this.statusResetTimer);
    }
    this.statusResetTimer = setTimeout(() => {
      void this.publishGlobalStatus(state, attrs);
    }, STATUS_COOLDOWN_MS);
  }

  private persistMode(): void {
    this.host.state.set(MODE_RUNTIME_KEY, this.mode);
  }

  private persistHeldJob(): void {
    if (!this.heldJob) {
      this.host.state.delete(HELD_JOB_RUNTIME_KEY);
      return;
    }
    this.host.state.set(HELD_JOB_RUNTIME_KEY, JSON.stringify(this.heldJob));
  }

  private clearHeldJob(): void {
    this.heldJob = null;
    this.host.state.delete(HELD_JOB_RUNTIME_KEY);
  }

  private restoreRuntimeState(): void {
    const modeRaw = this.host.state.get(MODE_RUNTIME_KEY);
    if (modeRaw === 'default' || modeRaw === 'double_sided' || modeRaw === 'endless') {
      this.mode = modeRaw;
    }

    const heldRaw = this.host.state.get(HELD_JOB_RUNTIME_KEY);
    if (!heldRaw) return;

    try {
      const parsed = JSON.parse(heldRaw) as HeldJobContext;
      const job = this.host.jobs.get(parsed.jobId);
      if (!job || job.state !== 'HOLD') {
        this.host.state.delete(HELD_JOB_RUNTIME_KEY);
        return;
      }

      this.heldJob = parsed;
      this.jobToButton.set(parsed.jobId, parsed.buttonId);
    } catch {
      this.host.state.delete(HELD_JOB_RUNTIME_KEY);
    }
  }

  private nextMode(current: HassScanMode): HassScanMode {
    const idx = MODE_CYCLE.indexOf(current);
    if (idx < 0) return 'default';
    return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!;
  }

  private resolveScannerId(button: HassButton, config: AppConfig): string {
    // Explicit override on the button takes priority
    if (button.scannerId) return button.scannerId;

    // Check preset for a scannerId — user presets (DB) store one, config presets do not
    const configPreset = config.presets.find((p) => p.id === button.presetId);
    if (!configPreset) {
      const userPreset = this.host.presets.getUserPreset(button.presetId);
      if (userPreset?.scannerId) return userPreset.scannerId;
    }

    // Fall back to first enabled config scanner
    const firstScanner = config.scanners.find((s) => s.enabled);
    if (firstScanner) return firstScanner.id;

    throw new Error(`Cannot resolve scanner for HA button '${button.id}': no scannerId on button or preset, and no enabled scanner in config`);
  }
}

/**
 * Factory that creates a HomeAssistantService adapter when HA is enabled in config.
 * It only depends on the typed IntegrationHost contract.
 */
export const homeAssistantAdapterFactory: AdapterFactory = {
  name: 'homeassistant',
  create(config: AppConfig, host: IntegrationHost): DestinationAdapter[] {
    const haConfig = config.integrations.homeassistant;
    if (!haConfig?.enabled) return [];

    return [new HomeAssistantService(host, haConfig)];
  },
};
