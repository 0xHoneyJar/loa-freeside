/**
 * Component Registry Service
 *
 * Central registry for component definitions with validation.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.1 Component Registry Architecture
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type {
  ComponentType,
  ComponentCategory,
  ComponentDefinition,
  ComponentValidationResult,
  ComponentValidationError,
  ComponentValidationWarning,
  ComponentProps,
  PropSchema,
  PropSchemaProperty,
} from '../../types/theme-component.types.js';

// =============================================================================
// Zod Schema Generation from PropSchema
// =============================================================================

/**
 * Convert PropSchemaProperty to Zod schema
 */
function propSchemaPropertyToZod(property: PropSchemaProperty): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (property.type) {
    case 'string':
      let strSchema = z.string();
      if (property.minLength !== undefined) {
        strSchema = strSchema.min(property.minLength);
      }
      if (property.maxLength !== undefined) {
        strSchema = strSchema.max(property.maxLength);
      }
      if (property.pattern !== undefined) {
        strSchema = strSchema.regex(new RegExp(property.pattern));
      }
      if (property.enum !== undefined) {
        schema = z.enum(property.enum as [string, ...string[]]);
      } else {
        schema = strSchema;
      }
      break;

    case 'number':
      let numSchema = z.number();
      if (property.minimum !== undefined) {
        numSchema = numSchema.min(property.minimum);
      }
      if (property.maximum !== undefined) {
        numSchema = numSchema.max(property.maximum);
      }
      schema = numSchema;
      break;

    case 'boolean':
      schema = z.boolean();
      break;

    case 'array':
      if (property.items) {
        schema = z.array(propSchemaPropertyToZod(property.items));
      } else {
        schema = z.array(z.unknown());
      }
      break;

    case 'object':
      if (property.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(property.properties)) {
          shape[key] = propSchemaPropertyToZod(value);
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.unknown());
      }
      break;

    default:
      schema = z.unknown();
  }

  // Apply default if present
  if (property.default !== undefined) {
    schema = schema.default(property.default);
  }

  return schema;
}

/**
 * Convert PropSchema to Zod object schema
 */
function propSchemaToZod(propSchema: PropSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(propSchema.properties)) {
    let fieldSchema = propSchemaPropertyToZod(property);

    // Mark as optional if not in required array
    if (!propSchema.required?.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

// =============================================================================
// Component Registry Service
// =============================================================================

/**
 * ComponentRegistration - Full component definition for registry
 */
export interface ComponentRegistration {
  type: ComponentType;
  definition: ComponentDefinition;
}

/**
 * ComponentRegistry - Central registry for component definitions
 *
 * Provides:
 * - Component registration and lookup
 * - Props validation against schemas
 * - Component categorization
 */
export class ComponentRegistry {
  private static instance: ComponentRegistry;
  private components: Map<ComponentType, ComponentDefinition> = new Map();
  private categories: Map<ComponentCategory, ComponentType[]> = new Map();
  private zodSchemas: Map<ComponentType, z.ZodObject<Record<string, z.ZodTypeAny>>> = new Map();

  private constructor() {
    // Initialize category lists
    this.categories.set('web3', []);
    this.categories.set('content', []);
    this.categories.set('layout', []);
    this.categories.set('interactive', []);
  }

  /**
   * Get the singleton registry instance
   */
  static getInstance(): ComponentRegistry {
    if (!ComponentRegistry.instance) {
      ComponentRegistry.instance = new ComponentRegistry();
    }
    return ComponentRegistry.instance;
  }

  /**
   * Reset the registry (for testing)
   */
  static resetInstance(): void {
    ComponentRegistry.instance = new ComponentRegistry();
  }

  /**
   * Register a component definition
   */
  registerComponent(registration: ComponentRegistration): void {
    const { type, definition } = registration;

    // Check for duplicate registration
    if (this.components.has(type)) {
      logger.warn({ type }, 'Overwriting existing component registration');
    }

    // Store component definition
    this.components.set(type, definition);

    // Add to category list
    const categoryList = this.categories.get(definition.category);
    if (categoryList && !categoryList.includes(type)) {
      categoryList.push(type);
    }

    // Generate and cache Zod schema
    try {
      const zodSchema = propSchemaToZod(definition.propsSchema);
      this.zodSchemas.set(type, zodSchema);
    } catch (error) {
      logger.error({ type, error }, 'Failed to generate Zod schema for component');
    }

    logger.debug({ type, category: definition.category }, 'Component registered');
  }

  /**
   * Get a component definition by type
   */
  getComponent(type: ComponentType): ComponentDefinition | undefined {
    return this.components.get(type);
  }

  /**
   * List all registered components
   */
  listComponents(): ComponentDefinition[] {
    return Array.from(this.components.values());
  }

  /**
   * List components by category
   */
  listComponentsByCategory(category: ComponentCategory): ComponentDefinition[] {
    const types = this.categories.get(category) ?? [];
    return types.map((type) => this.components.get(type)).filter(Boolean) as ComponentDefinition[];
  }

  /**
   * Get all categories with their component counts
   */
  getCategories(): Array<{ category: ComponentCategory; count: number }> {
    return Array.from(this.categories.entries()).map(([category, types]) => ({
      category,
      count: types.length,
    }));
  }

  /**
   * Validate component props against the component's schema
   */
  validateProps(type: ComponentType, props: Record<string, unknown>): ComponentValidationResult {
    const definition = this.components.get(type);
    if (!definition) {
      return {
        valid: false,
        errors: [
          {
            path: 'type',
            message: `Unknown component type: ${type}`,
            code: 'UNKNOWN_TYPE',
          },
        ],
        warnings: [],
      };
    }

    const zodSchema = this.zodSchemas.get(type);
    if (!zodSchema) {
      return {
        valid: false,
        errors: [
          {
            path: '',
            message: `No validation schema available for component type: ${type}`,
            code: 'NO_SCHEMA',
          },
        ],
        warnings: [],
      };
    }

    const result = zodSchema.safeParse(props);
    if (result.success) {
      const warnings: ComponentValidationWarning[] = [];

      // Check for deprecated props (could add metadata for this)
      // Check for recommended props not set
      if (definition.requiresContract && !('contractId' in props)) {
        warnings.push({
          path: 'contractId',
          message: 'This component works best with a contract binding',
          code: 'MISSING_RECOMMENDED',
        });
      }

      return {
        valid: true,
        errors: [],
        warnings,
      };
    }

    // Convert Zod errors to our format
    const errors: ComponentValidationError[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code.toUpperCase(),
    }));

    return {
      valid: false,
      errors,
      warnings: [],
    };
  }

  /**
   * Get default props for a component type
   */
  getDefaultProps(type: ComponentType): ComponentProps | undefined {
    const definition = this.components.get(type);
    return definition?.defaultProps;
  }

  /**
   * Check if a component type exists
   */
  hasComponent(type: ComponentType): boolean {
    return this.components.has(type);
  }

  /**
   * Get component count
   */
  getComponentCount(): number {
    return this.components.size;
  }
}

/**
 * Get the singleton ComponentRegistry instance
 */
export const componentRegistry = ComponentRegistry.getInstance();
