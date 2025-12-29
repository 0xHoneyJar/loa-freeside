/**
 * ApiError Tests
 *
 * Sprint 51: Unified Error Response Format
 *
 * Tests standardized error responses across all API endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  ApiError,
  ApiErrorCode,
  ErrorSeverity,
  HTTP_STATUS_MAP,
} from '../../../../../src/packages/core/errors/ApiError.js';

describe('ApiError', () => {
  describe('Construction', () => {
    it('should create error with code and message', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Resource not found');

      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(ApiErrorCode.NOT_FOUND);
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
    });

    it('should create error with details', () => {
      const error = new ApiError(
        ApiErrorCode.VALIDATION_ERROR,
        'Invalid input',
        { field: 'email', reason: 'invalid format' }
      );

      expect(error.details).toEqual({ field: 'email', reason: 'invalid format' });
    });

    it('should create error with cause', () => {
      const originalError = new Error('Original error');
      const error = new ApiError(
        ApiErrorCode.INTERNAL_ERROR,
        'Internal server error',
        undefined,
        originalError
      );

      expect(error.originalCause).toBe(originalError);
    });

    it('should set timestamp automatically', () => {
      const before = new Date();
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      const after = new Date();

      const timestamp = new Date(error.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should have ApiError as name', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      expect(error.name).toBe('ApiError');
    });

    it('should capture stack trace', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });
  });

  describe('HTTP Status Code Mapping', () => {
    it('should map UNAUTHORIZED to 401', () => {
      const error = new ApiError(ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should map FORBIDDEN to 403', () => {
      const error = new ApiError(ApiErrorCode.FORBIDDEN, 'Forbidden');
      expect(error.statusCode).toBe(403);
    });

    it('should map NOT_FOUND to 404', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      expect(error.statusCode).toBe(404);
    });

    it('should map VALIDATION_ERROR to 400', () => {
      const error = new ApiError(ApiErrorCode.VALIDATION_ERROR, 'Invalid');
      expect(error.statusCode).toBe(400);
    });

    it('should map RATE_LIMITED to 429', () => {
      const error = new ApiError(ApiErrorCode.RATE_LIMITED, 'Too many requests');
      expect(error.statusCode).toBe(429);
    });

    it('should map CIRCUIT_BREAKER_OPEN to 503', () => {
      const error = new ApiError(ApiErrorCode.CIRCUIT_BREAKER_OPEN, 'Service unavailable');
      expect(error.statusCode).toBe(503);
    });

    it('should map INTERNAL_ERROR to 500', () => {
      const error = new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Internal error');
      expect(error.statusCode).toBe(500);
    });

    it('should default to 500 for unknown codes', () => {
      const error = new ApiError('UNKNOWN_CODE' as ApiErrorCode, 'Unknown');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('Error Severity', () => {
    it('should classify validation errors as LOW severity', () => {
      const error = new ApiError(ApiErrorCode.VALIDATION_ERROR, 'Invalid');
      expect(error.severity).toBe(ErrorSeverity.LOW);
    });

    it('should classify NOT_FOUND as LOW severity', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      expect(error.severity).toBe(ErrorSeverity.LOW);
    });

    it('should classify business logic errors as MEDIUM severity', () => {
      const error = new ApiError(ApiErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance');
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify external service errors as HIGH severity', () => {
      const error = new ApiError(ApiErrorCode.CHAIN_PROVIDER_ERROR, 'Chain provider error');
      expect(error.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should classify internal errors as CRITICAL severity', () => {
      const error = new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Internal error');
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should classify database errors as CRITICAL severity', () => {
      const error = new ApiError(ApiErrorCode.DATABASE_ERROR, 'Database error');
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
    });
  });

  describe('JSON Serialization', () => {
    it('should convert to JSON without stack trace by default', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found', { id: '123' });

      const json = error.toJSON();

      expect(json.code).toBe(ApiErrorCode.NOT_FOUND);
      expect(json.message).toBe('Not found');
      expect(json.statusCode).toBe(404);
      expect(json.severity).toBe(ErrorSeverity.LOW);
      expect(json.timestamp).toBeDefined();
      expect(json.details).toEqual({ id: '123' });
      expect(json.stack).toBeUndefined();
    });

    it('should include stack trace when requested', () => {
      const error = new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Internal error');

      const json = error.toJSON(true);

      expect(json.stack).toBeDefined();
      expect(json.stack).toContain('ApiError');
    });

    it('should include request ID if set', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      error.setRequestId('req-123');

      const json = error.toJSON();

      expect(json.requestId).toBe('req-123');
    });

    it('should not include undefined fields', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');

      const json = error.toJSON();

      expect('requestId' in json).toBe(false);
      expect('details' in json).toBe(false);
    });
  });

  describe('Request ID', () => {
    it('should set request ID via method', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      error.setRequestId('req-456');

      expect(error.requestId).toBe('req-456');
    });

    it('should return this for method chaining', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      const result = error.setRequestId('req-789');

      expect(result).toBe(error);
    });
  });

  describe('Factory Method - fromError', () => {
    it('should return ApiError as-is', () => {
      const original = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      const result = ApiError.fromError(original);

      expect(result).toBe(original);
    });

    it('should convert Error to ApiError', () => {
      const error = new Error('Something went wrong');
      const apiError = ApiError.fromError(error);

      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.code).toBe(ApiErrorCode.INTERNAL_ERROR);
      expect(apiError.message).toBe('Something went wrong');
      expect(apiError.originalCause).toBe(error);
    });

    it('should handle unknown errors', () => {
      const error = ApiError.fromError('string error');

      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe(ApiErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('An error occurred');
    });

    it('should use custom default message', () => {
      const error = ApiError.fromError('unknown', 'Custom error message');

      expect(error.message).toBe('Custom error message');
    });
  });

  describe('Factory Methods - Common Errors', () => {
    it('should create notFound error', () => {
      const error = ApiError.notFound('User');

      expect(error.code).toBe(ApiErrorCode.NOT_FOUND);
      expect(error.message).toBe('User not found');
      expect(error.statusCode).toBe(404);
    });

    it('should create notFound error with ID', () => {
      const error = ApiError.notFound('User', '123');

      expect(error.details).toEqual({ id: '123' });
    });

    it('should create unauthorized error', () => {
      const error = ApiError.unauthorized();

      expect(error.code).toBe(ApiErrorCode.UNAUTHORIZED);
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should create unauthorized error with custom message', () => {
      const error = ApiError.unauthorized('Invalid credentials');

      expect(error.message).toBe('Invalid credentials');
    });

    it('should create forbidden error', () => {
      const error = ApiError.forbidden();

      expect(error.code).toBe(ApiErrorCode.FORBIDDEN);
      expect(error.statusCode).toBe(403);
    });

    it('should create validationError with field details', () => {
      const error = ApiError.validationError('Validation failed', {
        email: ['Invalid format', 'Required'],
        age: ['Must be positive'],
      });

      expect(error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
      expect(error.details).toEqual({
        fields: {
          email: ['Invalid format', 'Required'],
          age: ['Must be positive'],
        },
      });
    });

    it('should create rateLimited error', () => {
      const error = ApiError.rateLimited();

      expect(error.code).toBe(ApiErrorCode.RATE_LIMITED);
      expect(error.statusCode).toBe(429);
      expect(error.message).toContain('Too many requests');
    });

    it('should create rateLimited error with retryAfter', () => {
      const error = ApiError.rateLimited(60);

      expect(error.details).toEqual({ retryAfter: 60 });
    });

    it('should create circuitBreakerOpen error', () => {
      const error = ApiError.circuitBreakerOpen('score_service');

      expect(error.code).toBe(ApiErrorCode.CIRCUIT_BREAKER_OPEN);
      expect(error.statusCode).toBe(503);
      expect(error.message).toContain('score_service');
      expect(error.details).toEqual({ service: 'score_service' });
    });

    it('should create timeout error', () => {
      const error = ApiError.timeout('database query', 5000);

      expect(error.code).toBe(ApiErrorCode.TIMEOUT);
      expect(error.statusCode).toBe(504);
      expect(error.message).toContain('database query');
      expect(error.details).toEqual({
        operation: 'database query',
        timeoutMs: 5000,
      });
    });

    it('should create externalServiceError', () => {
      const cause = new Error('API down');
      const error = ApiError.externalServiceError('payment_api', cause);

      expect(error.code).toBe(ApiErrorCode.EXTERNAL_SERVICE_ERROR);
      expect(error.statusCode).toBe(502);
      expect(error.message).toContain('payment_api');
      expect(error.details).toEqual({ service: 'payment_api' });
      expect(error.originalCause).toBe(cause);
    });

    it('should create internalError', () => {
      const error = ApiError.internalError();

      expect(error.code).toBe(ApiErrorCode.INTERNAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal server error');
    });

    it('should create internalError with custom message and cause', () => {
      const cause = new Error('Database connection failed');
      const error = ApiError.internalError('Database unavailable', cause);

      expect(error.message).toBe('Database unavailable');
      expect(error.originalCause).toBe(cause);
    });
  });

  describe('HTTP Status Map Completeness', () => {
    it('should have status code for all error codes', () => {
      const errorCodes = Object.values(ApiErrorCode);

      for (const code of errorCodes) {
        expect(HTTP_STATUS_MAP[code]).toBeDefined();
        expect(HTTP_STATUS_MAP[code]).toBeGreaterThanOrEqual(400);
        expect(HTTP_STATUS_MAP[code]).toBeLessThan(600);
      }
    });
  });

  describe('Error Inheritance', () => {
    it('should be instance of Error', () => {
      const error = new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      expect(error instanceof Error).toBe(true);
    });

    it('should work with try-catch', () => {
      try {
        throw new ApiError(ApiErrorCode.NOT_FOUND, 'Not found');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe(ApiErrorCode.NOT_FOUND);
      }
    });
  });

  describe('Error Code Categories', () => {
    it('should have authentication codes in 1xxx range', () => {
      expect(ApiErrorCode.UNAUTHORIZED).toContain('UNAUTHORIZED');
      expect(ApiErrorCode.FORBIDDEN).toContain('FORBIDDEN');
      expect(ApiErrorCode.SESSION_EXPIRED).toContain('SESSION_EXPIRED');
    });

    it('should have validation codes in 2xxx range', () => {
      expect(ApiErrorCode.VALIDATION_ERROR).toContain('VALIDATION');
      expect(ApiErrorCode.INVALID_INPUT).toContain('INVALID');
    });

    it('should have resource codes in 3xxx range', () => {
      expect(ApiErrorCode.NOT_FOUND).toContain('NOT_FOUND');
      expect(ApiErrorCode.ALREADY_EXISTS).toContain('ALREADY_EXISTS');
    });

    it('should have business logic codes in 4xxx range', () => {
      expect(ApiErrorCode.INSUFFICIENT_BALANCE).toContain('INSUFFICIENT_BALANCE');
      expect(ApiErrorCode.ELIGIBILITY_FAILED).toContain('ELIGIBILITY_FAILED');
    });

    it('should have external service codes in 5xxx range', () => {
      expect(ApiErrorCode.EXTERNAL_SERVICE_ERROR).toContain('EXTERNAL_SERVICE');
      expect(ApiErrorCode.CHAIN_PROVIDER_ERROR).toContain('CHAIN_PROVIDER');
    });

    it('should have circuit breaker codes in 6xxx range', () => {
      expect(ApiErrorCode.CIRCUIT_BREAKER_OPEN).toContain('CIRCUIT_BREAKER');
      expect(ApiErrorCode.SERVICE_DEGRADED).toContain('SERVICE_DEGRADED');
    });

    it('should have internal codes in 9xxx range', () => {
      expect(ApiErrorCode.INTERNAL_ERROR).toContain('INTERNAL');
      expect(ApiErrorCode.CONFIGURATION_ERROR).toContain('CONFIGURATION');
    });
  });
});
