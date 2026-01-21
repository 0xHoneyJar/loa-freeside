/**
 * Theme Preview API Routes
 *
 * REST API for generating theme previews.
 * Sprint 6: Component System - Preview Engine
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { Router } from 'express';
import type { Response } from 'express';
import crypto from 'crypto';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  publicRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import { getThemeById } from '../../db/queries/theme-queries.js';
import { previewService, type PreviewOptions } from '../../services/theme/PreviewService.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';

// =============================================================================
// CSP Security Configuration (CRIT-2 Remediation)
// =============================================================================

/**
 * Generate cryptographic nonce for CSP
 * SECURITY: 16 bytes = 128 bits of entropy
 */
function generateCspNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Build strict Content-Security-Policy header
 * SECURITY: Replaces 'unsafe-inline' with nonce-based styles
 *
 * @see CRIT-2 in Security Audit Report (2026-01-21)
 */
function buildStrictCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' https: data:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
}

/**
 * Set security headers on response
 * SECURITY: Defense in depth - multiple security headers
 */
function setSecurityHeaders(res: Response, cspNonce: string): void {
  res.setHeader('Content-Security-Policy', buildStrictCsp(cspNonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/**
 * Preview request schema
 */
const previewRequestSchema = z.object({
  pageId: z.string().uuid().optional(),
  viewport: z.enum(['desktop', 'tablet', 'mobile']).optional(),
  mockMode: z.boolean().optional(),
  mockWallet: z.string().optional(),
  mockBalances: z.record(z.string()).optional(),
  fullDocument: z.boolean().optional(),
});

/**
 * UUID validation schema
 */
const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Theme preview routes (rate limited, API key required)
 */
export const themePreviewRouter = Router({ mergeParams: true });

// Apply rate limiting and authentication
themePreviewRouter.use(publicRateLimiter);
themePreviewRouter.use(requireApiKeyAsync);

// =============================================================================
// Preview Endpoints
// =============================================================================

/**
 * POST /api/themes/:themeId/preview
 * Generate a preview for a theme
 *
 * @body {pageId?, viewport?, mockMode?, mockWallet?, mockBalances?, fullDocument?}
 * @returns {200} Preview HTML and CSS
 */
themePreviewRouter.post('/', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Validate request body
  const bodyResult = previewRequestSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    const errors = bodyResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid preview options: ${errors}`);
  }

  const options: PreviewOptions = bodyResult.data;

  // Get theme
  const theme = getThemeById(themeId);
  if (!theme) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Generate CSP nonce for this request
  const cspNonce = generateCspNonce();

  // Generate preview with nonce for inline styles
  try {
    const result = previewService.generatePreview(theme, {
      ...options,
      cspNonce,
    });

    logger.info(
      { themeId, pageId: result.page.id, viewport: result.viewport },
      'Theme preview generated'
    );

    // Set strict CSP headers (CRIT-2 remediation)
    setSecurityHeaders(res, cspNonce);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error({ themeId, error }, 'Preview generation failed');
    throw new ValidationError(
      error instanceof Error ? error.message : 'Preview generation failed'
    );
  }
});

/**
 * GET /api/themes/:themeId/preview/html
 * Get preview as raw HTML document (for iframe embedding)
 *
 * @query {pageId?, viewport?, mockMode?}
 * @returns {200} HTML document
 */
themePreviewRouter.get('/html', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Parse query params
  const options: PreviewOptions = {
    pageId: typeof req.query.pageId === 'string' ? req.query.pageId : undefined,
    viewport: ['desktop', 'tablet', 'mobile'].includes(req.query.viewport as string)
      ? (req.query.viewport as 'desktop' | 'tablet' | 'mobile')
      : 'desktop',
    mockMode: req.query.mockMode !== 'false',
    fullDocument: true,
  };

  // Get theme
  const theme = getThemeById(themeId);
  if (!theme) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Generate CSP nonce for this request
  const cspNonce = generateCspNonce();

  // Generate preview with nonce for inline styles
  try {
    const result = previewService.generatePreview(theme, {
      ...options,
      cspNonce,
    });

    // Set strict CSP headers (CRIT-2 remediation)
    setSecurityHeaders(res, cspNonce);

    // Return HTML directly
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.html);
  } catch (error) {
    logger.error({ themeId, error }, 'Preview generation failed');

    // Generate error page with its own nonce
    const errorNonce = generateCspNonce();
    setSecurityHeaders(res, errorNonce);

    // Return error as HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Preview Error</title>
        <style nonce="${errorNonce}">
          body { font-family: sans-serif; padding: 2rem; text-align: center; }
        </style>
      </head>
      <body>
        <h1>Preview Error</h1>
        <p>${error instanceof Error ? error.message : 'An error occurred'}</p>
      </body>
      </html>
    `);
  }
});

/**
 * GET /api/themes/:themeId/preview/css
 * Get preview CSS only (for style extraction)
 *
 * @returns {200} CSS text
 */
themePreviewRouter.get('/css', (req: AuthenticatedRequest, res: Response) => {
  const themeId = req.params.themeId;
  if (!themeId) {
    throw new ValidationError('Missing theme ID');
  }

  // Validate theme ID
  const themeIdResult = uuidSchema.safeParse(themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  // Get theme
  const theme = getThemeById(themeId);
  if (!theme) {
    throw new NotFoundError(`Theme not found: ${themeId}`);
  }

  // Generate preview just to get CSS
  try {
    const result = previewService.generatePreview(theme, { mockMode: true });

    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.send(result.css);
  } catch (error) {
    logger.error({ themeId, error }, 'CSS generation failed');
    throw new ValidationError(
      error instanceof Error ? error.message : 'CSS generation failed'
    );
  }
});
