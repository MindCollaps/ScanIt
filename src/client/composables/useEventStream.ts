import { onBeforeUnmount, ref, type InjectionKey, type Ref, inject } from 'vue';

export interface EventMessage {
  event: string;
  data: Record<string, unknown>;
  receivedAt: string;
}

export interface EventStream {
  isConnected: Ref<boolean>;
  hasConnected: Ref<boolean>;
  messages: Ref<EventMessage[]>;
}

/** Injection key for the app-wide event stream. */
export const EventStreamKey: InjectionKey<EventStream> = Symbol('eventStream');

/** All SSE event types emitted by the broker. */
const SSE_EVENT_TYPES = [
  'job_created',
  'job_running',
  'job_progress',
  'job_succeeded',
  'job_failed',
] as const;

/**
 * Creates and manages a lifecycle-aware SSE connection with auto-reconnect.
 * Instantiate once in App.vue and provide via EventStreamKey.
 */
export const useEventStream = () => {
  const isConnected = ref(false);
  const hasConnected = ref(false);
  const messages = ref<EventMessage[]>([]);
  let source: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  /** Terminal event types — once reached, intermediate events for the job are removed. */
  const TERMINAL_EVENTS = new Set(['job_succeeded', 'job_failed']);
  const INTERMEDIATE_EVENTS = new Set(['job_created', 'job_running', 'job_progress']);

  const push = (event: string, raw: string): void => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = { raw };
    }

    // When a job reaches a terminal state, remove its intermediate events
    // so the list stays clean and focused on outcomes.
    if (TERMINAL_EVENTS.has(event) && data.jobId) {
      const jobId = data.jobId as string;
      messages.value = messages.value.filter(
        (m) => !(INTERMEDIATE_EVENTS.has(m.event) && m.data.jobId === jobId),
      );
    }

    messages.value.unshift({ event, data, receivedAt: new Date().toISOString() });
    messages.value = messages.value.slice(0, 50);
  };

  const connect = (): void => {
    if (source) return;

    source = new EventSource('/api/events');

    source.onopen = () => {
      isConnected.value = true;
      hasConnected.value = true;
    };

    for (const type of SSE_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        push(type, (event as MessageEvent<string>).data);
      });
    }

    source.onmessage = (event) => {
      push('message', event.data);
    };

    source.onerror = () => {
      isConnected.value = false;
      source?.close();
      source = undefined;
      // Auto-reconnect after a short delay
      reconnectTimer = setTimeout(connect, 3000);
    };
  };

  const disconnect = (): void => {
    clearTimeout(reconnectTimer);
    source?.close();
    source = undefined;
    isConnected.value = false;
  };

  // Auto-connect immediately
  connect();

  onBeforeUnmount(disconnect);

  return {
    isConnected,
    hasConnected,
    messages,
    connect,
    disconnect,
  };
};

/**
 * Inject the app-wide event stream. Must be called in a component
 * that is a descendant of the provider (App.vue).
 */
export const useGlobalEvents = (): EventStream => {
  const stream = inject(EventStreamKey);
  if (!stream) throw new Error('EventStream not provided — is App.vue providing it?');
  return stream;
};
