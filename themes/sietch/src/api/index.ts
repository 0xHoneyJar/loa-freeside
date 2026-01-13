/**
 * API Module Exports
 */

export { startServer, stopServer, getApp } from './server.js';
export { publicRouter, adminRouter, memberRouter } from './routes.js';
export { telegramRouter } from './telegram.routes.js';
export { docsRouter } from './docs/swagger.js';
export { generateOpenAPIDocument } from './docs/index.js';
export {
  publicRateLimiter,
  adminRateLimiter,
  memberRateLimiter,
  requireApiKey,
  errorHandler,
  notFoundHandler,
  ValidationError,
  NotFoundError,
  type AuthenticatedRequest,
} from './middleware.js';
