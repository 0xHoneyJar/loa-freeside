/**
 * Core Errors - Unified Error Handling
 *
 * Sprint 51: High Priority Hardening (P1)
 *
 * @module packages/core/errors
 */

export { ApiError, HTTP_STATUS_MAP, apiErrorHandler } from './ApiError.js';
export type {
  ApiErrorCode,
  ApiErrorMetadata,
  ErrorSeverity,
} from './ApiError.js';
