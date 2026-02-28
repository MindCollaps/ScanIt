import { onBeforeUnmount, ref } from 'vue';

interface EventMessage {
  event: string;
  data: string;
}

/**
 * Manages a lifecycle-aware SSE connection.
 */
export const useEventStream = () => {
  const isConnected = ref(false);
  const messages = ref<EventMessage[]>([]);
  let source: EventSource | undefined;

  const connect = (): void => {
    if (source) {
      return;
    }

    source = new EventSource('/api/events');
    source.onopen = () => {
      isConnected.value = true;
    };

    source.onmessage = (event) => {
      messages.value.unshift({ event: 'message', data: event.data });
      messages.value = messages.value.slice(0, 100);
    };

    source.addEventListener('job_progress', (event) => {
      const messageEvent = event as MessageEvent<string>;
      messages.value.unshift({ event: 'job_progress', data: messageEvent.data });
      messages.value = messages.value.slice(0, 100);
    });

    source.onerror = () => {
      isConnected.value = false;
    };
  };

  const disconnect = (): void => {
    source?.close();
    source = undefined;
    isConnected.value = false;
  };

  onBeforeUnmount(disconnect);

  return {
    isConnected,
    messages,
    connect,
    disconnect,
  };
};
