import type { NextFunction, Request, Response } from 'express';
import { createProblem } from '../../shared/api/problem.js';
import { logger } from '../logger.js';

/**
 * Express error middleware returning RFC 7807 problem payloads.
 */
export const errorHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void => {
  const message = error instanceof Error ? error.message : 'Unhandled server error';
  logger.error({ err: error }, 'unhandled request error');
  const payload = createProblem(500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error', message);
  response.status(500).type('application/problem+json').json(payload);
};
