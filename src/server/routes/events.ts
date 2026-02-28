import { Router } from 'express';
import type { SseBroker } from '../sse/broker.js';

/**
 * Server-Sent Events endpoint for real-time job and config updates.
 */
export const createEventsRouter = (broker: SseBroker): Router => {
  const router = Router();

  router.get('/api/events', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const clientId = broker.addClient(response);

    const replayBuffer = broker.getReplayBuffer();
    for (const event of replayBuffer) {
      response.write(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
      );
    }

    const heartbeatTimer = setInterval(() => {
      response.write(
        `event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`,
      );
    }, 15000);

    request.on('close', () => {
      clearInterval(heartbeatTimer);
      broker.removeClient(clientId);
      response.end();
    });
  });

  return router;
};
