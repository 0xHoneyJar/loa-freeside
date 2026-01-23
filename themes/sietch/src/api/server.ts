import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { pinoHttp } from 'pino-http';
import helmet from 'helmet';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { IncomingMessage, ServerResponse } from 'http';
import { config, hasLegacyKeys, LEGACY_KEY_SUNSET_DATE } from '../config.js';
import { logger } from '../utils/logger.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { publicRouter, adminRouter, memberRouter, billingRouter, cryptoBillingRouter, badgeRouter, boostRouter } from './routes.js';
import { telegramRouter } from './telegram.routes.js';
import { adminRouter as billingAdminRouter } from './admin.routes.js';
import { docsRouter } from './docs/swagger.js';
import { createVerifyIntegration } from './routes/verify.integration.js';
import { createAuthRouter, addApiKeyVerifyRoute } from './routes/auth.routes.js';
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from './middleware.js';
import { saveWalletMapping, logAuditEvent } from '../db/index.js';

/**
 * Express application instance
 */
let app: Application | null = null;

/**
 * HTTP server instance
 */
let server: ReturnType<Application['listen']> | null = null;

/**
 * PostgreSQL client for verification routes (Sprint 79)
 */
let verifyPostgresClient: ReturnType<typeof postgres> | null = null;

/**
 * Create and configure the Express application
 */
function createApp(): Application {
  const expressApp = express();

  // Trust proxy for X-Forwarded-For headers (needed for rate limiting behind nginx)
  expressApp.set('trust proxy', 1);

  // Request ID middleware
  expressApp.use(requestIdMiddleware);

  // ==========================================================================
  // Security Headers (Sprint 74 - MED-3)
  // ==========================================================================
  // Helmet provides essential HTTP security headers:
  // - Content-Security-Policy: Prevents XSS by restricting resource loading
  // - X-Frame-Options: Prevents clickjacking
  // - X-Content-Type-Options: Prevents MIME-type sniffing
  // - Strict-Transport-Security (HSTS): Enforces HTTPS
  // - X-XSS-Protection: Legacy XSS filter (modern browsers use CSP)
  // - Referrer-Policy: Controls referrer information
  //
  // @see https://helmetjs.github.io/
  // @security MED-3: Implements missing security headers
  expressApp.use(
    helmet({
      // Content Security Policy - strict by default
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for API docs
          imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.discordapp.net'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"], // Prevents clickjacking
          upgradeInsecureRequests: [], // Upgrade HTTP to HTTPS
        },
      },
      // HSTS - enforce HTTPS for 1 year
      strictTransportSecurity: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      // Prevent clickjacking
      frameguard: { action: 'deny' },
      // Prevent MIME-type sniffing
      noSniff: true,
      // Referrer policy - don't leak referrer to third parties
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Hide X-Powered-By header
      hidePoweredBy: true,
      // XSS filter - legacy but still useful for older browsers
      xssFilter: true,
      // Don't set cross-origin policies that might break CORS
      crossOriginEmbedderPolicy: false, // API needs to be embeddable by clients
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

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

  // ==========================================================================
  // CORS Configuration (Sprint 81 - MED-7)
  // ==========================================================================
  // Configurable CORS via environment variables:
  // - CORS_ALLOWED_ORIGINS: Comma-separated list of allowed origins, or '*' for all
  // - CORS_CREDENTIALS: Enable credentials (cookies, auth headers)
  // - CORS_MAX_AGE: Preflight cache duration in seconds
  //
  // @security MED-7: Explicit CORS configuration instead of hardcoded '*'
  expressApp.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = config.cors.allowedOrigins;

    // Determine if origin is allowed
    let allowOrigin = '*';
    if (allowedOrigins.includes('*')) {
      // Allow all origins (backward compatible, but not recommended for production)
      allowOrigin = '*';
    } else if (origin && allowedOrigins.includes(origin)) {
      // Specific origin is in whitelist
      allowOrigin = origin;
    } else if (origin) {
      // Origin not in whitelist - don't set header (browser will block)
      // But still process the request (for non-CORS clients)
      allowOrigin = '';
    }

    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Request-ID, X-Member-Nym, Authorization');
    res.setHeader('Access-Control-Max-Age', String(config.cors.maxAge));

    // Conditionally enable credentials
    if (config.cors.credentials && allowOrigin !== '*') {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // Raw body parser for billing webhook (must be before JSON parsing)
  // Paddle requires raw body for signature verification
  // We use a custom verify function to attach the raw body to the request
  expressApp.use('/api/billing/webhook', express.raw({
    type: 'application/json',
    verify: (req: any, _res, buf) => {
      // Attach raw body buffer to request for signature verification
      req.rawBody = buf;
    },
  }));

  // Raw body parser for crypto webhook (Sprint 158: NOWPayments Integration)
  // NOWPayments requires raw body for HMAC-SHA512 signature verification
  expressApp.use('/api/crypto/webhook', express.raw({
    type: 'application/json',
    verify: (req: any, _res, buf) => {
      // Attach raw body buffer to request for signature verification
      req.rawBody = buf;
    },
  }));

  // ==========================================================================
  // Input Size Limits (Sprint 10 - HIGH-7 Security Hardening)
  // ==========================================================================
  // Prevents DoS attacks via large payloads.
  // Different limits for different content types:
  // - General JSON: 1MB (default)
  // - Theme data: 500KB (validated separately)
  // - Component props: 100KB (validated separately)
  //
  // @security HIGH-7: Allocation of Resources Without Limits (CWE-770)
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Public routes
  expressApp.use('/', publicRouter);

  // Member API routes (under /api prefix)
  expressApp.use('/api', memberRouter);

  // Billing routes (v4.0 - Sprint 23)
  expressApp.use('/api/billing', billingRouter);

  // Crypto Billing routes (Sprint 158: NOWPayments Integration)
  expressApp.use('/api/crypto', cryptoBillingRouter);

  // Badge routes (v4.0 - Sprint 27)
  expressApp.use('/api/badge', badgeRouter);

  // Boost routes (v4.0 - Sprint 28)
  expressApp.use('/api/boosts', boostRouter);

  // Telegram routes (v4.1 - Sprint 30)
  expressApp.use('/telegram', telegramRouter);

  // ==========================================================================
  // Verification Routes (Sprint 79 - Native Wallet Verification)
  // ==========================================================================
  // Only mount if PostgreSQL is configured (required for RLS)
  if (config.database.url) {
    // Create dedicated PostgreSQL connection for verification
    verifyPostgresClient = postgres(config.database.url, {
      max: 5, // Small pool for verification routes
      idle_timeout: 20,
      connect_timeout: 10,
    });

    const verifyDb = drizzle(verifyPostgresClient);
    const verifyRouter = createVerifyIntegration({
      db: verifyDb,
      onWalletLinked: async ({ communityId, discordUserId, walletAddress }) => {
        // Sprint 79.4: Save wallet mapping to SQLite (legacy) and log audit event
        try {
          saveWalletMapping(discordUserId, walletAddress);
          logAuditEvent('wallet_verification', {
            actorType: 'user',
            actorId: discordUserId,
            action: 'wallet_verification_completed',
            targetType: 'wallet',
            targetId: walletAddress,
            communityId,
            method: 'native_eip191',
          });
          logger.info(
            { communityId, discordUserId, walletAddress },
            'Wallet verified and linked to Discord user'
          );
        } catch (error) {
          logger.error(
            { error, discordUserId, walletAddress },
            'Failed to save wallet mapping after verification'
          );
          // Don't throw - verification is still complete, just logging failed
        }
      },
      onAuditEvent: async (event) => {
        // Log audit events for compliance tracking
        logger.info({ event }, 'Verification audit event');
      },
    });

    expressApp.use('/verify', verifyRouter);
    logger.info('Verification routes mounted at /verify');
  } else {
    logger.warn('Verification routes disabled - DATABASE_URL not configured');
  }

  // Admin routes (under /admin prefix)
  expressApp.use('/admin', adminRouter);

  // Billing admin routes (v4.0 - Sprint 26)
  expressApp.use('/admin', billingAdminRouter);

  // API Documentation (v5.1 - Sprint 52)
  expressApp.use('/docs', docsRouter);

  // ==========================================================================
  // Authentication Routes (Sprint 9 - CRIT-3 Frontend Auth)
  // ==========================================================================
  const authRouter = createAuthRouter();
  addApiKeyVerifyRoute(authRouter); // Add /api/auth/verify for frontend auth
  expressApp.use('/api/auth', authRouter);
  logger.info('Auth routes mounted at /api/auth');

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

  // ==========================================================================
  // Sprint 152: Security startup checks
  // ==========================================================================

  // M-4: Log startup warning for legacy plaintext API keys
  if (hasLegacyKeys()) {
    const legacyKeyCount = config.api.adminApiKeys.legacyKeys.size;
    logger.warn(
      {
        legacyKeyCount,
        sunsetDate: LEGACY_KEY_SUNSET_DATE,
        metric: 'sietch_legacy_api_keys_configured',
      },
      `SECURITY WARNING: ${legacyKeyCount} legacy plaintext API key(s) configured. ` +
        `Migrate to bcrypt-hashed keys before ${LEGACY_KEY_SUNSET_DATE}. ` +
        'Use POST /admin/api-keys/rotate to generate secure bcrypt-hashed keys.'
    );
  }

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

  // Close database connections
  closeDatabase();

  // Close verification PostgreSQL connection (Sprint 79)
  if (verifyPostgresClient) {
    await verifyPostgresClient.end();
    verifyPostgresClient = null;
    logger.info('Verification PostgreSQL connection closed');
  }

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
