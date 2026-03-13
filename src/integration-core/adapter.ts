import type { ScanJob, JobTrigger, UserPreset } from '../shared/types/domain.js';
import type { AppConfig } from '../shared/types/config.js';
import { logger } from '../server/logger.js';

export interface DeliveryPage {
  filename: string;
  path: string;
  bytes: number;
}

export interface DeliveryContext {
  job: ScanJob;
  pages: DeliveryPage[];
  config: AppConfig;
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

export interface IntegrationJobCreateInput {
  scannerId: string;
  presetId: string;
  outputFilename?: string;
  trigger?: JobTrigger;
  consumers?: string[];
  deferDelivery?: boolean;
  overrides?: {
    device?: string;
    source?: string;
    mode?: string;
    resolutionDpi?: number;
  };
}

export interface IntegrationLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export type IntegrationEventCallback = (payload: unknown) => void;

export interface IntegrationHost {
  readonly logger: IntegrationLogger;
  readonly config: {
    getCurrent(): AppConfig;
  };
  readonly events: {
    on(type: string, callback: IntegrationEventCallback): () => void;
  };
  readonly jobs: {
    create(input: IntegrationJobCreateInput): Promise<ScanJob>;
    append(jobId: string): Promise<{ newPages: string[] }>;
    finalize(jobId: string): Promise<void>;
    discard(jobId: string): Promise<void>;
    interleave(jobId: string, splitIndex: number, reverseSecond: boolean): Promise<string[]>;
    get(jobId: string): ScanJob | undefined;
    getPages(jobId: string): Promise<DeliveryPage[]>;
    addEvent(jobId: string, eventType: string, payload: object): void;
  };
  readonly state: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
  };
  readonly presets: {
    getUserPreset(id: string): UserPreset | undefined;
  };
}

/**
 * Contract for destination adapters that consume scan output.
 * Adapters may optionally implement lifecycle hooks for initialization,
 * config reload, and shutdown — making integrations truly plug-and-play.
 */
export interface DestinationAdapter {
  readonly type: string;
  /**
   * Whether this adapter appears as a selectable consumer for scan jobs.
   * Defaults to true. Set to false for integrations that only trigger scans
   * (e.g. Home Assistant) and don't receive output.
   */
  readonly isConsumer?: boolean;
  deliver(context: DeliveryContext): Promise<DeliveryResult>;

  /** Called once after registration, during server startup. */
  initialize?(): Promise<void>;

  /** Called when configuration is hot-reloaded. */
  onConfigReload?(config: AppConfig): Promise<void>;

  /** Called during graceful shutdown. */
  shutdown?(): Promise<void>;
}

/**
 * A factory that reads its relevant config section and produces adapter instances.
 * Each integration provides one factory. The registry calls it on startup and reload.
 */
export interface AdapterFactory {
  /** Human-readable name for logging. */
  readonly name: string;

  /**
   * Create adapter instances from the current config.
   * May return zero instances if the integration is not configured.
   */
  create(config: AppConfig, host: IntegrationHost): DestinationAdapter[];
}

/**
 * Registry of destination adapters with full lifecycle management.
 * Factories are registered once; the registry rebuilds adapters on config changes.
 */
export class AdapterRegistry {
  private readonly factories: AdapterFactory[] = [];
  private readonly adapters = new Map<string, DestinationAdapter>();
  /** Tracks adapter types that were created by factories (vs. static registration). */
  private readonly factoryTypes = new Set<string>();

  /** Register a factory that will produce adapters from config. */
  public registerFactory(factory: AdapterFactory): void {
    this.factories.push(factory);
  }

  /** Register a single static adapter (no factory needed). */
  public register(adapter: DestinationAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  public get(type: string): DestinationAdapter | undefined {
    return this.adapters.get(type);
  }

  /** Returns adapter types that are selectable as job consumers. */
  public types(): string[] {
    return [...this.adapters.values()]
      .filter((a) => a.isConsumer !== false)
      .map((a) => a.type);
  }

  /**
   * Build all adapters from registered factories and initialize them.
   * Called once during server bootstrap.
   */
  public async initializeAll(config: AppConfig, host: IntegrationHost): Promise<void> {
    for (const factory of this.factories) {
      for (const adapter of factory.create(config, host)) {
        this.adapters.set(adapter.type, adapter);
        this.factoryTypes.add(adapter.type);
      }
    }

    for (const adapter of this.adapters.values()) {
      if (adapter.initialize) {
        try {
          await adapter.initialize();
        } catch (error: unknown) {
          const msg =
            error instanceof Error
              ? error.message
              : String(error) || JSON.stringify(error);
          logger.error({ adapter: adapter.type, error: msg }, 'adapter initialization failed');
        }
      }
    }
  }

  /**
   * Rebuild factory-produced adapters with the new config.
   * Shuts down old factory instances, creates new ones, and initializes them.
   */
  public async reloadConfig(config: AppConfig, host: IntegrationHost): Promise<void> {
    // Shutdown old factory-produced adapters
    for (const type of this.factoryTypes) {
      const adapter = this.adapters.get(type);
      if (adapter?.shutdown) {
        try {
          await adapter.shutdown();
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn({ adapter: type, error: msg }, 'adapter shutdown error during reload');
        }
      }
      this.adapters.delete(type);
    }
    this.factoryTypes.clear();

    // Rebuild from factories with new config
    for (const factory of this.factories) {
      for (const adapter of factory.create(config, host)) {
        this.adapters.set(adapter.type, adapter);
        this.factoryTypes.add(adapter.type);
      }
    }

    // Initialize new factory-produced adapters
    for (const type of this.factoryTypes) {
      const adapter = this.adapters.get(type);
      if (adapter?.initialize) {
        try {
          await adapter.initialize();
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error({ adapter: type, error: msg }, 'adapter re-initialization failed');
        }
      }
    }
  }

  /**
   * Gracefully shut down all adapters.
   */
  public async shutdownAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      if (adapter.shutdown) {
        try {
          await adapter.shutdown();
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn({ adapter: adapter.type, error: msg }, 'adapter shutdown error');
        }
      }
    }
  }
}
