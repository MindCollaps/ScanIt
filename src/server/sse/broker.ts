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

/**
 * Broadcasts server-side events to connected SSE clients.
 */
export class SseBroker {
  private readonly clients = new Map<string, SseClient>();
  private readonly replayBuffer: SseEnvelope[] = [];

  public constructor(private readonly replayBufferSize: number) {}

  public addClient(response: Response): string {
    const id = randomUUID();
    this.clients.set(id, { id, response });
    return id;
  }

  public removeClient(clientId: string): void {
    this.clients.delete(clientId);
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
  }

  public getReplayBuffer(): SseEnvelope[] {
    return [...this.replayBuffer];
  }
}
