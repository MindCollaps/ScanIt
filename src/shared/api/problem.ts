import type { ProblemDetails } from '../types/domain.js';

/**
 * Creates an RFC 7807 compatible problem response payload.
 */
export const createProblem = (
  status: number,
  code: string,
  title: string,
  detail?: string,
  details?: Record<string, string>,
): ProblemDetails => {
  const payload: ProblemDetails = {
    type: `https://scanit.dev/problems/${code.toLowerCase()}`,
    status,
    code,
    title,
  };

  if (detail !== undefined) {
    payload.detail = detail;
  }

  if (details !== undefined) {
    payload.details = details;
  }

  return payload;
};
