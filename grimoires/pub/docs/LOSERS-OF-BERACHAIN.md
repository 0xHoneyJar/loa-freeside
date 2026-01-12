# LOSERS OF BERACHAIN

> Productive self-FUD: Convert your losses into social currency.

## Overview

A viral GTM campaign that calculates users' USD losses on Berachain and converts them into SPICE credits on Arrakis. The goal is to create chaos on the TL, drive registrations, and establish cultural gravity around the SCORE system.

**Inspired by:** ETH burned gas trackers, but inverted - we celebrate the rekt.

---

## Campaign Flow

```
1. Connect wallet
2. Calculate losses (spent vs current value)
3. Generate shareable "loser card" with graffiti'd Milady art
4. Mint NFT (1 BERA) to claim
5. Share to socials (required)
6. Receive SPICE credits = $USD lost
```

---

## Credit System: SPICE

### Singular Currency

**Name:** SPICE (or MELANGE)

**Conversion:** `$1 USD loss = 1 SPICE`

Like GP in RuneScape - flat, fungible, spendable within Arrakis.

**Properties:**
- Initially non-transferable
- Offchain for simplicity
- Used for Arrakis features/integrations
- Marketing budget in credit form

**Visual Treatment:**
```
◆ 4,392 SPICE
```
- Gem icon (◆) in brand spice color (#f4a460)
- Monospace display
- Subtle sandstorm particle effect on hover

---

## Flex Tiers: LOSS RANKS

Non-transferable badges that unlock card backgrounds and flex symbols.

### Tier Table

| Tier | Loss Range | Title | Card Background | Symbol |
|------|------------|-------|-----------------|--------|
| 0 | $0-100 | **Tourist** | Plain dark | None |
| 1 | $100-1K | **Outsider** | Subtle sand texture | Single worm track |
| 2 | $1K-10K | **Fremen** | Sand dunes | Crysknife |
| 3 | $10K-50K | **Fedaykin** | Deep desert storm | Maker hooks |
| 4 | $50K-100K | **Naib** | Spice blow eruption | Stilsuit mask |
| 5 | $100K+ | **Kwisatz Haderach** | Full sandworm emergence | The sleeper has awakened |

### Alternative Names (Meme-able)

| Dune Title | Degen Title |
|------------|-------------|
| Tourist | Paper Hands |
| Outsider | Bag Holder |
| Fremen | Diamond Hands (Cope) |
| Fedaykin | Professional Loser |
| Naib | Generational Wealth Destroyer |
| Kwisatz Haderach | The Liquidated One |

### Tier Colors (Brand Palette)

| Tier | Color | Hex |
|------|-------|-----|
| Tourist | Sand dim | `#6b6245` |
| Outsider | Sand | `#c9b99a` |
| Fremen | Spice | `#f4a460` |
| Fedaykin | Ruby | `#c45c4a` |
| Naib | Blue | `#5b8fb9` |
| Kwisatz Haderach | Bright gold | `#ffd700` |

---

## Shareable Card Design

```
┌─────────────────────────────────────────┐
│  [tier background - sandstorm/worms]    │
│                                         │
│                              ┌───┐      │
│                              │ F │ ←tier│
│    0xABC...123               └───┘      │
│    ─────────────                        │
│                                         │
│    ◆ 47,293 SPICE                       │
│                                         │
│    "I am become loss,                   │
│     destroyer of portfolios"            │
│                                         │
│    ───────────────────────────          │
│    LOSERS OF BERACHAIN                  │
│    arrakis.community                    │
└─────────────────────────────────────────┘
```

### Card Background Concepts

| Tier | Background |
|------|------------|
| Tourist | Flat dark (#0a0a0a) |
| Outsider | Faint topographic contour lines |
| Fremen | Animated sand particles drifting slowly |
| Fedaykin | Subtle spice glow radiating from center |
| Naib | Sandworm silhouettes in deep background |
| Kwisatz Haderach | Full animated sandworm emergence with spice explosion |

### Badge Placement Options

1. Top right corner letter (like CQ cards)
2. Watermark symbol behind loss amount
3. Border treatment (subtle glow in tier color)

---

## Gating Mechanics

### To Claim SPICE

1. Connect wallet
2. System calculates total USD losses on Berachain
3. Generate shareable card with graffiti'd Milady art
4. **Mint NFT** (1 BERA fee) - mental barrier / skin in game
5. **Share to X/Twitter** (required) - social distribution
6. SPICE credited to Arrakis account

### Why 1 BERA Mint?

- Creates mental barrier (they've invested something)
- Skin in the game psychology
- Nominal revenue
- Filters drive-by claimers

---

## SCORE Integration (Phase 2)

Only users with **SCORE >= 70** can sell SPICE in the marketplace.

**Effects:**
- Drives attention to SCORE system
- Rewards aligned community members
- Creates FOMO from non-aligned users
- Marketplace fees = revenue

### Marketplace Rules

| SCORE | Capability |
|-------|------------|
| < 70 | Hold, spend, or gift SPICE only |
| >= 70 | Can list SPICE for sale |
| >= 90 | Reduced marketplace fees |

---

## Future Considerations

### Pendle-style Separation (Phase 3+)

For select high-SCORE accounts:
- **PT (Principal Token):** One-time SPICE position
- **YT (Yield Token):** Ongoing credit stream

### Revenue Share Raise

Potential structure:
- Raise funds for % of revenue share
- Participants receive:
  - Pro-rata revenue share
  - Allocated SPICE credits to sell/use/gift
  - Access to native marketplace

**NOT tokens** - but speculative instruments with real output.

### Multi-Chain Expansion

If campaign succeeds:
- Partner with other L1/L2 foundations
- Create chain-specific "LOSERS OF [CHAIN]" campaigns
- Foundations subsidize SCORE model development
- Cross-ecosystem healing events

---

## Data Requirements

### Loss Calculation Formula

```
Total Loss = Σ(Amount Spent USD) - Σ(Current Value USD)
```

**Data points needed:**
- All wallet transactions on Berachain
- Historical USD prices at time of transaction
- Current holdings and their USD value
- Exclude: bridged assets (only native activity)

### Dune Query Structure

```sql
-- Pseudo-query
SELECT
  wallet_address,
  SUM(usd_value_at_tx_time) as total_spent,
  SUM(current_usd_value) as current_value,
  total_spent - current_value as total_loss
FROM berachain_transactions
GROUP BY wallet_address
```

---

## Success Metrics

### Phase 1 (Launch)

- [ ] X viral cards shared
- [ ] X unique wallet connections
- [ ] X NFTs minted (1 BERA each)
- [ ] X Arrakis registrations

### Phase 2 (Conversion)

- [ ] X% of registrants become paying subscribers
- [ ] X SPICE spent on integrations
- [ ] X marketplace transactions (SCORE >= 70)

---

## Timeline

| Phase | Milestone |
|-------|-----------|
| **NOW** | Prepare Dune data queries |
| **Week 1** | Card design + shareable generation |
| **Week 2** | Mint contract + claim flow |
| **Week 3** | Launch campaign |
| **Week 4+** | Monitor virality, iterate |
| **TBD** | Enable marketplace (requires subscribers) |

---

## Open Questions

- [ ] Final art direction for graffiti'd Miladies?
- [ ] Exact SCORE threshold for marketplace access?
- [ ] SPICE sink mechanics beyond marketplace?
- [ ] Integration partners for SPICE spending?
- [ ] Multi-sig or custodial for SPICE ledger?

---

## References

- [ETH Burned Gas Tracker](https://ultrasound.money/)
- [Drip.haus Credit System](https://drip.haus/)
- [CQ Flex Mechanics](internal)
- [Paddle Billing](https://paddle.com/)
