import type { HomeAssistantConfig, HassButton, AppConfig } from '../../shared/types/config.js';
import type { JobService } from '../../server/services/jobService.js';
import type { SseBroker, BrokerEventCallback } from '../../server/sse/broker.js';
import type { ConfigRuntime } from '../../config/runtime.js';
import type { SqliteStore } from '../../store/sqlite/db.js';
import type {
  DestinationAdapter,
  DeliveryContext,
  DeliveryResult,
  AdapterFactory,
  AdapterDependencies,
} from '../adapter.js';
import { ScanItMqttClient } from './client.js';
import { HassDiscovery } from './discovery.js';
import { logger } from '../../server/logger.js';

/** How long (ms) to show succeeded/failed before returning to idle. */
const STATUS_COOLDOWN_MS = 10_000;

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

  /** Tracks registered broker listeners for cleanup. */
  private readonly brokerListeners: Array<{ type: string; callback: BrokerEventCallback }> = [];

  private config: HomeAssistantConfig;

  public constructor(
    private readonly jobService: JobService,
    private readonly broker: SseBroker,
    private readonly configRuntime: ConfigRuntime,
    private readonly store: SqliteStore,
    haConfig: HomeAssistantConfig,
  ) {
    this.config = haConfig;
    this.mqtt = new ScanItMqttClient(haConfig);
    this.discovery = new HassDiscovery(this.mqtt, haConfig);
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
    await this.mqtt.connect();
    await this.discovery.publishAll(this.config.buttons);
    await this.subscribeButtons();
    this.listenForJobEvents();
    logger.info({ buttons: this.config.buttons.length }, 'Home Assistant integration started');
  }

  /**
   * Called when configuration is hot-reloaded to update buttons.
   */
  public async onConfigReload(config: AppConfig): Promise<void> {
    const newConfig = config.integrations.homeassistant;
    if (!newConfig?.enabled) return;
    this.config = newConfig;
    this.discovery = new HassDiscovery(this.mqtt, newConfig);
    await this.discovery.publishAll(newConfig.buttons);
    logger.info({ buttons: newConfig.buttons.length }, 'HA discovery updated after config reload');
  }

  /**
   * Cleanly disconnect MQTT and remove broker listeners.
   */
  public async shutdown(): Promise<void> {
    for (const { type, callback } of this.brokerListeners) {
      this.broker.off(type, callback);
    }
    this.brokerListeners.length = 0;
    await this.mqtt.disconnect();
    logger.info('Home Assistant integration stopped');
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
  }

  private async handleButtonPress(buttonId: string): Promise<void> {
    // Ignore if this button already has an active job
    if (this.activeJobs.has(buttonId)) {
      logger.debug({ buttonId }, 'HA button press ignored – job already active');
      return;
    }

    const button = this.config.buttons.find((b) => b.id === buttonId);
    if (!button) {
      logger.warn({ buttonId }, 'HA button press for unknown button');
      return;
    }

    const config = this.configRuntime.getSnapshot().config;

    try {
      await this.publishButtonState(buttonId, 'scanning');

      const job = await this.jobService.createAndRunJob(
        {
          scannerId: this.resolveScannerId(button, config),
          presetId: button.presetId,
          trigger: 'hassio',
          ...(button.consumerOverride ? { consumers: button.consumerOverride } : {}),
        },
        config,
      );

      this.activeJobs.set(buttonId, job.id);
      this.jobToButton.set(job.id, buttonId);
      logger.info({ buttonId, jobId: job.id }, 'HA button triggered scan job');
    } catch (error) {
      logger.error({ buttonId, error: error instanceof Error ? error.message : String(error) }, 'HA button scan failed');
      await this.publishButtonState(buttonId, 'failed');
      this.scheduleIdleReset(buttonId);
    }
  }

  // ─── Job Event Listeners ────────────────────────────────────────────

  private listenForJobEvents(): void {
    const onSucceeded: BrokerEventCallback = (payload) => {
      const { jobId } = payload as { jobId: string };
      void this.onJobFinished(jobId, 'succeeded');
    };

    const onFailed: BrokerEventCallback = (payload) => {
      const { jobId } = payload as { jobId: string };
      void this.onJobFinished(jobId, 'failed');
    };

    this.broker.on('job_succeeded', onSucceeded);
    this.broker.on('job_failed', onFailed);
    this.brokerListeners.push(
      { type: 'job_succeeded', callback: onSucceeded },
      { type: 'job_failed', callback: onFailed },
    );
  }

  private async onJobFinished(jobId: string, state: 'succeeded' | 'failed'): Promise<void> {
    const buttonId = this.jobToButton.get(jobId);
    if (!buttonId) return; // Not an HA-triggered job

    this.activeJobs.delete(buttonId);
    this.jobToButton.delete(jobId);

    await this.publishButtonState(buttonId, state);
    this.scheduleIdleReset(buttonId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async publishButtonState(buttonId: string, state: string): Promise<void> {
    const topic = `${this.mqtt.prefix}/button/${buttonId}/state`;
    await this.mqtt.publish(topic, state, true);
  }

  private scheduleIdleReset(buttonId: string): void {
    setTimeout(() => {
      void this.publishButtonState(buttonId, 'idle');
    }, STATUS_COOLDOWN_MS);
  }

  private resolveScannerId(button: HassButton, config: AppConfig): string {
    // Explicit override on the button takes priority
    if (button.scannerId) return button.scannerId;

    // Check preset for a scannerId — user presets (DB) store one, config presets do not
    const configPreset = config.presets.find((p) => p.id === button.presetId);
    if (!configPreset) {
      const userPreset = this.store.getUserPreset(button.presetId);
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
 * Requires `jobService`, `sseBroker`, and `configRuntime` in deps.
 */
export const homeAssistantAdapterFactory: AdapterFactory = {
  name: 'homeassistant',
  create(config: AppConfig, deps: AdapterDependencies): DestinationAdapter[] {
    const haConfig = config.integrations.homeassistant;
    if (!haConfig?.enabled) return [];

    const jobService = deps.jobService as JobService;
    const sseBroker = deps.sseBroker as SseBroker;
    const configRuntime = deps.configRuntime as ConfigRuntime;
    const store = deps.store as SqliteStore;

    return [new HomeAssistantService(jobService, sseBroker, configRuntime, store, haConfig)];
  },
};
