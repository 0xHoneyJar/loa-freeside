# Product Requirements Document: Wallet Verification Options

**Version**: 1.0.0
**Date**: January 14, 2026
**Status**: Draft

---

## 1. Problem Statement

### The Challenge

Token-gated Discord communities currently face a verification dilemma:

1. **Collab.Land dependency**: The industry standard costs $99/month and creates vendor lock-in
2. **No alternatives**: Communities must either pay Collab.Land or build custom solutions from scratch
3. **Friction for operators**: Communities want options based on budget, security posture, and control preferences

### Current State

Arrakis has a complete eligibility API (`/eligibility/{wallet}`) but no way for users to verify wallet ownership. The system is designed to integrate with Collab.Land, but Collab.Land Premium subscription ($99/mo) is required for Custom API Token Gates.

### User Pain Points

| User Type | Pain Point |
|-----------|------------|
| **Small Communities** | $99/mo is prohibitive for communities under 500 members |
| **Enterprise Communities** | Want self-hosted solutions for security/compliance |
| **Cost-Conscious Operators** | Looking for cheaper alternatives to Collab.Land |
| **Control-Focused Operators** | Want full control over verification flow |

---

## 2. Proposed Solution

Offer **two verification methods** as a competitive advantage:

### Option A: Collab.Land Integration (Primary)
- Industry standard, battle-tested
- Users familiar with the flow
- Requires $99/mo Collab.Land Premium
- Zero development effort for community operators

### Option B: Native Arrakis Verification (Plugin)
- Self-hosted wallet signature verification
- No external dependencies
- Lower cost than Collab.Land
- Full control over verification UX

### Business Model

| Tier | Collab.Land | Native Verification |
|------|-------------|---------------------|
| **Basic** (Free) | ❌ Not available | ❌ Not available |
| **Pro** ($49/mo) | ✅ Bring your own subscription | ✅ Included |
| **Enterprise** (Custom) | ✅ Included setup assistance | ✅ Included + custom branding |

**Key Insight**: Communities pay $99/mo for Collab.Land OR $49/mo for Arrakis Pro with native verification. We're $50/mo cheaper while offering conviction scoring, tiered progression, and cross-platform identity that Collab.Land doesn't provide.

---

## 3. Functional Requirements

### 3.1 Collab.Land Integration Path

**Status**: Documentation exists, configuration required

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Document Collab.Land Premium setup | P1 | `collabland-setup.md` exists |
| Support Custom API Token Gates | P1 | `/eligibility/{wallet}` ready |
| Webhook for verification events | P2 | Trigger onboarding after verification |
| Role mapping configuration | P1 | Naib/Fedaykin based on response.role |

### 3.2 Native Verification Path

**Status**: Not implemented

| Requirement | Priority | Description |
|-------------|----------|-------------|
| `/verify` Discord command | P1 | Starts verification flow |
| Nonce generation & storage | P1 | Unique per-session, time-limited |
| Signature verification | P1 | ECDSA signature recovery using viem |
| Wallet-to-Discord linking | P1 | Store in `member_profiles.wallet_address` |
| Role assignment | P1 | Assign Naib/Fedaykin based on eligibility |
| Verification web page | P2 | Hosted page for wallet signature (or use WalletConnect) |
| Mobile wallet support | P2 | Deep links for mobile wallets |
| Re-verification flow | P3 | Allow users to change linked wallet |

### 3.3 Shared Requirements

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Eligibility API | P1 | ✅ Already implemented |
| Role sync service | P1 | ✅ Already implemented |
| Cross-platform identity | P1 | ✅ Already implemented |
| Audit trail | P2 | Log verification events |

---

## 4. Technical Architecture

### 4.1 Native Verification Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NATIVE WALLET VERIFICATION FLOW                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐       │
│  │  Discord │     │  Arrakis │     │   User   │     │  Wallet  │       │
│  │   User   │     │   Bot    │     │  Browser │     │   App    │       │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘       │
│       │                │                │                │              │
│       │  /verify       │                │                │              │
│       │───────────────>│                │                │              │
│       │                │                │                │              │
│       │  DM with link  │                │                │              │
│       │<───────────────│                │                │              │
│       │                │                │                │              │
│       │           Click link            │                │              │
│       │────────────────────────────────>│                │              │
│       │                │                │                │              │
│       │                │   Load verify  │                │              │
│       │                │      page      │                │              │
│       │                │<───────────────│                │              │
│       │                │                │                │              │
│       │                │                │  Connect       │              │
│       │                │                │  Wallet        │              │
│       │                │                │───────────────>│              │
│       │                │                │                │              │
│       │                │                │  Sign message  │              │
│       │                │                │<───────────────│              │
│       │                │                │                │              │
│       │                │   POST /verify │                │              │
│       │                │   (signature)  │                │              │
│       │                │<───────────────│                │              │
│       │                │                │                │              │
│       │                │  Recover addr  │                │              │
│       │                │  Check elig.   │                │              │
│       │                │  Assign role   │                │              │
│       │                │                │                │              │
│       │  Role assigned │                │                │              │
│       │  + DM confirm  │                │                │              │
│       │<───────────────│                │                │              │
│       │                │                │                │              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Signature Message Format

```
Verify your wallet for {community_name}

Wallet: {wallet_address}
Discord: {discord_username}#{discriminator}
Nonce: {uuid}
Timestamp: {iso_timestamp}

Sign this message to prove ownership. This signature does NOT authorize any transactions.
```

### 4.3 Database Schema Changes

```sql
-- Add to member_profiles (already exists: wallet_address, discord_user_id)
-- No schema changes needed for basic flow

-- New table for verification sessions
CREATE TABLE wallet_verification_sessions (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_guild_id TEXT NOT NULL,
  nonce TEXT UNIQUE NOT NULL,
  wallet_address TEXT,          -- Set after verification
  status TEXT DEFAULT 'pending', -- pending, completed, expired, failed
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  ip_address TEXT,              -- For audit
  user_agent TEXT               -- For audit
);

CREATE INDEX idx_wallet_verification_discord ON wallet_verification_sessions(discord_user_id);
CREATE INDEX idx_wallet_verification_nonce ON wallet_verification_sessions(nonce);
```

### 4.4 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verify/{sessionId}` | Verification web page |
| POST | `/verify/{sessionId}` | Submit signature |
| GET | `/verify/{sessionId}/status` | Check verification status |

### 4.5 Implementation Components

```
themes/sietch/src/
├── api/routes/
│   └── verify.routes.ts         # NEW: Verification endpoints
├── discord/commands/
│   └── verify.ts                # NEW: /verify command
├── services/
│   └── WalletVerificationService.ts  # NEW: Signature verification
├── packages/verification/
│   ├── index.ts
│   ├── NonceManager.ts          # Nonce generation/validation
│   ├── SignatureVerifier.ts     # ECDSA recovery using viem
│   └── VerificationSession.ts   # Session management
└── static/
    └── verify.html              # Verification web page
```

---

## 5. User Experience

### 5.1 Discord /verify Flow

**Step 1: User runs `/verify` in Discord**
```
/verify
```

**Step 2: Bot sends DM with verification link**
```
🔐 Wallet Verification

Click the link below to verify your wallet ownership.
This link expires in 15 minutes.

👉 [Click to Verify](https://api.arrakis.community/verify/abc123)

⚠️ This will NOT request any transactions. You'll only sign a message to prove ownership.
```

**Step 3: User clicks link, sees verification page**
- Clean, branded page with community name
- "Connect Wallet" button (WalletConnect/Coinbase/injected)
- Clear explanation: "Sign to prove ownership"

**Step 4: User signs message**
- Standard EIP-191 personal_sign
- Clear "this is not a transaction" messaging

**Step 5: Success confirmation**
- Page shows "Verification successful!"
- Discord bot sends DM: "Your wallet is now linked. You've been assigned the Fedaykin role."
- User gets role in Discord automatically

### 5.2 Error States

| Error | User Message |
|-------|-------------|
| Session expired | "This verification link has expired. Run /verify again." |
| Invalid signature | "Signature verification failed. Please try again." |
| Wallet not eligible | "Your wallet doesn't meet the requirements for this community." |
| Already verified | "Your Discord account is already linked to {wallet}. Use /verify --reset to change." |

---

## 6. Security Considerations

### 6.1 Signature Verification

- Use `viem.verifyMessage()` for ECDSA signature recovery
- Nonces must be:
  - Cryptographically random (UUIDv4)
  - Single-use (deleted after verification)
  - Time-limited (15 minute expiry)
  - Guild-specific (prevent replay across servers)

### 6.2 Rate Limiting

| Limit | Value |
|-------|-------|
| Verification attempts per user per hour | 5 |
| Verification page requests per IP per minute | 30 |
| Signature submissions per session | 3 |

### 6.3 Audit Trail

Log all verification events:
- Session creation
- Signature submission (success/failure)
- Role assignment
- Session expiry

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Verification completion rate | >80% |
| Average time to verify | <60 seconds |
| Failed verification rate | <5% |
| Support tickets related to verification | <2% of users |

---

## 8. Implementation Phases

### Phase 1: Collab.Land Documentation (Sprint 70)
- [ ] Finalize `collabland-setup.md` guide
- [ ] Test Custom API Token Gate configuration
- [ ] Document webhook integration for onboarding trigger

### Phase 2: Native Verification Core (Sprint 71-72)
- [ ] `/verify` Discord command
- [ ] Nonce management service
- [ ] Signature verification with viem
- [ ] Database schema (verification sessions)
- [ ] Basic verification web page

### Phase 3: Polish & Security (Sprint 73)
- [ ] Rate limiting
- [ ] Audit trail
- [ ] Mobile wallet deep links
- [ ] Error handling & user messaging
- [ ] Security review

### Phase 4: Feature Parity (Sprint 74)
- [ ] Re-verification flow (`/verify --reset`)
- [ ] Verification status command (`/verify-status`)
- [ ] Admin override (`/admin-link @user wallet`)

---

## 9. Competitive Analysis

| Feature | Arrakis Native | Collab.Land | Guild.xyz |
|---------|---------------|-------------|-----------|
| **Cost** | $49/mo (Pro) | $99/mo | Free |
| **Self-hosted option** | ✅ | ❌ | ❌ |
| **Conviction scoring** | ✅ | ❌ | ❌ |
| **Tiered progression** | ✅ | ❌ | ✅ |
| **Cross-platform identity** | ✅ | ❌ | ✅ |
| **Custom eligibility logic** | ✅ | API only | ✅ |
| **Setup complexity** | Medium | Low | Medium |
| **Battle-tested security** | New | ✅ | ✅ |

---

## 10. Open Questions

1. **WalletConnect vs. custom page**: Should we use WalletConnect modal or build custom wallet connection UI?
2. **Mobile-first**: What percentage of users will verify from mobile? Do we need app deep links?
3. **Multi-wallet support**: Should users be able to link multiple wallets to one Discord account?
4. **Verification refresh**: How often should users re-verify? Never, or periodic?

---

## 11. Appendix

### A. EIP-191 Signature Format

```typescript
import { verifyMessage } from 'viem';

const message = `Verify your wallet for ${communityName}\n\nWallet: ${address}\nDiscord: ${username}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

const recoveredAddress = await verifyMessage({
  address,
  message,
  signature,
});

const isValid = recoveredAddress.toLowerCase() === address.toLowerCase();
```

### B. Related Documents

- `docs/research/collabland-integration.md` - Collab.Land research
- `docs/deployment/collabland-setup.md` - Collab.Land setup guide
- `src/services/IdentityService.ts` - Cross-platform identity (Telegram)

---

*Document generated for PRD review*
