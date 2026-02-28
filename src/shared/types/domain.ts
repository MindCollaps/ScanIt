/**
 * Shared domain types used across server and client.
 */

export type JobState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  details?: Record<string, string>;
}

export interface ScanJob {
  id: string;
  profileId: string;
  scannerId: string;
  presetId: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ScanArtifact {
  id: string;
  jobId: string;
  kind: 'pdf' | 'image' | 'thumbnail' | 'preview';
  path: string;
  mimeType: string;
  bytes: number;
}

export interface JobProgressEvent {
  jobId: string;
  pageNumber: number;
  totalPages?: number;
  message: string;
  timestamp: string;
}

export interface SseEvent<TPayload> {
  id: string;
  type: string;
  payload: TPayload;
  timestamp: string;
}
