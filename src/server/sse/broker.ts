import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface SseEnvelope {
  id: string;
  type: string;
  timestamp: string;
  payload: unknown;
}

interface SseClient {
  id: string;
  response: Response;
}

export type BrokerEventCallback = (payload: unknown) => void;

/**
 * Broadcasts server-side events to connected SSE clients.
 */
export class SseBroker {
  private readonly clients = new Map<string, SseClient>();
  private readonly replayBuffer: SseEnvelope[] = [];
  private readonly listeners = new Map<string, Set<BrokerEventCallback>>();

  public constructor(private readonly replayBufferSize: number) {}

  public addClient(response: Response): string {
    const id = randomUUID();
    this.clients.set(id, { id, response });
    return id;
  }

  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /** Register a programmatic listener for a specific event type. */
  public on(type: string, callback: BrokerEventCallback): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(callback);
  }

  /** Remove a previously registered listener. */
  public off(type: string, callback: BrokerEventCallback): void {
    this.listeners.get(type)?.delete(callback);
  }

  public emit(type: string, payload: unknown): void {
    const event: SseEnvelope = {
      id: randomUUID(),
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.replayBuffer.push(event);
    if (this.replayBuffer.length > this.replayBufferSize) {
      this.replayBuffer.shift();
    }

    const serialized = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;

    for (const client of this.clients.values()) {
      client.response.write(serialized);
    }

    // Notify programmatic listeners
    const callbacks = this.listeners.get(type);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(event.payload);
        } catch {
          // Listener errors must not break the emit loop
        }
      }
    }
  }

  public getReplayBuffer(): SseEnvelope[] {
    return [...this.replayBuffer];
  }
}
