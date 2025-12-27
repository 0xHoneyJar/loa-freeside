import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { publicRouter, adminRouter, memberRouter, billingRouter, badgeRouter, boostRouter } from './routes.js';
import { telegramRouter } from './telegram.routes.js';
import { adminRouter as billingAdminRouter } from './admin.routes.js';
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from './middleware.js';

/**
 * Express application instance
 */
let app: Application | null = null;

/**
 * HTTP server instance
 */
let server: ReturnType<Application['listen']> | null = null;

/**
 * Create and configure the Express application
 */
function createApp(): Application {
  const expressApp = express();

  // Trust proxy for X-Forwarded-For headers (needed for rate limiting behind nginx)
  expressApp.set('trust proxy', 1);

  // Request ID middleware
  expressApp.use(requestIdMiddleware);

  // Request logging via pino-http
  const httpLogger = pinoHttp({
    logger,
    // Don't log health checks to reduce noise
    autoLogging: {
      ignore: (req: IncomingMessage) => req.url === '/health',
    },
    // Custom serializers for cleaner logs
    serializers: {
      req: (req: IncomingMessage) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res: ServerResponse) => ({
        statusCode: res.statusCode,
      }),
    },
  });

  expressApp.use(httpLogger);

  // CORS headers
  expressApp.use((req, res, next) => {
    // Allow requests from any origin (Collab.Land will be calling from various sources)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Request-ID, X-Member-Nym');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // Raw body parser for Stripe webhook (must be before JSON parsing)
  // Stripe requires raw body for signature verification
  // We use a custom verify function to attach the raw body to the request
  expressApp.use('/api/billing/webhook', express.raw({
    type: 'application/json',
    verify: (req: any, _res, buf) => {
      // Attach raw body buffer to request for signature verification
      req.rawBody = buf;
    },
  }));

  // JSON body parsing
  expressApp.use(express.json({ limit: '10kb' }));

  // Public routes
  expressApp.use('/', publicRouter);

  // Member API routes (under /api prefix)
  expressApp.use('/api', memberRouter);

  // Billing routes (v4.0 - Sprint 23)
  expressApp.use('/api/billing', billingRouter);

  // Badge routes (v4.0 - Sprint 27)
  expressApp.use('/api/badge', badgeRouter);

  // Boost routes (v4.0 - Sprint 28)
  expressApp.use('/api/boosts', boostRouter);

  // Telegram routes (v4.1 - Sprint 30)
  expressApp.use('/telegram', telegramRouter);

  // Admin routes (under /admin prefix)
  expressApp.use('/admin', adminRouter);

  // Billing admin routes (v4.0 - Sprint 26)
  expressApp.use('/admin', billingAdminRouter);

  // 404 handler
  expressApp.use(notFoundHandler);

  // Global error handler
  expressApp.use(errorHandler);

  return expressApp;
}

/**
 * Start the Express server
 */
export async function startServer(): Promise<void> {
  // Initialize database first
  initDatabase();

  // Create Express app
  app = createApp();

  // Start listening
  const { port, host } = config.api;

  await new Promise<void>((resolve, reject) => {
    server = app!.listen(port, host, () => {
      logger.info({ port, host }, 'API server started');
      resolve();
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.fatal({ port }, 'Port already in use');
      } else {
        logger.fatal({ error }, 'Failed to start server');
      }
      reject(error);
    });
  });

  // Set up graceful shutdown
  setupGracefulShutdown();
}

/**
 * Stop the Express server
 */
export async function stopServer(): Promise<void> {
  if (!server) {
    return;
  }

  logger.info('Stopping API server...');

  await new Promise<void>((resolve) => {
    server!.close(() => {
      logger.info('API server stopped');
      resolve();
    });

    // Force close after timeout
    setTimeout(() => {
      logger.warn('Forcing server shutdown after timeout');
      resolve();
    }, 10000);
  });

  // Close database connection
  closeDatabase();

  server = null;
  app = null;
}

/**
 * Set up graceful shutdown handlers
 */
function setupGracefulShutdown(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'Received shutdown signal');

    try {
      await stopServer();
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions (log but continue)
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    // In production, you might want to exit here
    // For now, log and continue
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

/**
 * Get the Express app instance (for testing)
 */
export function getApp(): Application | null {
  return app;
}
