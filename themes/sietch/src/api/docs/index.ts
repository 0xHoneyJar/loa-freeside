/**
 * API Documentation Module
 *
 * Sprint 52: Medium Priority Hardening (P2)
 *
 * Provides OpenAPI documentation and Swagger UI for the Arrakis API.
 *
 * @module api/docs
 */

export {
  generateOpenAPIDocument,
  ErrorResponseSchema,
  PaginationSchema,
  EligibilityResponseSchema,
  WalletEligibilitySchema,
  MemberProfileSchema,
  DirectoryResponseSchema,
  HealthResponseSchema,
  ThresholdDataSchema,
  BadgeSchema,
} from './openapi.js';
