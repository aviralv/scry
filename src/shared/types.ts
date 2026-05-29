export interface CsrfBootstrap {
  token: string;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export type { SourceCard, Citation, RunQueryEvent } from '../engine/types.js';
export type { SessionRow, StoredTurn } from '../storage/types.js';
export type { ApiErrorBody, ApiErrorIssue } from './api-errors.js';
export { zodToApiErrors } from './api-errors.js';;
