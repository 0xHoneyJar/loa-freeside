/**
 * Swagger UI Route Handler
 *
 * Sprint 52: Medium Priority Hardening (P2)
 *
 * Serves OpenAPI documentation via Swagger UI.
 *
 * @module api/docs/swagger
 */

import { Router, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { generateOpenAPIDocument } from './openapi.js';

// Generate OpenAPI document at startup
const openAPIDocument = generateOpenAPIDocument();

// Create documentation router
export const docsRouter = Router();

// Serve OpenAPI JSON
docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openAPIDocument);
});

// Serve Swagger UI
docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(openAPIDocument, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Arrakis API Documentation',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
    },
  })
);
