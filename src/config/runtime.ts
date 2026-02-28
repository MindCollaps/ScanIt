import type { ConfigSnapshot, ConfigStatus } from '../shared/types/config.js';
import { ConfigValidationError } from './errors.js';
import { loadConfigSnapshot } from './loader.js';

/**
 * In-memory runtime holder for the latest validated config snapshot.
 * Tracks degraded state when hot-reloads fail.
 */
export class ConfigRuntime {
  private currentSnapshot: ConfigSnapshot | undefined;
  private lastError: { message: string; occurredAt: string } | undefined;

  public constructor(private readonly configPath: string) {}

  public getSnapshot(): ConfigSnapshot {
    if (!this.currentSnapshot) {
      throw new ConfigValidationError('Config runtime has not been initialized', []);
    }

    return this.currentSnapshot;
  }

  /**
   * Returns the current config diagnostics status.
   */
  public getStatus(): ConfigStatus {
    const snapshot = this.getSnapshot();
    const status: ConfigStatus = {
      status: this.lastError ? 'degraded' : 'valid',
      loadedAt: snapshot.loadedAt,
      hash: snapshot.hash,
      sourcePath: snapshot.sourcePath,
    };

    if (this.lastError) {
      status.lastError = this.lastError;
    }

    return status;
  }

  public async loadInitialSnapshot(): Promise<ConfigSnapshot> {
    const snapshot = await loadConfigSnapshot(this.configPath);
    this.currentSnapshot = snapshot;
    return snapshot;
  }

  public async reloadSnapshot(): Promise<{ snapshot?: ConfigSnapshot; error?: string }> {
    try {
      const snapshot = await loadConfigSnapshot(this.configPath);
      this.currentSnapshot = snapshot;
      this.lastError = undefined;
      return { snapshot };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown config reload failure';
      this.lastError = { message, occurredAt: new Date().toISOString() };
      return { error: message };
    }
  }
}
