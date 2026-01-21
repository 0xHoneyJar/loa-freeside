/**
 * Component API Routes
 *
 * RESTful API for component discovery and validation.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §6.2 Component Registry API
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  componentRegistry,
  registerMVPComponents,
} from '../../services/theme/index.js';
import {
  publicRateLimiter,
  ValidationError,
} from '../middleware.js';
import { logger } from '../../utils/logger.js';
import type {
  ComponentType,
  ComponentCategory,
} from '../../types/theme-component.types.js';

// Initialize components on module load
registerMVPComponents();

/**
 * Component routes (public, rate limited)
 */
export const componentRouter = Router();

// Apply rate limiting
componentRouter.use(publicRateLimiter);

// =============================================================================
// Component Discovery Endpoints
// =============================================================================

/**
 * GET /api/components
 * List all available components
 *
 * @query {string} category - Filter by category (optional)
 * @returns {200} Array of component definitions
 */
componentRouter.get('/', (_req: Request, res: Response) => {
  const category = _req.query.category as ComponentCategory | undefined;

  let components;
  if (category) {
    // Validate category
    const validCategories: ComponentCategory[] = ['web3', 'content', 'layout', 'interactive'];
    if (!validCategories.includes(category)) {
      throw new ValidationError(`Invalid category: ${category}. Valid categories: ${validCategories.join(', ')}`);
    }
    components = componentRegistry.listComponentsByCategory(category);
  } else {
    components = componentRegistry.listComponents();
  }

  // Transform to API response format
  const responseComponents = components.map((def) => ({
    type: def.type,
    name: def.name,
    description: def.description,
    category: def.category,
    icon: def.icon,
    propsSchema: def.propsSchema,
    defaultProps: def.defaultProps,
    minWidth: def.minWidth,
    minHeight: def.minHeight,
    maxInstances: def.maxInstances,
    requiresWeb3: def.requiresWeb3 ?? false,
    requiresContract: def.requiresContract ?? false,
  }));

  res.json({
    success: true,
    data: responseComponents,
    count: responseComponents.length,
  });
});

/**
 * GET /api/components/categories
 * List component categories with counts
 *
 * @returns {200} Array of categories with component counts
 */
componentRouter.get('/categories', (_req: Request, res: Response) => {
  const categories = componentRegistry.getCategories();

  res.json({
    success: true,
    data: categories,
  });
});

/**
 * GET /api/components/:type
 * Get a specific component definition
 *
 * @param {string} type - Component type
 * @returns {200} Component definition
 * @returns {404} Component not found
 */
componentRouter.get('/:type', (req: Request, res: Response) => {
  const type = req.params.type as ComponentType;

  const definition = componentRegistry.getComponent(type);
  if (!definition) {
    res.status(404).json({
      success: false,
      error: `Component not found: ${type}`,
    });
    return;
  }

  res.json({
    success: true,
    data: {
      type: definition.type,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      icon: definition.icon,
      propsSchema: definition.propsSchema,
      defaultProps: definition.defaultProps,
      minWidth: definition.minWidth,
      minHeight: definition.minHeight,
      maxInstances: definition.maxInstances,
      requiresWeb3: definition.requiresWeb3 ?? false,
      requiresContract: definition.requiresContract ?? false,
    },
  });
});

// =============================================================================
// Component Validation Endpoints
// =============================================================================

/**
 * Validation request schema
 */
const validateComponentSchema = z.object({
  type: z.string(),
  props: z.record(z.unknown()),
});

/**
 * POST /api/components/validate
 * Validate component props against the component's schema
 *
 * @body {type: string, props: object}
 * @returns {200} Validation result
 */
componentRouter.post('/validate', (req: Request, res: Response) => {
  // Validate request body
  const bodyResult = validateComponentSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errors = bodyResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid request body: ${errors}`);
  }

  const { type, props } = bodyResult.data;

  // Check if component type exists
  if (!componentRegistry.hasComponent(type as ComponentType)) {
    res.json({
      success: true,
      data: {
        valid: false,
        errors: [
          {
            path: 'type',
            message: `Unknown component type: ${type}`,
            code: 'UNKNOWN_TYPE',
          },
        ],
        warnings: [],
      },
    });
    return;
  }

  // Validate props
  const validationResult = componentRegistry.validateProps(type as ComponentType, props);

  logger.debug(
    { type, valid: validationResult.valid, errorCount: validationResult.errors.length },
    'Component validation performed'
  );

  res.json({
    success: true,
    data: validationResult,
  });
});

/**
 * POST /api/components/:type/defaults
 * Get default props for a component type with optional overrides
 *
 * @param {string} type - Component type
 * @body {object} overrides - Optional prop overrides
 * @returns {200} Merged props
 */
componentRouter.post('/:type/defaults', (req: Request, res: Response) => {
  const type = req.params.type as ComponentType;

  const definition = componentRegistry.getComponent(type);
  if (!definition) {
    res.status(404).json({
      success: false,
      error: `Component not found: ${type}`,
    });
    return;
  }

  const overrides = req.body || {};
  const defaultProps = definition.defaultProps;

  // Merge defaults with overrides
  const mergedProps = {
    ...defaultProps,
    ...overrides,
    type, // Ensure type is always correct
  };

  res.json({
    success: true,
    data: mergedProps,
  });
});
