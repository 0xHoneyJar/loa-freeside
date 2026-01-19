# Software Design Document: Native Wallet Verification

**Version**: 1.0.0
**Date**: January 14, 2026
**Author**: Architecture Designer Agent
**Status**: Draft
**PRD Reference**: grimoires/loa/prd-wallet-verification.md

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Component Design](#3-component-design)
4. [Database Schema](#4-database-schema)
5. [API Design](#5-api-design)
6. [Discord Integration](#6-discord-integration)
7. [Security Architecture](#7-security-architecture)
8. [Error Handling](#8-error-handling)
9. [Testing Strategy](#9-testing-strategy)
10. [Implementation Plan](#10-implementation-plan)

---

## 1. Overview

### 1.1 Purpose

Add native wallet verification to Arrakis as an alternative to Collab.Land, enabling communities to verify wallet ownership without external dependencies.

### 1.2 Scope

This SDD covers:
- Native EIP-191 signature verification
- Discord `/verify` command
- Verification session management
- Web-based signature flow
- Integration with existing identity service

### 1.3 Design Principles

1. **Leverage existing patterns**: Follow hexagonal architecture established in Arrakis v5
2. **Extend, don't replace**: Build on existing `IdentityService`, don't duplicate
3. **Security-first**: Nonce-based replay protection, rate limiting, audit trail
4. **Multi-tenant aware**: All operations scoped by community

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NATIVE WALLET VERIFICATION ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ENTRY POINTS                                 │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │    │
│  │  │ Discord Bot  │  │ Verify API   │  │ Webhook (Collab.Land path) │ │    │
│  │  │ /verify cmd  │  │ GET/POST     │  │ POST /webhook/collab.land  │ │    │
│  │  └──────────────┘  └──────────────┘  └────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      SERVICE LAYER                                   │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │              WalletVerificationService                        │   │    │
│  │  │  • createSession(discordUserId, guildId)                     │   │    │
│  │  │  • verifySignature(sessionId, signature, address)            │   │    │
│  │  │  • getSession(sessionId)                                     │   │    │
│  │  │  • expireSessions()                                          │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  │                              │                                       │    │
│  │              Uses           ▼           Uses                        │    │
│  │  ┌──────────────────┐  ┌─────────────┐  ┌────────────────────────┐ │    │
│  │  │ IdentityService  │  │ Eligibility │  │ RoleSyncService        │ │    │
│  │  │ (existing)       │  │ Service     │  │ (existing)             │ │    │
│  │  └──────────────────┘  └─────────────┘  └────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    INFRASTRUCTURE LAYER                              │    │
│  │  ┌──────────────────────────────────────────────────────────────┐   │    │
│  │  │              packages/verification/                           │   │    │
│  │  │  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │    │
│  │  │  │ NonceManager   │  │ SignatureVer │  │ SessionStore     │  │   │    │
│  │  │  │ (crypto random)│  │ (viem)       │  │ (PostgreSQL)     │  │   │    │
│  │  │  └────────────────┘  └──────────────┘  └──────────────────┘  │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │    │
│  │  │ PostgreSQL   │  │ Redis         │  │ Audit Log                │ │    │
│  │  │ (sessions)   │  │ (rate limits) │  │ (events)                 │ │    │
│  │  └──────────────┘  └───────────────┘  └──────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Integration with Existing Architecture

The wallet verification module integrates with existing Arrakis components:

| Existing Component | Integration Point |
|--------------------|-------------------|
| `IdentityService` | Call `linkWalletToDiscord()` after verification |
| `eligibility.ts` | Call to check wallet eligibility |
| `role-sync.ts` | Trigger role assignment after successful verification |
| `AuditLogPersistence` | Log verification events |
| `DrizzleStorageAdapter` | Store verification sessions |

### 2.3 Verification Method Selection

Communities configure their preferred verification method in settings:

```typescript
interface CommunitySettings {
  // ... existing fields
  verificationMethod: 'collabland' | 'native' | 'both';
  nativeVerification?: {
    enabled: boolean;
    customMessage?: string;  // Optional custom signing message
    sessionTtlMinutes?: number;  // Default: 15
  };
}
```

---

## 3. Component Design

### 3.1 Package Structure

```
themes/sietch/src/packages/verification/
├── index.ts                    # Public exports
├── types.ts                    # Type definitions
├── NonceManager.ts             # Cryptographic nonce generation
├── SignatureVerifier.ts        # EIP-191 signature verification
├── SessionManager.ts           # Verification session CRUD
├── MessageBuilder.ts           # Signing message construction
└── VerificationService.ts      # Orchestration service
```

### 3.2 NonceManager

**Purpose**: Generate cryptographically secure, single-use nonces

```typescript
// packages/verification/NonceManager.ts

import { randomUUID } from 'crypto';

export interface Nonce {
  value: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

export class NonceManager {
  private readonly ttlMs: number;

  constructor(ttlMinutes: number = 15) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /**
   * Generate a new cryptographically random nonce
   */
  generate(): Nonce {
    const now = new Date();
    return {
      value: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      used: false,
    };
  }

  /**
   * Check if nonce is valid (not expired, not used)
   */
  isValid(nonce: Nonce): boolean {
    return !nonce.used && new Date() < nonce.expiresAt;
  }
}
```

### 3.3 SignatureVerifier

**Purpose**: Verify EIP-191 personal_sign signatures using viem

```typescript
// packages/verification/SignatureVerifier.ts

import { verifyMessage, type Hex, type Address } from 'viem';

export interface VerificationResult {
  valid: boolean;
  recoveredAddress?: Address;
  error?: string;
}

export class SignatureVerifier {
  /**
   * Verify an EIP-191 signature and recover the signer address
   */
  async verify(
    message: string,
    signature: Hex,
    expectedAddress: Address
  ): Promise<VerificationResult> {
    try {
      // viem's verifyMessage returns boolean - we need recoverMessageAddress
      const { recoverMessageAddress } = await import('viem');

      const recoveredAddress = await recoverMessageAddress({
        message,
        signature,
      });

      const valid = recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();

      return {
        valid,
        recoveredAddress: valid ? recoveredAddress : undefined,
        error: valid ? undefined : 'Signature does not match expected address',
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }
}
```

### 3.4 MessageBuilder

**Purpose**: Construct standardized signing messages

```typescript
// packages/verification/MessageBuilder.ts

export interface MessageParams {
  communityName: string;
  walletAddress: string;
  discordUsername: string;
  nonce: string;
  timestamp: Date;
}

export class MessageBuilder {
  /**
   * Build a human-readable signing message following EIP-191
   */
  build(params: MessageParams): string {
    return `Verify your wallet for ${params.communityName}

Wallet: ${params.walletAddress}
Discord: ${params.discordUsername}
Nonce: ${params.nonce}
Timestamp: ${params.timestamp.toISOString()}

Sign this message to prove ownership. This signature does NOT authorize any transactions.`;
  }

  /**
   * Build message with custom community template
   */
  buildCustom(template: string, params: MessageParams): string {
    return template
      .replace('{community_name}', params.communityName)
      .replace('{wallet_address}', params.walletAddress)
      .replace('{discord_username}', params.discordUsername)
      .replace('{nonce}', params.nonce)
      .replace('{timestamp}', params.timestamp.toISOString());
  }
}
```

### 3.5 SessionManager

**Purpose**: CRUD operations for verification sessions

```typescript
// packages/verification/SessionManager.ts

import type { IStorageProvider } from '../core/ports/IStorageProvider.js';

export interface VerificationSession {
  id: string;
  communityId: string;
  discordUserId: string;
  discordGuildId: string;
  discordUsername: string;
  nonce: string;
  walletAddress?: string;  // Set after signature submission
  status: 'pending' | 'completed' | 'expired' | 'failed';
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  attempts: number;
  ipAddress?: string;
  userAgent?: string;
}

export class SessionManager {
  constructor(
    private readonly storage: IStorageProvider,
    private readonly maxAttempts: number = 3
  ) {}

  async create(params: {
    communityId: string;
    discordUserId: string;
    discordGuildId: string;
    discordUsername: string;
    nonce: string;
    expiresAt: Date;
  }): Promise<VerificationSession> {
    // Implementation: INSERT into wallet_verification_sessions
  }

  async getById(id: string): Promise<VerificationSession | null> {
    // Implementation: SELECT with community_id scope
  }

  async getByNonce(nonce: string): Promise<VerificationSession | null> {
    // Implementation: SELECT by nonce
  }

  async getPendingForUser(discordUserId: string): Promise<VerificationSession | null> {
    // Implementation: Get active pending session for user
  }

  async markCompleted(id: string, walletAddress: string): Promise<void> {
    // Implementation: UPDATE status = 'completed'
  }

  async incrementAttempts(id: string): Promise<number> {
    // Implementation: UPDATE attempts = attempts + 1
  }

  async markFailed(id: string, reason: string): Promise<void> {
    // Implementation: UPDATE status = 'failed'
  }

  async expireOldSessions(): Promise<number> {
    // Implementation: UPDATE WHERE expiresAt < NOW() AND status = 'pending'
  }
}
```

### 3.6 WalletVerificationService

**Purpose**: Orchestrate the complete verification flow

```typescript
// packages/verification/VerificationService.ts

import { NonceManager } from './NonceManager.js';
import { SignatureVerifier } from './SignatureVerifier.js';
import { MessageBuilder } from './MessageBuilder.js';
import { SessionManager, type VerificationSession } from './SessionManager.js';
import { identityService } from '../../services/IdentityService.js';
import { checkEligibility } from '../../services/eligibility.js';
import { auditLog } from '../security/AuditLogPersistence.js';
import type { Hex, Address } from 'viem';

export interface CreateSessionResult {
  session: VerificationSession;
  verifyUrl: string;
}

export interface VerifyResult {
  success: boolean;
  walletAddress?: string;
  eligible?: boolean;
  role?: string;
  error?: string;
}

export class WalletVerificationService {
  private readonly nonceManager: NonceManager;
  private readonly signatureVerifier: SignatureVerifier;
  private readonly messageBuilder: MessageBuilder;
  private readonly sessionManager: SessionManager;
  private readonly baseUrl: string;

  constructor(
    sessionManager: SessionManager,
    baseUrl: string,
    sessionTtlMinutes: number = 15
  ) {
    this.nonceManager = new NonceManager(sessionTtlMinutes);
    this.signatureVerifier = new SignatureVerifier();
    this.messageBuilder = new MessageBuilder();
    this.sessionManager = sessionManager;
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new verification session for a Discord user
   */
  async createSession(params: {
    communityId: string;
    communityName: string;
    discordUserId: string;
    discordGuildId: string;
    discordUsername: string;
  }): Promise<CreateSessionResult> {
    // Check for existing pending session
    const existing = await this.sessionManager.getPendingForUser(params.discordUserId);
    if (existing) {
      // Return existing session URL
      return {
        session: existing,
        verifyUrl: `${this.baseUrl}/verify/${existing.id}`,
      };
    }

    // Generate nonce
    const nonce = this.nonceManager.generate();

    // Create session
    const session = await this.sessionManager.create({
      communityId: params.communityId,
      discordUserId: params.discordUserId,
      discordGuildId: params.discordGuildId,
      discordUsername: params.discordUsername,
      nonce: nonce.value,
      expiresAt: nonce.expiresAt,
    });

    // Audit log
    await auditLog.log({
      event: 'wallet_verification_session_created',
      communityId: params.communityId,
      userId: params.discordUserId,
      sessionId: session.id,
    });

    return {
      session,
      verifyUrl: `${this.baseUrl}/verify/${session.id}`,
    };
  }

  /**
   * Verify a signature and link wallet
   */
  async verifySignature(params: {
    sessionId: string;
    signature: Hex;
    walletAddress: Address;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<VerifyResult> {
    // Get session
    const session = await this.sessionManager.getById(params.sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Check session status
    if (session.status !== 'pending') {
      return { success: false, error: `Session already ${session.status}` };
    }

    // Check expiry
    if (new Date() > session.expiresAt) {
      await this.sessionManager.markFailed(session.id, 'Session expired');
      return { success: false, error: 'Session expired' };
    }

    // Check attempts
    const attempts = await this.sessionManager.incrementAttempts(session.id);
    if (attempts > 3) {
      await this.sessionManager.markFailed(session.id, 'Too many attempts');
      return { success: false, error: 'Too many verification attempts' };
    }

    // Build expected message
    const message = this.messageBuilder.build({
      communityName: 'Community', // TODO: Get from community settings
      walletAddress: params.walletAddress,
      discordUsername: session.discordUsername,
      nonce: session.nonce,
      timestamp: session.createdAt,
    });

    // Verify signature
    const verification = await this.signatureVerifier.verify(
      message,
      params.signature,
      params.walletAddress
    );

    if (!verification.valid) {
      await auditLog.log({
        event: 'wallet_verification_failed',
        sessionId: session.id,
        reason: verification.error,
      });
      return { success: false, error: verification.error };
    }

    // Check eligibility
    const eligibility = await checkEligibility(params.walletAddress);

    // Link wallet to Discord account via IdentityService
    await identityService.linkWalletToDiscord(
      params.walletAddress,
      session.discordUserId,
      session.discordGuildId
    );

    // Mark session complete
    await this.sessionManager.markCompleted(session.id, params.walletAddress);

    // Audit log
    await auditLog.log({
      event: 'wallet_verification_completed',
      sessionId: session.id,
      walletAddress: params.walletAddress,
      eligible: eligibility.eligible,
      role: eligibility.role,
    });

    return {
      success: true,
      walletAddress: params.walletAddress,
      eligible: eligibility.eligible,
      role: eligibility.role,
    };
  }

  /**
   * Get session for verification page
   */
  async getSession(sessionId: string): Promise<VerificationSession | null> {
    return this.sessionManager.getById(sessionId);
  }

  /**
   * Clean up expired sessions (called by cron job)
   */
  async cleanupExpiredSessions(): Promise<number> {
    return this.sessionManager.expireOldSessions();
  }
}
```

---

## 4. Database Schema

### 4.1 New Table: wallet_verification_sessions

```sql
-- Migration: 018_wallet_verification_sessions.sql

CREATE TABLE wallet_verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  discord_guild_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  nonce TEXT UNIQUE NOT NULL,
  wallet_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  error_message TEXT
);

-- Indexes
CREATE INDEX idx_wallet_verification_community ON wallet_verification_sessions(community_id);
CREATE INDEX idx_wallet_verification_discord_user ON wallet_verification_sessions(discord_user_id);
CREATE INDEX idx_wallet_verification_status ON wallet_verification_sessions(status);
CREATE INDEX idx_wallet_verification_expires ON wallet_verification_sessions(expires_at) WHERE status = 'pending';

-- RLS Policy (tenant isolation)
ALTER TABLE wallet_verification_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON wallet_verification_sessions
  FOR ALL
  USING (community_id = current_setting('app.current_tenant')::UUID);

-- Cleanup function for expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_verification_sessions()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE wallet_verification_sessions
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;
```

### 4.2 Drizzle Schema Addition

```typescript
// Add to packages/adapters/storage/schema.ts

export const walletVerificationSessions = pgTable(
  'wallet_verification_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    discordGuildId: text('discord_guild_id').notNull(),
    discordUsername: text('discord_username').notNull(),
    nonce: text('nonce').unique().notNull(),
    walletAddress: text('wallet_address'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    errorMessage: text('error_message'),
  },
  (table) => ({
    communityIdx: index('idx_wallet_verification_community').on(table.communityId),
    discordUserIdx: index('idx_wallet_verification_discord_user').on(table.discordUserId),
    statusIdx: index('idx_wallet_verification_status').on(table.status),
  })
);

// Type exports
export type WalletVerificationSession = typeof walletVerificationSessions.$inferSelect;
export type NewWalletVerificationSession = typeof walletVerificationSessions.$inferInsert;
```

---

## 5. API Design

### 5.1 Verification API Routes

```typescript
// api/routes/verify.routes.ts

import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';

const verifyRouter = Router();

// Rate limiting
const verifyPageLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 30,              // 30 requests per minute per IP
  message: 'Too many verification page requests',
});

const signatureLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 10,                    // 10 signature submissions per hour per IP
  message: 'Too many verification attempts',
});

// Schemas
const verifySignatureSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/**
 * GET /verify/:sessionId
 * Serve verification page or return session data (based on Accept header)
 */
verifyRouter.get('/:sessionId', verifyPageLimiter, async (req, res) => {
  const { sessionId } = req.params;

  const session = await verificationService.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status !== 'pending') {
    return res.status(400).json({ error: `Session already ${session.status}` });
  }

  if (new Date() > session.expiresAt) {
    return res.status(400).json({ error: 'Session expired' });
  }

  // If JSON requested, return session data
  if (req.accepts('json')) {
    return res.json({
      sessionId: session.id,
      communityName: 'Community', // TODO: Get from community
      discordUsername: session.discordUsername,
      nonce: session.nonce,
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  // Otherwise serve HTML page
  return res.sendFile('verify.html', { root: 'static' });
});

/**
 * POST /verify/:sessionId
 * Submit signature for verification
 */
verifyRouter.post('/:sessionId', signatureLimiter, async (req, res) => {
  const { sessionId } = req.params;

  const parseResult = verifySignatureSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid request', details: parseResult.error });
  }

  const { signature, walletAddress } = parseResult.data;

  const result = await verificationService.verifySignature({
    sessionId,
    signature: signature as `0x${string}`,
    walletAddress: walletAddress as `0x${string}`,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    success: true,
    walletAddress: result.walletAddress,
    eligible: result.eligible,
    role: result.role,
  });
});

/**
 * GET /verify/:sessionId/status
 * Check verification status (for polling)
 */
verifyRouter.get('/:sessionId/status', verifyPageLimiter, async (req, res) => {
  const { sessionId } = req.params;

  const session = await verificationService.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  return res.json({
    status: session.status,
    walletAddress: session.walletAddress,
    completedAt: session.completedAt?.toISOString(),
  });
});

export { verifyRouter };
```

### 5.2 API Endpoints Summary

| Method | Path | Description | Rate Limit |
|--------|------|-------------|------------|
| GET | `/verify/{sessionId}` | Get session info / serve page | 30/min/IP |
| POST | `/verify/{sessionId}` | Submit signature | 10/hour/IP |
| GET | `/verify/{sessionId}/status` | Poll verification status | 30/min/IP |

---

## 6. Discord Integration

### 6.1 /verify Command

```typescript
// discord/commands/verify.ts

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { verificationService } from '../../packages/verification/index.js';
import { getCommunityByGuild } from '../../services/community.js';

export const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your wallet to access gated channels')
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('Verification action')
      .addChoices(
        { name: 'Start verification', value: 'start' },
        { name: 'Check status', value: 'status' },
        { name: 'Reset (link different wallet)', value: 'reset' }
      )
  )
  .toJSON();

export async function handleVerifyCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const action = interaction.options.getString('action') || 'start';

  // Get community
  const community = await getCommunityByGuild(interaction.guildId!);
  if (!community) {
    await interaction.reply({
      content: 'This server is not configured for wallet verification.',
      ephemeral: true,
    });
    return;
  }

  // Check if native verification is enabled
  if (community.settings?.verificationMethod === 'collabland') {
    await interaction.reply({
      content: 'This server uses Collab.Land for verification. Please use the #verify channel.',
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'start':
      await handleStartVerification(interaction, community);
      break;
    case 'status':
      await handleStatusCheck(interaction, community);
      break;
    case 'reset':
      await handleReset(interaction, community);
      break;
  }
}

async function handleStartVerification(
  interaction: ChatInputCommandInteraction,
  community: Community
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await verificationService.createSession({
      communityId: community.id,
      communityName: community.name,
      discordUserId: interaction.user.id,
      discordGuildId: interaction.guildId!,
      discordUsername: interaction.user.username,
    });

    const embed = new EmbedBuilder()
      .setTitle('🔐 Wallet Verification')
      .setDescription(`Click the button below to verify your wallet ownership.\n\nThis link expires in **15 minutes**.`)
      .setColor(0x7C3AED)
      .addFields(
        { name: 'Important', value: 'This will **NOT** request any transactions. You will only sign a message to prove ownership.' }
      )
      .setFooter({ text: `Session ID: ${result.session.id}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Verify Wallet')
        .setStyle(ButtonStyle.Link)
        .setURL(result.verifyUrl)
        .setEmoji('🔗')
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Also send DM for convenience
    try {
      await interaction.user.send({
        embeds: [embed],
        components: [row],
      });
    } catch {
      // User may have DMs disabled - that's okay
    }
  } catch (error) {
    await interaction.editReply({
      content: `Failed to create verification session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStatusCheck(
  interaction: ChatInputCommandInteraction,
  community: Community
): Promise<void> {
  // Check if user has verified wallet
  const profile = await storage.getProfileByDiscordId(interaction.user.id);

  if (!profile?.walletAddress) {
    await interaction.reply({
      content: 'You have not verified a wallet yet. Use `/verify` to get started.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Wallet Verified')
    .setDescription(`Your Discord account is linked to:`)
    .addFields(
      { name: 'Wallet', value: `\`${profile.walletAddress}\``, inline: false },
      { name: 'Tier', value: profile.tier || 'None', inline: true },
      { name: 'Linked', value: profile.createdAt?.toLocaleDateString() || 'Unknown', inline: true }
    )
    .setColor(0x10B981);

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function handleReset(
  interaction: ChatInputCommandInteraction,
  community: Community
): Promise<void> {
  // TODO: Implement reset flow
  await interaction.reply({
    content: 'Reset functionality coming soon. Contact an admin if you need to change your linked wallet.',
    ephemeral: true,
  });
}
```

### 6.2 Post-Verification Role Assignment

After successful verification, trigger role sync:

```typescript
// In WalletVerificationService.verifySignature()

// After marking session complete...

// Trigger role sync via BullMQ
await roleSyncQueue.add('sync-user-roles', {
  communityId: session.communityId,
  discordUserId: session.discordUserId,
  discordGuildId: session.discordGuildId,
  walletAddress: params.walletAddress,
  eligibility,
});

// Notify user via Discord DM
const discordClient = getDiscordClient();
try {
  const user = await discordClient.users.fetch(session.discordUserId);
  const embed = new EmbedBuilder()
    .setTitle('✅ Wallet Verified!')
    .setDescription(`Your wallet has been verified and linked to your Discord account.`)
    .addFields(
      { name: 'Wallet', value: `\`${params.walletAddress}\``, inline: false },
      { name: 'Eligible', value: eligibility.eligible ? 'Yes' : 'No', inline: true },
      { name: 'Role', value: eligibility.role || 'None', inline: true }
    )
    .setColor(eligibility.eligible ? 0x10B981 : 0xF59E0B);

  await user.send({ embeds: [embed] });
} catch {
  // User may have DMs disabled
}
```

---

## 7. Security Architecture

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| **Replay attacks** | Single-use nonces, guild-scoped, time-limited |
| **Session hijacking** | UUIDv4 session IDs, HTTPS only |
| **Brute force** | 3 attempts per session, rate limiting |
| **Wallet spoofing** | EIP-191 signature verification |
| **Cross-tenant access** | PostgreSQL RLS on sessions table |
| **CSRF** | SameSite cookies, CORS restrictions |

### 7.2 Nonce Security

```typescript
// Nonce requirements
const nonceSpec = {
  format: 'UUIDv4',                    // Cryptographically random
  uniqueness: 'Globally unique',        // Stored in DB with UNIQUE constraint
  lifetime: '15 minutes',               // Auto-expire
  usage: 'Single-use',                  // Deleted after verification
  scope: 'Guild + User',                // One active session per user per guild
};
```

### 7.3 Rate Limiting Configuration

```typescript
// Rate limits
const rateLimits = {
  verifyPageRequests: {
    windowMs: 60 * 1000,    // 1 minute
    max: 30,                // per IP
  },
  signatureSubmissions: {
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 10,                    // per IP
  },
  sessionCreations: {
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 5,                     // per user
  },
};
```

### 7.4 Audit Events

```typescript
// Audit log events for wallet verification
type VerificationAuditEvent =
  | 'wallet_verification_session_created'
  | 'wallet_verification_signature_submitted'
  | 'wallet_verification_completed'
  | 'wallet_verification_failed'
  | 'wallet_verification_expired'
  | 'wallet_verification_reset';
```

---

## 8. Error Handling

### 8.1 Error Types

```typescript
// packages/verification/errors.ts

export class VerificationError extends Error {
  constructor(
    message: string,
    public readonly code: VerificationErrorCode,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}

export enum VerificationErrorCode {
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_ALREADY_COMPLETED = 'SESSION_ALREADY_COMPLETED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  ADDRESS_MISMATCH = 'ADDRESS_MISMATCH',
  TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS',
  RATE_LIMITED = 'RATE_LIMITED',
  COMMUNITY_NOT_CONFIGURED = 'COMMUNITY_NOT_CONFIGURED',
}
```

### 8.2 User-Facing Error Messages

| Error Code | User Message |
|------------|--------------|
| SESSION_NOT_FOUND | "This verification link is invalid. Please run `/verify` again." |
| SESSION_EXPIRED | "This verification link has expired. Please run `/verify` to get a new link." |
| SESSION_ALREADY_COMPLETED | "This wallet has already been verified." |
| SIGNATURE_INVALID | "Signature verification failed. Please try again." |
| ADDRESS_MISMATCH | "The signature doesn't match the wallet address. Please ensure you're signing with the correct wallet." |
| TOO_MANY_ATTEMPTS | "Too many verification attempts. Please run `/verify` to get a new link." |
| RATE_LIMITED | "Too many requests. Please wait a few minutes and try again." |

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// tests/unit/packages/verification/SignatureVerifier.test.ts

describe('SignatureVerifier', () => {
  it('should verify valid EIP-191 signature', async () => {
    const verifier = new SignatureVerifier();
    const message = 'Test message';
    const { signature, address } = await signMessage(message);

    const result = await verifier.verify(message, signature, address);

    expect(result.valid).toBe(true);
    expect(result.recoveredAddress?.toLowerCase()).toBe(address.toLowerCase());
  });

  it('should reject signature from different address', async () => {
    const verifier = new SignatureVerifier();
    const message = 'Test message';
    const { signature } = await signMessage(message);
    const differentAddress = '0x1234...';

    const result = await verifier.verify(message, signature, differentAddress);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match');
  });

  it('should reject malformed signature', async () => {
    const verifier = new SignatureVerifier();

    const result = await verifier.verify('message', '0xinvalid', '0x1234...');

    expect(result.valid).toBe(false);
  });
});
```

### 9.2 Integration Tests

```typescript
// tests/integration/verification-flow.test.ts

describe('Wallet Verification Flow', () => {
  it('should complete full verification flow', async () => {
    // 1. Create session
    const session = await verificationService.createSession({
      communityId: testCommunity.id,
      communityName: 'Test Community',
      discordUserId: '123456789',
      discordGuildId: '987654321',
      discordUsername: 'testuser',
    });

    expect(session.session.status).toBe('pending');

    // 2. Sign message
    const message = messageBuilder.build({
      communityName: 'Test Community',
      walletAddress: testWallet.address,
      discordUsername: 'testuser',
      nonce: session.session.nonce,
      timestamp: session.session.createdAt,
    });
    const signature = await testWallet.signMessage(message);

    // 3. Submit signature
    const result = await verificationService.verifySignature({
      sessionId: session.session.id,
      signature,
      walletAddress: testWallet.address,
    });

    expect(result.success).toBe(true);
    expect(result.walletAddress).toBe(testWallet.address);

    // 4. Verify session is completed
    const updatedSession = await verificationService.getSession(session.session.id);
    expect(updatedSession?.status).toBe('completed');
  });
});
```

### 9.3 Security Tests

```typescript
// tests/unit/packages/verification/security.test.ts

describe('Verification Security', () => {
  it('should reject expired session', async () => {
    const session = await createExpiredSession();

    const result = await verificationService.verifySignature({
      sessionId: session.id,
      signature: validSignature,
      walletAddress: testWallet.address,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should reject reused nonce', async () => {
    // Complete first verification
    await completeVerification(session1);

    // Try to reuse same nonce
    const result = await verificationService.verifySignature({
      sessionId: session1.id,
      signature: newSignature,
      walletAddress: differentWallet.address,
    });

    expect(result.success).toBe(false);
  });

  it('should enforce max attempts per session', async () => {
    const session = await createSession();

    // Make 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await verificationService.verifySignature({
        sessionId: session.id,
        signature: invalidSignature,
        walletAddress: testWallet.address,
      });
    }

    // 4th attempt should fail with rate limit
    const result = await verificationService.verifySignature({
      sessionId: session.id,
      signature: validSignature,
      walletAddress: testWallet.address,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many');
  });
});
```

---

## 10. Implementation Plan

### 10.1 Sprint Breakdown

| Sprint | Focus | Deliverables |
|--------|-------|--------------|
| **Sprint 77** | Core verification package | `NonceManager`, `SignatureVerifier`, `MessageBuilder` |
| **Sprint 78** | Database & sessions | Migration, `SessionManager`, `WalletVerificationService` |
| **Sprint 79** | API & Discord | `verify.routes.ts`, `/verify` command, integration |
| **Sprint 80** | Security & polish | Rate limiting, audit trail, error handling, tests |

### 10.2 Dependencies

```
Sprint 77: Core Package
  └── Sprint 78: Database & Sessions
       └── Sprint 79: API & Discord
            └── Sprint 80: Security & Polish
```

### 10.3 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Mobile wallet compatibility | Test with MetaMask, WalletConnect, Coinbase early |
| Signature format variations | Use viem's built-in handling, add format detection |
| Rate limit tuning | Start conservative, monitor, adjust based on usage |
| Session cleanup | Cron job + database function for redundancy |

---

## Appendix A: Verification Page UI

```html
<!-- static/verify.html (simplified) -->
<!DOCTYPE html>
<html>
<head>
  <title>Verify Wallet - Arrakis</title>
  <script src="https://unpkg.com/viem@latest/dist/umd/index.js"></script>
</head>
<body>
  <div id="app">
    <h1>Verify Your Wallet</h1>
    <p>Sign a message to prove ownership</p>

    <button id="connect">Connect Wallet</button>
    <button id="sign" disabled>Sign Message</button>

    <div id="status"></div>
  </div>

  <script>
    // Implementation: Connect wallet, sign message, POST to API
  </script>
</body>
</html>
```

---

## Appendix B: Open Questions Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| WalletConnect vs custom page | Start with simple page, add WalletConnect later | Simpler to implement, test, and debug |
| Multi-wallet support | No, single wallet per Discord account | Reduces complexity, matches existing model |
| Verification refresh | Never auto-refresh, user-initiated reset only | Wallet ownership doesn't change |
| Mobile support | Basic support, deep links in Phase 2 | Desktop-first, mobile can use browser |

---

*Document generated by Architecture Designer Agent*
*Version 1.0.0 - January 14, 2026*
