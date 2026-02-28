import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Application-wide structured logger.
 * Uses pino-pretty as a synchronous stream in dev (Bun-compatible).
 * In production, outputs JSON to stdout.
 */
let devStream: pino.DestinationStream | undefined;
if (isDev) {
  try {
    // pino-pretty is a devDependency – only available outside production
    const mod = await import('pino-pretty');
    const pretty = typeof mod === 'function' ? mod : (mod as unknown as { default: typeof mod }).default;
    devStream = pretty({
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname,name',
    });
  } catch {
    // Fallback: pino-pretty not installed, use default JSON output
  }
}

export const logger = pino(
  {
    name: 'scanit',
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  },
  devStream,
);

export type Logger = pino.Logger;
