# ERC-6551 Agent Wallets — Technical Feasibility Analysis

**Sprint:** 235 (Cycle 025, Sprint 6)
**Author:** Claude Opus 4.6
**Date:** 2026-02-14
**Status:** RESEARCH — Go/No-Go Recommendation

---

## 1. Executive Summary

ERC-6551 Token-Bound Accounts (TBAs) enable NFTs to own assets and execute transactions. For Arrakis, this means each finnNFT could autonomously hold USDC and pay for its own inference — enabling truly self-funded AI agents.

**Recommendation: GO for V2, with hybrid approach (credit ledger + on-chain TBA).**

---

## 2. ERC-6551 Specification Summary

### What Are Token-Bound Accounts?

ERC-6551 (finalized May 2023) creates smart contract wallets controlled by ERC-721 NFTs. Each NFT gets a deterministic address derived from:

- Registry contract address
- Implementation contract address
- Chain ID
- NFT contract address
- Token ID
- Salt

### Key Properties

| Property | Value |
|----------|-------|
| Standard | ERC-6551 |
| Registry | Singleton deployed on all major chains |
| Account | Minimal proxy (ERC-1167) pointing to implementation |
| Control | NFT owner controls the TBA |
| Assets | Can hold ERC-20, ERC-721, ERC-1155, native tokens |
| Transferability | When NFT transfers, TBA assets transfer with it |

### How It Works

1. **Registry** deploys a new account (CREATE2 — deterministic address)
2. **Account** is a smart contract wallet that checks `ownerOf(tokenId)` on execution
3. **Operations** are executed by calling the account with calldata
4. **Nested ownership**: TBAs can own other NFTs which can have their own TBAs

---

## 3. Integration with Arrakis finnNFT

### Current Architecture

- finnNFTs are ERC-721 tokens on Base chain
- Each finn (AI agent) has a tokenId
- Agents currently use shared platform credits (entity_type: 'agent')

### Proposed Integration

```
finnNFT (ERC-721)
  └─ TBA (ERC-6551)
       ├─ Holds USDC (ERC-20) on-chain
       └─ Maps to credit_account (entity_type: 'agent')
           └─ Off-chain credit ledger for micro-transactions
```

### Integration Steps

1. **Deploy TBA**: Call ERC-6551 Registry for each finnNFT
2. **Fund TBA**: Transfer USDC to TBA address
3. **Bridge to Credits**: TBA USDC balance → credit_account via deposit webhook
4. **Agent Spending**: Agent uses credit ledger for inference (off-chain, fast)
5. **Top-Up**: When credits low, agent triggers on-chain USDC → credit deposit

### Key Constraint

On-chain transactions (USDC transfer, TBA operations) are too slow and expensive for per-inference billing. The credit ledger handles micro-transactions off-chain; the TBA serves as the agent's on-chain treasury.

---

## 4. Gas Cost Analysis — Base Chain

Base chain (OP Stack L2) offers significantly lower gas costs than Ethereum mainnet.

### Estimated Costs (Base, Feb 2026)

| Operation | Gas Units | Est. Cost (USD) |
|-----------|-----------|-----------------|
| TBA Creation (Registry.createAccount) | ~150,000 | $0.01-0.03 |
| USDC Transfer to TBA | ~65,000 | $0.005-0.01 |
| TBA Execute (USDC transfer out) | ~120,000 | $0.008-0.02 |
| ERC-20 Approve | ~46,000 | $0.003-0.008 |

### Cost Assessment

- **One-time setup**: ~$0.05 per agent (TBA creation + initial USDC transfer)
- **Per top-up**: ~$0.02 per on-chain deposit
- **Amortized**: If agent tops up $50 in USDC per deposit, gas is 0.04% overhead

**Verdict: Gas costs are negligible on Base. Not a blocker.**

---

## 5. lobster.cash API Evaluation

### Current Status

lobster.cash provides ERC-6551 tooling and APIs. As of the analysis date:

- SDK available for account creation and management
- REST API for querying TBA state
- Support for Base chain

### Assessment

| Capability | lobster.cash | Direct Registry |
|-----------|-------------|-----------------|
| TBA creation | SDK/API | Direct contract call |
| Balance queries | API endpoint | multicall/viem |
| Transaction execution | SDK | Direct contract call |
| Complexity | Lower (abstracted) | Higher (raw contracts) |
| Dependency | External service | Self-hosted |

**Recommendation**: Start with direct Registry calls for V2 prototype. Evaluate lobster.cash if account management complexity increases. Avoid external dependency for critical path.

---

## 6. Comparison: TBA vs Alternatives

### Option A: ERC-6551 Token-Bound Accounts

| Pro | Con |
|-----|-----|
| NFT-native — assets travel with NFT | Requires ERC-6551 Registry deployment knowledge |
| Deterministic addresses (predictable) | Additional smart contract surface area |
| Standard — ecosystem tooling available | NFT transfer transfers ALL assets (may be unexpected) |
| Agent identity = NFT identity | Nested ownership complexity |

### Option B: Simple Smart Contract Wallet

| Pro | Con |
|-----|-----|
| Full control over implementation | No standard — custom development |
| Simpler mental model | No asset portability on NFT transfer |
| No dependency on ERC-6551 registry | Each wallet is independent silo |

### Option C: Gnosis Safe (Safe{Wallet})

| Pro | Con |
|-----|-----|
| Battle-tested, audited | Heavyweight for single-agent use |
| Multi-sig capable | Not NFT-native |
| Rich ecosystem (modules, guards) | Higher gas costs |
| Recovery mechanisms | Over-engineered for this use case |

### Recommendation Matrix

| Criterion | ERC-6551 | Simple Wallet | Gnosis Safe |
|-----------|----------|---------------|-------------|
| NFT integration | ★★★ | ★ | ★ |
| Gas efficiency | ★★★ | ★★★ | ★★ |
| Ecosystem support | ★★ | ★ | ★★★ |
| Implementation effort | ★★ | ★★★ | ★ |
| Asset portability | ★★★ | ★ | ★ |
| **Total** | **13** | **9** | **8** |

**Winner: ERC-6551** — natural fit for NFT-based agents with asset portability.

---

## 7. Recommended V2 Architecture

### Hybrid Model: On-Chain Treasury + Off-Chain Ledger

```
┌──────────────────────────────────────────┐
│               Agent Wallet               │
├──────────────────────────────────────────┤
│                                          │
│  ┌─────────────┐    ┌────────────────┐   │
│  │ TBA (6551)  │    │ Credit Account │   │
│  │ On-Chain    │───▶│ Off-Chain      │   │
│  │             │    │                │   │
│  │ USDC Balance│    │ Micro-USD      │   │
│  │ (Treasury)  │    │ Balance        │   │
│  └─────────────┘    └────────────────┘   │
│                                          │
│  Deposit: TBA USDC → Credit Account     │
│  Spending: Credit Ledger (fast, free)    │
│  Refill: Auto-trigger when balance low   │
│                                          │
└──────────────────────────────────────────┘
```

### Implementation Phases

**Phase 1 (V2 MVP):**
- Deploy TBA for each finnNFT via Registry
- Manual USDC deposit to TBA → credit account bridge
- Agent spends from credit ledger normally

**Phase 2 (V2.1):**
- Auto-refill: agent monitors credit balance, triggers on-chain deposit when low
- Budget caps: daily/weekly spending limits per agent
- Owner controls: NFT owner sets spending policies

**Phase 3 (V2.2):**
- Agent-to-agent payments via credit ledger
- Revenue sharing: agents earn credits from their work
- On-chain settlement: periodic credit → USDC settlement

---

## 8. Go/No-Go Recommendation

### GO — With Conditions

| Factor | Assessment | Status |
|--------|-----------|--------|
| Technical feasibility | ERC-6551 is proven, Base gas is cheap | ✅ GO |
| Credit ledger integration | entity_type: 'agent' already supported | ✅ GO |
| Gas costs | Negligible on Base ($0.05 setup, $0.02/deposit) | ✅ GO |
| Complexity | Hybrid model keeps billing fast (off-chain) | ✅ GO |
| Risk | Smart contract surface area increases | ⚠️ Mitigated |
| Timeline | 2-3 sprint estimate for Phase 1 | ✅ Acceptable |

### Conditions for Proceeding

1. **Security audit** of TBA integration before production
2. **Budget cap enforcement** before agent auto-spending goes live
3. **Kill switch**: ability to freeze agent spending instantly
4. **Test on Base Sepolia** before mainnet deployment

### Not Recommended

- Direct on-chain billing per inference (too slow, too expensive even on L2)
- Gnosis Safe (over-engineered for single-agent wallets)
- Custom wallet contracts (no standard, maintenance burden)
