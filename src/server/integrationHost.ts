import type { ConfigRuntime } from '../config/runtime.js';
import type {
  IntegrationHost,
  IntegrationLogger,
  IntegrationEventCallback,
  IntegrationJobCreateInput,
} from '../integration-core/adapter.js';
import type { SseBroker } from './sse/broker.js';
import type { JobService } from './services/jobService.js';
import type { SqliteStore } from '../store/sqlite/db.js';
import { logger } from './logger.js';

const createIntegrationLogger = (): IntegrationLogger => ({
  debug(message, context) {
    if (context) logger.debug(context, message);
    else logger.debug(message);
  },
  info(message, context) {
    if (context) logger.info(context, message);
    else logger.info(message);
  },
  warn(message, context) {
    if (context) logger.warn(context, message);
    else logger.warn(message);
  },
  error(message, context) {
    if (context) logger.error(context, message);
    else logger.error(message);
  },
});

export const createIntegrationHost = (
  runtime: ConfigRuntime,
  sseBroker: SseBroker,
  jobService: JobService,
  store: SqliteStore,
): IntegrationHost => {
  const integrationLogger = createIntegrationLogger();

  return {
    logger: integrationLogger,
    config: {
      getCurrent: () => runtime.getSnapshot().config,
    },
    events: {
      on(type: string, callback: IntegrationEventCallback): () => void {
        sseBroker.on(type, callback);
        return () => sseBroker.off(type, callback);
      },
    },
    jobs: {
      create(input: IntegrationJobCreateInput) {
        return jobService.createAndRunJob(input, runtime.getSnapshot().config);
      },
      append(jobId: string) {
        return jobService.appendToJob(jobId, runtime.getSnapshot().config);
      },
      finalize(jobId: string) {
        return jobService.finalizeHeldJob(jobId, runtime.getSnapshot().config);
      },
      discard(jobId: string) {
        return jobService.deleteJob(jobId, runtime.getSnapshot().config);
      },
      interleave(jobId: string, splitIndex: number, reverseSecond: boolean) {
        return jobService.interleavePages(
          jobId,
          splitIndex,
          reverseSecond,
          runtime.getSnapshot().config,
        );
      },
      get(jobId: string) {
        return jobService.getJob(jobId);
      },
      getPages(jobId: string) {
        return jobService.getJobPages(jobId, runtime.getSnapshot().config);
      },
      addEvent(jobId: string, eventType: string, payload: object) {
        store.addJobEvent(jobId, eventType, payload);
      },
    },
    state: {
      get(key: string) {
        return store.getRuntimeValue(key);
      },
      set(key: string, value: string) {
        store.setRuntimeValue(key, value);
      },
      delete(key: string) {
        store.deleteRuntimeValue(key);
      },
    },
    presets: {
      getUserPreset(id: string) {
        return store.getUserPreset(id);
      },
    },
  };
};