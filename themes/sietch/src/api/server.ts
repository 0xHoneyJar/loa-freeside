import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { pinoHttp } from 'pino-http';
import helmet from 'helmet';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { IncomingMessage, ServerResponse } from 'http';
import { config, hasLegacyKeys, LEGACY_KEY_SUNSET_DATE } from '../config.js';
import { logger } from '../utils/logger.js';
import { initDatabase, closeDatabase } from '../db/index.js';
import { publicRouter, adminRouter, memberRouter, billingRouter, cryptoBillingRouter, badgeRouter, boostRouter, componentRouter, themeRouter, internalRouter } from './routes.js';
import { telegramRouter } from './telegram.routes.js';
import { adminRouter as billingAdminRouter } from './admin.routes.js';
import { docsRouter } from './docs/swagger.js';
import { createVerifyIntegration } from './routes/verify.integration.js';
import { createAuthRouter, addApiKeyVerifyRoute } from './routes/auth.routes.js';
// Hounfour Integration (cycle-012): S2S loa-finn → arrakis usage report ingestion
import { createInternalAgentRoutes } from './routes/agents.routes.js';
// Sprint 5 (318): Admin Agent Dashboard
import { adminAgentRouter } from './routes/admin-agent.routes.js';
// Sprint 6 (319): Developer API Key Management
import { apiKeysRouter } from './routes/api-keys.routes.js';
// Sprint 6 (319), Task 6.4: Developer Onboarding Flow
import { developerRouter } from './routes/developer.routes.js';
// Sprint 6 (319), Task 6.7: SIWE Auth Flow (EIP-4361)
import { siweRouter, setSiweRedisClient } from './routes/siwe.routes.js';
import cookieParser from 'cookie-parser';
// Sprint 6 (319), Task 6.8: Standalone Chat Page
import { chatPageRouter } from './routes/chat-page.routes.js';
// Sprint 6 (319), Task 6.6: Web Chat Widget + WebSocket
import { createChatWebSocket, drainChatWebSocket } from './websocket/chat-ws.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { S2SJwtValidator } from '@arrakis/adapters/agent/s2s-jwt-validator';
import { UsageReceiver } from '@arrakis/adapters/agent/usage-receiver';
import { createS2SAuthMiddleware } from '@arrakis/adapters/agent/s2s-auth-middleware';
import { buildS2SJwtValidatorConfig, loadAgentGatewayConfig } from '@arrakis/adapters/agent/config';
import { createRequire as createRequireHounfour } from 'module';
const requireHounfour = createRequireHounfour(import.meta.url);
const IoRedis = requireHounfour('ioredis');
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from './middleware.js';
import {
  saveWalletMapping,
  logAuditEvent,
  getEligibilityByAddress,
  // PostgreSQL eligibility queries (Sprint 175)
  setEligibilityPgDb,
  getEligibilityByAddressPg,
  getEligibilityFromSnapshotPg,
  isEligibilityPgDbInitialized,
} from '../db/index.js';
// Sprint 176: User Registry Service
import {
  setUserRegistryDb,
  isUserRegistryServiceInitialized,
  getUserRegistryService,
  IdentityAlreadyExistsError,
  WalletAlreadyLinkedError,
} from '../services/user-registry/index.js';
import { discordService } from '../services/discord.js';
import { onboardingService } from '../services/onboarding.js';
import { profileService } from '../services/profile.js';
import { EmbedBuilder } from 'discord.js';

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
 * Redis client for SIWE nonce store (Sprint 6, Task 6.7)
 */
let siweRedisClient: any | null = null;

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

  // Sprint 6 (319), Task 6.7: Cookie parser for SIWE session tokens
  expressApp.use(cookieParser());

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

  // Component routes (Sprint 5 - WYSIWYG Theme Builder)
  expressApp.use('/api/components', componentRouter);

  // Theme routes (Sprint 1 - WYSIWYG Theme Builder)
  expressApp.use('/api/themes', themeRouter);

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

    // Sprint 175: Initialize PostgreSQL for eligibility queries
    // NOTE: Tables are created in startServer() after createApp() returns
    if (!isEligibilityPgDbInitialized()) {
      setEligibilityPgDb(verifyDb);
      logger.info('PostgreSQL initialized for eligibility queries');
    }

    // Sprint 176: Initialize User Registry Service
    if (!isUserRegistryServiceInitialized()) {
      setUserRegistryDb(verifyDb);
      logger.info('User Registry Service initialized');
    }

    const verifyRouter = createVerifyIntegration({
      db: verifyDb,
      onWalletLinked: async ({ communityId, discordUserId, walletAddress, discordUsername, signature, message }) => {
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

          // Sprint 176: Create/update identity in User Registry
          if (isUserRegistryServiceInitialized()) {
            try {
              const userRegistry = getUserRegistryService();

              // Try to get existing identity
              let identityWithWallets = await userRegistry.getIdentityByDiscordId(discordUserId);

              if (!identityWithWallets) {
                // Create new identity
                identityWithWallets = await userRegistry.createIdentity({
                  discordId: discordUserId,
                  discordUsername: discordUsername || 'unknown',
                  source: 'discord_verification',
                  actorId: discordUserId,
                });
                logger.info(
                  { identityId: identityWithWallets.identity.identityId, discordUserId },
                  'Created new identity in User Registry'
                );
              }

              // Verify wallet for the identity
              await userRegistry.verifyWallet({
                identityId: identityWithWallets.identity.identityId,
                walletAddress,
                signature: signature || 'verification_completed',
                message: message || 'wallet_verification',
                isPrimary: true, // First wallet is always primary
                source: 'discord_verification',
                actorId: discordUserId,
              });
              logger.info(
                { identityId: identityWithWallets.identity.identityId, walletAddress },
                'Wallet verified in User Registry'
              );
            } catch (registryError) {
              if (registryError instanceof IdentityAlreadyExistsError) {
                logger.debug({ discordUserId }, 'Identity already exists in User Registry');
              } else if (registryError instanceof WalletAlreadyLinkedError) {
                logger.warn({ walletAddress, discordUserId }, 'Wallet already linked to another identity');
              } else {
                logger.error(
                  { error: registryError, discordUserId, walletAddress },
                  'Failed to update User Registry'
                );
              }
              // Don't fail the overall verification - registry is supplementary
            }
          }

          // Send Discord DM notification to user with eligibility status
          if (discordService.isConnected()) {
            try {
              const client = discordService.getClient();
              const user = await client.users.fetch(discordUserId);

              if (user) {
                const truncatedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

                // Check eligibility first so we can include it in the DM
                // Sprint 175: Use PostgreSQL for eligibility check (persistent across restarts)
                let eligibility = null;
                let snapshotEligibility = null;
                if (isEligibilityPgDbInitialized()) {
                  // First check top 69 (eligibility_current)
                  eligibility = await getEligibilityByAddressPg(walletAddress.toLowerCase());
                  // If not in top 69, check full snapshot for their rank
                  if (!eligibility) {
                    snapshotEligibility = await getEligibilityFromSnapshotPg(walletAddress.toLowerCase());
                  }
                } else {
                  // Fallback to SQLite (may be empty after restart)
                  eligibility = getEligibilityByAddress(walletAddress.toLowerCase());
                }

                const isEligible = eligibility && eligibility.rank && eligibility.rank <= 69;
                const rank = eligibility?.rank ?? snapshotEligibility?.rank;

                // Build the DM message based on eligibility
                let description = `Your wallet has been successfully linked to your Discord account.\n\n`;
                description += `**Wallet:** \`${truncatedAddress}\`\n\n`;

                if (isEligible && eligibility && eligibility.rank !== undefined) {
                  // User is in top 69 - they're getting onboarding
                  const userRank = eligibility.rank;
                  const tier = userRank <= 7 ? 'Naib' : 'Fedaykin';
                  description += `**BGT Position:** #${userRank} of 69\n`;
                  description += `**Tier:** ${tier}\n\n`;
                  description += `**You're eligible for Sietch!** An onboarding wizard will start shortly to set up your profile (nym, PFP, bio).`;
                } else if (rank) {
                  // User has a rank but isn't in top 69
                  description += `**BGT Position:** #${rank}\n\n`;
                  description += `**Not Yet Eligible**\n`;
                  description += `Sietch membership requires being in the top 69 BGT holders. `;
                  description += `You're currently at position #${rank}.\n\n`;
                  description += `Keep accumulating BGT! When you reach the top 69, you'll automatically receive the onboarding wizard.`;
                } else {
                  // Wallet not found in any eligibility data
                  description += `**BGT Position:** Not ranked\n\n`;
                  description += `**Not Yet Eligible**\n`;
                  description += `Sietch membership requires being in the top 69 BGT holders. `;
                  description += `Your wallet wasn't found in the BGT holder rankings.\n\n`;
                  description += `Start accumulating BGT to become eligible! Rankings update periodically.`;
                }

                description += `\n\nUse \`/verify status\` to check your verification status anytime.`;

                const embed = new EmbedBuilder()
                  .setTitle('✅ Wallet Verified!')
                  .setDescription(description)
                  .setColor(isEligible ? 0x00FF00 : 0xFFA500) // Green if eligible, orange if not
                  .setTimestamp()
                  .setFooter({ text: 'Powered by Arrakis' });

                await user.send({ embeds: [embed] });
                logger.info({ discordUserId, rank, isEligible }, 'Sent verification success DM to user');

                // Trigger onboarding if eligible
                if (isEligible && eligibility && eligibility.rank !== undefined) {
                  const existingProfile = profileService.getProfileByDiscordId(discordUserId);
                  if (!existingProfile) {
                    const onboardTier = eligibility.rank <= 7 ? 'naib' : 'fedaykin';
                    await onboardingService.startOnboarding(user, onboardTier);
                    logger.info(
                      { discordUserId, walletAddress, rank: eligibility.rank, tier: onboardTier },
                      'Triggered onboarding after wallet verification - user is eligible'
                    );
                  } else {
                    logger.debug({ discordUserId }, 'User already has profile, skipping onboarding');
                  }
                } else {
                  logger.info(
                    { discordUserId, walletAddress, rank },
                    'Wallet verified but not in top 69 - onboarding not triggered'
                  );
                }
              }
            } catch (dmError) {
              // User may have DMs disabled or eligibility check failed
              logger.warn(
                { error: dmError, discordUserId },
                'Could not send verification DM or check eligibility (DMs may be disabled)'
              );
            }
          }
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

  // Admin agent dashboard routes (Sprint 5 / 318)
  expressApp.use('/admin/agents', adminAgentRouter);
  logger.info('Admin agent routes mounted at /admin/agents');

  // Developer API key management routes (Sprint 6 / 319)
  expressApp.use('/api/v1/keys', apiKeysRouter);
  logger.info('API key management routes mounted at /api/v1/keys');

  // Developer onboarding routes (Sprint 6 / 319, Task 6.4)
  expressApp.use('/api/v1/developers', developerRouter);
  logger.info('Developer onboarding routes mounted at /api/v1/developers');

  // SIWE auth routes (Sprint 6 / 319, Task 6.7)
  expressApp.use('/api/v1/siwe', siweRouter);
  logger.info('SIWE auth routes mounted at /api/v1/siwe');

  // Standalone chat page (Sprint 6 / 319, Task 6.8)
  expressApp.use('/chat', chatPageRouter);
  logger.info('Standalone chat page mounted at /chat/:tokenId');

  // Developer onboarding page (Sprint 6 / 319, Task 6.4)
  expressApp.get('/developers', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getDeveloperOnboardingPage());
  });

  // Sprint 6 (319), Task 6.6: Web Chat Widget — versioned immutable path (SKP-007)
  const __filename_server = fileURLToPath(import.meta.url);
  const __dirname_server = path.dirname(__filename_server);
  const widgetPath = path.resolve(__dirname_server, '../static/widget.js');

  expressApp.get('/widget/v1/widget.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, immutable, max-age=31536000');
    res.sendFile(widgetPath);
  });

  // Legacy short path redirects to versioned path
  expressApp.get('/widget.js', (_req, res) => {
    res.redirect(301, '/widget/v1/widget.js');
  });

  logger.info('Chat widget served at /widget/v1/widget.js');

  // API Documentation (v5.1 - Sprint 52)
  expressApp.use('/docs', docsRouter);

  // ==========================================================================
  // Authentication Routes (Sprint 9 - CRIT-3 Frontend Auth)
  // ==========================================================================
  const authRouter = createAuthRouter();
  addApiKeyVerifyRoute(authRouter); // Add /api/auth/verify for frontend auth
  expressApp.use('/api/auth', authRouter);
  logger.info('Auth routes mounted at /api/auth');

  // ==========================================================================
  // Internal Routes (Sprint 175 - Trigger.dev -> ECS Communication)
  // ==========================================================================
  // Internal endpoints called by Trigger.dev workers via HTTP.
  // These run on ECS which has VPC access to RDS.
  expressApp.use('/internal', internalRouter);
  logger.info('Internal routes mounted at /internal');

  // ==========================================================================
  // Internal Agent Routes (Hounfour Integration — cycle-012, Sprint 192)
  // ==========================================================================
  // S2S loa-finn → arrakis usage report ingestion.
  // Only mounted when LOA_FINN_BASE_URL is configured (indicates loa-finn integration active).
  // Production should additionally restrict /internal/agent via reverse proxy / NetworkPolicy.
  const loaFinnBaseUrl = process.env.LOA_FINN_BASE_URL;
  if (loaFinnBaseUrl && config.database.url && config.redis.url) {
    try {
      const agentConfig = loadAgentGatewayConfig();
      const s2sValidatorConfig = buildS2SJwtValidatorConfig(agentConfig.s2sValidation);
      const s2sValidator = new S2SJwtValidator(s2sValidatorConfig, logger);

      // Create dedicated Redis connection for usage receiver (ioredis)
      const usageRedis = new IoRedis(config.redis.url, {
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
        connectTimeout: 5_000,
        lazyConnect: true,
      });

      const usageReceiver = new UsageReceiver(
        { s2sValidator, db: drizzle(verifyPostgresClient!), redis: usageRedis, logger },
        agentConfig.usageReceiver,
      );

      const s2sAuth = createS2SAuthMiddleware({ s2sValidator, logger });
      const internalAgentRouter = createInternalAgentRoutes({
        requireS2SAuth: s2sAuth,
        usageReceiver,
      });

      expressApp.use('/internal/agent', internalAgentRouter);
      logger.info('Internal agent routes mounted at /internal/agent');
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize loa-finn integration — internal agent routes disabled');
    }
  } else {
    logger.info('loa-finn integration not configured (LOA_FINN_BASE_URL unset) — internal agent routes disabled');
  }

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

  // Sprint 175: Create eligibility tables if they don't exist
  // This runs on ECS startup which has VPC access to RDS
  // Trigger.dev workers cannot connect to RDS directly due to VPC isolation
  if (verifyPostgresClient) {
    try {
      logger.info('Ensuring eligibility tables exist...');
      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_current (
          address TEXT PRIMARY KEY,
          rank INTEGER NOT NULL,
          bgt_claimed BIGINT NOT NULL,
          bgt_burned BIGINT NOT NULL,
          bgt_held BIGINT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('naib', 'fedaykin', 'none')),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_current_rank ON eligibility_current(rank)`;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_current_role ON eligibility_current(role)`;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_snapshots (
          id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
          data JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_snapshots_created ON eligibility_snapshots(created_at DESC)`;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_admin_overrides (
          id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
          address TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
          reason TEXT NOT NULL,
          created_by TEXT NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE,
          active BOOLEAN DEFAULT TRUE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_overrides_address ON eligibility_admin_overrides(address)`;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_overrides_active ON eligibility_admin_overrides(active, expires_at)`;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_health_status (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          last_success TIMESTAMP WITH TIME ZONE,
          last_failure TIMESTAMP WITH TIME ZONE,
          consecutive_failures INTEGER DEFAULT 0 NOT NULL,
          in_grace_period BOOLEAN DEFAULT FALSE NOT NULL,
          last_synced_block BIGINT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
      `;
      await verifyPostgresClient`
        INSERT INTO eligibility_health_status (id, consecutive_failures, in_grace_period)
        VALUES (1, 0, FALSE)
        ON CONFLICT (id) DO NOTHING
      `;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS wallet_verifications (
          discord_user_id TEXT PRIMARY KEY,
          wallet_address TEXT NOT NULL,
          verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          signature TEXT,
          message TEXT
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_wallet_verifications_address ON wallet_verifications(wallet_address)`;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_claim_events (
          tx_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          block_number BIGINT NOT NULL,
          address TEXT NOT NULL,
          amount BIGINT NOT NULL,
          vault_address TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          PRIMARY KEY (tx_hash, log_index)
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_claim_events_address ON eligibility_claim_events(address)`;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_claim_events_block ON eligibility_claim_events(block_number)`;

      await verifyPostgresClient`
        CREATE TABLE IF NOT EXISTS eligibility_burn_events (
          tx_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          block_number BIGINT NOT NULL,
          from_address TEXT NOT NULL,
          amount BIGINT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
          PRIMARY KEY (tx_hash, log_index)
        )
      `;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_address ON eligibility_burn_events(from_address)`;
      await verifyPostgresClient`CREATE INDEX IF NOT EXISTS idx_eligibility_burn_events_block ON eligibility_burn_events(block_number)`;

      logger.info('Eligibility tables verified/created successfully');
    } catch (tableError) {
      logger.error({ err: tableError }, 'Failed to create eligibility tables');
      // Don't throw - allow server to continue even if tables already exist or creation fails
    }
  }

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

  // ==========================================================================
  // S305-T7: AUTH_BYPASS Code Safeguard
  // ==========================================================================

  const authBypass = process.env.AUTH_BYPASS?.toLowerCase() === 'true';
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  const bypassAllowedEnvs = ['development', 'test'];

  if (authBypass && !bypassAllowedEnvs.includes(nodeEnv || '')) {
    logger.fatal(
      {
        auth_bypass: authBypass,
        node_env: nodeEnv,
        allowed: bypassAllowedEnvs,
      },
      `SECURITY FATAL: AUTH_BYPASS=true is not allowed in ${nodeEnv || 'unspecified'} environment. ` +
        'AUTH_BYPASS is only permitted in development or test environments. Refusing to start.'
    );
    process.exit(1);
  }

  if (authBypass) {
    logger.warn(
      {
        auth_bypass: true,
        node_env: nodeEnv,
      },
      'AUTH_BYPASS enabled — all API requests will bypass authentication. ' +
        'This is only safe in development/test environments.'
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

  // Sprint 6 (319), Task 6.7: Inject Redis client into SIWE nonce store
  if (config.features.redisEnabled && config.redis.url) {
    try {
      siweRedisClient = new IoRedis(config.redis.url, {
        maxRetriesPerRequest: 1,
        commandTimeout: 500,
        connectTimeout: 5_000,
        lazyConnect: true,
      });
      setSiweRedisClient(siweRedisClient);
      logger.info('SIWE Redis client injected for nonce store');
    } catch (err) {
      logger.warn({ err }, 'Failed to create SIWE Redis client — using in-memory nonce fallback');
    }
  }

  // Sprint 6 (319), Task 6.6: Attach WebSocket server for chat widget
  createChatWebSocket(server!);

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

  // Sprint 6 (319), Task 6.6: Drain WebSocket connections gracefully
  await drainChatWebSocket();

  // Sprint 6 (319), Task 6.7: Close SIWE Redis client
  if (siweRedisClient) {
    try {
      await siweRedisClient.quit();
    } catch {
      siweRedisClient.disconnect();
    } finally {
      siweRedisClient = null;
    }
    logger.info('SIWE Redis client closed');
  }

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

// =============================================================================
// Developer Onboarding Page (Sprint 6 / 319, Task 6.4)
// =============================================================================

function getDeveloperOnboardingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Developer Portal — Freeside API</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#e0e0e0;background:#0d1117;padding:2rem}
    .container{max-width:800px;margin:0 auto}
    h1{color:#58a6ff;margin-bottom:.5rem;font-size:2rem}
    h2{color:#79c0ff;margin:2rem 0 .75rem;font-size:1.4rem;border-bottom:1px solid #21262d;padding-bottom:.5rem}
    h3{color:#d2a8ff;margin:1.5rem 0 .5rem;font-size:1.1rem}
    p{margin:.5rem 0;color:#c9d1d9}
    a{color:#58a6ff;text-decoration:none}
    a:hover{text-decoration:underline}
    code{background:#161b22;padding:2px 6px;border-radius:4px;font-size:.9em;color:#f0883e}
    pre{background:#161b22;padding:1rem;border-radius:8px;overflow-x:auto;margin:1rem 0;border:1px solid #21262d}
    pre code{padding:0;background:none;color:#c9d1d9}
    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
    .badge-sandbox{background:#1f6feb33;color:#58a6ff}
    .badge-live{background:#23863533;color:#3fb950}
    table{width:100%;border-collapse:collapse;margin:1rem 0}
    th,td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid #21262d}
    th{color:#8b949e;font-weight:600;font-size:.85rem;text-transform:uppercase}
    .step{counter-increment:steps;padding-left:2.5rem;position:relative;margin:1.5rem 0}
    .step::before{content:counter(steps);position:absolute;left:0;top:0;width:1.8rem;height:1.8rem;background:#1f6feb;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem}
    .steps{counter-reset:steps}
    .note{background:#0d1117;border-left:3px solid #d29922;padding:.75rem 1rem;margin:1rem 0;border-radius:0 4px 4px 0}
    .hero{text-align:center;padding:3rem 0 2rem}
    .hero p{font-size:1.1rem;color:#8b949e}
  </style>
</head>
<body>
<div class="container">

<div class="hero">
  <h1>Freeside Developer API</h1>
  <p>Multi-model AI inference — from sandbox to production in minutes</p>
</div>

<h2>Quick Start</h2>
<div class="steps">

<div class="step">
<h3>Get your sandbox key</h3>
<pre><code>curl -X POST /api/v1/developers/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "My App"}'</code></pre>
<p>Returns your <span class="badge badge-sandbox">sandbox</span> API key (<code>lf_test_...</code>) with free-tier limits.</p>
</div>

<div class="step">
<h3>Make your first inference call</h3>
<pre><code>curl -X POST /api/v1/developers/invoke \\
  -H "Authorization: Bearer lf_test_YOUR_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 256
  }'</code></pre>
</div>

<div class="step">
<h3>Stream responses (SSE)</h3>
<pre><code>curl -X POST /api/v1/developers/stream \\
  -H "Authorization: Bearer lf_test_YOUR_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{"role": "user", "content": "Explain Berachain in one paragraph"}],
    "max_tokens": 512
  }'</code></pre>
</div>

<div class="step">
<h3>Upgrade to production</h3>
<pre><code>curl -X POST /api/v1/developers/upgrade \\
  -H "Authorization: Bearer lf_test_YOUR_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '{"sandboxKeyId": "YOUR_KEY_ID"}'</code></pre>
<p>Returns a <span class="badge badge-live">live</span> key (<code>lf_live_...</code>) with higher limits and more model pools.</p>
</div>

</div>

<h2>API Endpoints</h2>
<table>
  <thead><tr><th>Method</th><th>Endpoint</th><th>Auth</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>POST</code></td><td><code>/api/v1/developers/register</code></td><td>None</td><td>Create sandbox key</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/v1/developers/invoke</code></td><td>Bearer</td><td>Synchronous inference</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/v1/developers/stream</code></td><td>Bearer</td><td>SSE streaming inference</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/v1/developers/models</code></td><td>Bearer</td><td>List available models</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/v1/developers/upgrade</code></td><td>Bearer</td><td>Upgrade to production key</td></tr>
    <tr><td><code>GET</code></td><td><code>/api/v1/keys</code></td><td>Admin</td><td>List your keys</td></tr>
    <tr><td><code>DELETE</code></td><td><code>/api/v1/keys/:id</code></td><td>Admin</td><td>Revoke a key</td></tr>
    <tr><td><code>POST</code></td><td><code>/api/v1/keys/:id/rotate</code></td><td>Admin</td><td>Rotate a key</td></tr>
  </tbody>
</table>

<h2>Rate Limits</h2>
<table>
  <thead><tr><th>Key Type</th><th>RPM</th><th>Tokens/Day</th><th>Pools</th></tr></thead>
  <tbody>
    <tr><td><span class="badge badge-sandbox">sandbox</span></td><td>10</td><td>10,000</td><td>cheap</td></tr>
    <tr><td><span class="badge badge-live">live (free)</span></td><td>60</td><td>100,000</td><td>cheap, fast-code</td></tr>
  </tbody>
</table>
<p>Rate limit headers: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code></p>

<h2>Authentication</h2>
<p>Include your API key in the <code>Authorization</code> header:</p>
<pre><code>Authorization: Bearer lf_test_ABCDEF123456_yourSecretHere</code></pre>
<div class="note">
  <strong>Keep your key secret.</strong> It is shown only once at creation. If compromised, revoke it via <code>DELETE /api/v1/keys/:id</code> and create a new one.
</div>

<h2>Model Pools</h2>
<table>
  <thead><tr><th>Pool</th><th>Description</th><th>Access</th></tr></thead>
  <tbody>
    <tr><td><code>cheap</code></td><td>Cost-optimized models (GPT-4o-mini, Claude Haiku)</td><td>All keys</td></tr>
    <tr><td><code>fast-code</code></td><td>Code-specialized models (GPT-4o, Claude Sonnet)</td><td>Live keys</td></tr>
    <tr><td><code>reasoning</code></td><td>Advanced reasoning models</td><td>Enterprise</td></tr>
    <tr><td><code>architect</code></td><td>Architecture-grade models</td><td>Enterprise</td></tr>
  </tbody>
</table>

<h2>Error Codes</h2>
<table>
  <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td><code>401</code></td><td>Missing or invalid API key</td></tr>
    <tr><td><code>403</code></td><td>Pool not available for your key type</td></tr>
    <tr><td><code>429</code></td><td>Rate limit exceeded (check <code>retryAfter</code>)</td></tr>
    <tr><td><code>503</code></td><td>Inference service unavailable</td></tr>
    <tr><td><code>504</code></td><td>Gateway timeout</td></tr>
  </tbody>
</table>

<p style="margin-top:3rem;color:#484f58;text-align:center;font-size:.85rem">
  Freeside API &mdash; Part of the <a href="https://thehoneyjar.xyz">HoneyJar</a> ecosystem on Berachain
  &bull; <a href="/docs">Full API Docs</a>
</p>

</div>
</body>
</html>`;
}
