import chokidar from 'chokidar';

export interface ConfigWatcherHandlers {
  onReloadAttempt: () => Promise<void>;
  onWatcherError: (message: string) => void;
}

/**
 * Creates a debounced file watcher for config hot-reloads.
 * Watches a directory for *.yaml / *.yml changes, or a single file.
 */
export const watchConfigPath = (
  configPath: string,
  handlers: ConfigWatcherHandlers,
): { close: () => Promise<void> } => {
  const watcher = chokidar.watch(configPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const debouncedReload = (() => {
    let timeout: NodeJS.Timeout | undefined;
    return (): void => {
      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(async () => {
        try {
          await handlers.onReloadAttempt();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown hot-reload failure';
          handlers.onWatcherError(message);
        }
      }, 250);
    };
  })();

  watcher.on('change', debouncedReload);
  watcher.on('add', debouncedReload);
  watcher.on('unlink', debouncedReload);
  watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown watcher error';
    handlers.onWatcherError(message);
  });

  return {
    close: async () => {
      await watcher.close();
    },
  };
};
