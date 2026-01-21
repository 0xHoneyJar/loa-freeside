/**
 * Theme Contract Binding Routes
 *
 * RESTful API for managing contract bindings per theme.
 * Sprint 4: Web3 Layer - Contract Binding API
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import {
  createContractBinding,
  getContractBinding,
  getContractBindings,
  updateContractBinding,
  deleteContractBinding,
  contractBindingExistsForAddress,
} from '../../db/queries/contract-binding-queries.js';
import { themeExists } from '../../db/queries/theme-queries.js';
import {
  contractValidationService,
} from '../../services/theme/ContractValidationService.js';
import {
  contractBindingCreateSchema,
  contractBindingUpdateSchema,
} from '../../packages/core/validation/theme-schemas.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';

/**
 * UUID validation schema
 */
const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Theme contract routes (rate limited, API key required)
 */
export const themeContractRouter = Router({ mergeParams: true });

// Apply rate limiting and authentication
themeContractRouter.use(adminRateLimiter);
themeContractRouter.use(requireApiKeyAsync);

// =============================================================================
// Contract Binding CRUD Endpoints
// =============================================================================

/**
 * POST /api/themes/:themeId/contracts
 * Add a contract binding to a theme
 *
 * @body {name, chainId, address, type?, abi?, verified?, cacheTtl?}
 * @returns {201} Created contract binding
 */
themeContractRouter.post('/', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Validate input
  const inputResult = contractBindingCreateSchema.safeParse(req.body);
  if (!inputResult.success) {
    const errors = inputResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid contract binding input: ${errors}`);
  }

  const input = inputResult.data;

  // Validate contract address
  const validationResult = contractValidationService.validateContract({
    chainId: input.chainId,
    address: input.address,
    abi: input.abi,
  });

  if (!validationResult.valid) {
    const errorMessages = validationResult.errors.map((e) => e.message).join(', ');
    throw new ValidationError(`Contract validation failed: ${errorMessages}`);
  }

  // Check for duplicate
  if (contractBindingExistsForAddress(themeId, input.chainId, input.address)) {
    throw new ValidationError(
      `Contract binding already exists for chain ${input.chainId} at address ${input.address}`
    );
  }

  // Auto-detect contract type if not provided
  const detectedType = input.type ?? validationResult.type ?? 'custom';

  // Create binding
  const binding = createContractBinding({
    themeId,
    name: input.name,
    chainId: input.chainId,
    address: contractValidationService.normalizeAddress(input.address),
    type: detectedType,
    abi: input.abi,
    verified: input.verified,
    cacheTtl: input.cacheTtl,
  });

  logger.info(
    { themeId, bindingId: binding.id, chainId: binding.chainId },
    'Contract binding created'
  );

  res.status(201).json({
    success: true,
    data: binding,
    validation: {
      type: detectedType,
      readFunctions: validationResult.readFunctions,
      warnings: validationResult.warnings,
    },
  });
});

/**
 * GET /api/themes/:themeId/contracts
 * List all contract bindings for a theme
 *
 * @returns {200} Array of contract bindings
 */
themeContractRouter.get('/', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  const bindings = getContractBindings(themeId);

  res.json({
    success: true,
    data: bindings,
    count: bindings.length,
  });
});

/**
 * GET /api/themes/:themeId/contracts/:bindingId
 * Get a specific contract binding
 *
 * @returns {200} Contract binding
 */
themeContractRouter.get('/:bindingId', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  const bindingId = req.params.bindingId;
  if (!themeId || !bindingId) {
    throw new ValidationError('Missing theme ID or binding ID');
  }

  // Validate IDs
  const themeIdResult = uuidSchema.safeParse(themeId);
  const bindingIdResult = uuidSchema.safeParse(bindingId);

  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }
  if (!bindingIdResult.success) {
    throw new ValidationError('Invalid binding ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  const binding = getContractBinding(bindingId);
  if (!binding) {
    throw new NotFoundError(`Contract binding not found: ${bindingId}`);
  }

  res.json({
    success: true,
    data: binding,
  });
});

/**
 * PATCH /api/themes/:themeId/contracts/:bindingId
 * Update a contract binding
 *
 * @body {name?, abi?, type?, verified?, cacheTtl?}
 * @returns {200} Updated contract binding
 */
themeContractRouter.patch('/:bindingId', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  const bindingId = req.params.bindingId;
  if (!themeId || !bindingId) {
    throw new ValidationError('Missing theme ID or binding ID');
  }

  // Validate IDs
  const themeIdResult = uuidSchema.safeParse(themeId);
  const bindingIdResult = uuidSchema.safeParse(bindingId);

  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }
  if (!bindingIdResult.success) {
    throw new ValidationError('Invalid binding ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Validate input
  const inputResult = contractBindingUpdateSchema.safeParse(req.body);
  if (!inputResult.success) {
    const errors = inputResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid update input: ${errors}`);
  }

  const input = inputResult.data;

  // Validate ABI if provided
  if (input.abi) {
    const abiResult = contractValidationService.validateAbi(input.abi);
    if (!abiResult.valid) {
      const errorMessages = abiResult.errors.map((e) => e.message).join(', ');
      throw new ValidationError(`ABI validation failed: ${errorMessages}`);
    }
  }

  // Update binding
  const updated = updateContractBinding(bindingId, input);
  if (!updated) {
    throw new NotFoundError(`Contract binding not found: ${bindingId}`);
  }

  logger.info(
    { themeId, bindingId, updates: Object.keys(input) },
    'Contract binding updated'
  );

  res.json({
    success: true,
    data: updated,
  });
});

/**
 * DELETE /api/themes/:themeId/contracts/:bindingId
 * Delete a contract binding
 *
 * @returns {200} Success
 */
themeContractRouter.delete('/:bindingId', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  const bindingId = req.params.bindingId;
  if (!themeId || !bindingId) {
    throw new ValidationError('Missing theme ID or binding ID');
  }

  // Validate IDs
  const themeIdResult = uuidSchema.safeParse(themeId);
  const bindingIdResult = uuidSchema.safeParse(bindingId);

  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }
  if (!bindingIdResult.success) {
    throw new ValidationError('Invalid binding ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  const deleted = deleteContractBinding(bindingId);
  if (!deleted) {
    throw new NotFoundError(`Contract binding not found: ${bindingId}`);
  }

  logger.info({ themeId, bindingId }, 'Contract binding deleted');

  res.json({
    success: true,
    message: 'Contract binding deleted',
  });
});

/**
 * POST /api/themes/:themeId/contracts/validate
 * Validate a contract without creating a binding
 *
 * @body {chainId, address, abi?}
 * @returns {200} Validation result
 */
themeContractRouter.post('/validate', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Check theme exists
  if (!themeExists(themeId)) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Validate input (partial - just chainId and address required)
  const schema = z.object({
    chainId: z.number().int().positive(),
    address: z.string(),
    abi: z.array(z.any()).optional(),
  });

  const inputResult = schema.safeParse(req.body);
  if (!inputResult.success) {
    const errors = inputResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid input: ${errors}`);
  }

  const input = inputResult.data;

  // Validate contract
  const validationResult = contractValidationService.validateContract({
    chainId: input.chainId,
    address: input.address,
    abi: input.abi,
  });

  // Check if already exists
  const exists = contractBindingExistsForAddress(themeId, input.chainId, input.address);

  res.json({
    success: true,
    data: {
      ...validationResult,
      alreadyExists: exists,
      normalizedAddress: contractValidationService.isValidAddress(input.address)
        ? contractValidationService.normalizeAddress(input.address)
        : null,
    },
  });
});
