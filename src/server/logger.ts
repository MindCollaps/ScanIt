import pino from 'pino';

/**
 * Application-wide structured logger.
 * In production, outputs JSON; in development, uses pretty printing.
 */
export const logger = pino({
  name: 'scanit',
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 },
    },
  }),
});

export type Logger = pino.Logger;
