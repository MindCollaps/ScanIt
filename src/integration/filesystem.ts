import type {
  DestinationAdapter,
  DeliveryContext,
  DeliveryResult,
  AdapterFactory,
  AdapterDependencies,
} from './adapter.js';
import type { AppConfig } from '../shared/types/config.js';

/**
 * Default filesystem adapter — files already reside in the job output directory,
 * so delivery is a no-op acknowledgement. Future enhancements can copy/move
 * files to a configured destination path.
 */
export class FilesystemAdapter implements DestinationAdapter {
  public readonly type = 'filesystem' as const;

  public async deliver(_context: DeliveryContext): Promise<DeliveryResult> {
    return { success: true };
  }
}

/**
 * Factory that always produces a single filesystem adapter.
 */
export const filesystemAdapterFactory: AdapterFactory = {
  name: 'filesystem',
  create(_config: AppConfig, _deps: AdapterDependencies): DestinationAdapter[] {
    return [new FilesystemAdapter()];
  },
};
