# Product Requirements Document: Sietch

**Version**: 1.0
**Date**: December 17, 2025
**Status**: Draft

---

## 1. Executive Summary

### 1.1 Product Overview

**Sietch** is a token-gated Discord community for the top 69 BGT (Berachain Governance Token) holders who have never redeemed (burned) any of their BGT holdings. Eligibility is determined entirely on-chain, creating a verifiable and objective membership criteria. The community provides a dedicated space for these participants to connect, discuss, and potentially coordinate on ecosystem matters.

### 1.2 Problem Statement

There is currently no dedicated space for top BGT holders to connect with each other. Existing community channels serve a broad audience, which can dilute signal quality for participants seeking focused discussions with others who share similar on-chain positions.

### 1.3 Vision

Sietch becomes a self-governing group within the Berachain ecosystem—a forum where top BGT holders can have candid discussions under Chatham House Rules, share insights, and potentially coordinate on ecosystem matters.

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Sign-up rate | >50% of eligible holders | Verified members / Top 69 eligible |
| Daily Active Users | >20% of members | Unique daily message authors |
| Retention | >80% at 30 days | Members who remain eligible and active |

---

## 2. User & Stakeholder Context

### 2.1 Target Users

**Primary**: Top 69 BGT holders who have never redeemed any BGT

Eligibility is determined by:
1. BGT claimed from reward vaults (not purchased/transferred)
2. Zero BGT burned (transferred to 0x0 address)
3. Ranked in top 69 by total BGT held meeting above criteria

**Profile characteristics**:
- Active Berachain participants
- Likely validators, liquidity providers, or protocol participants
- Have accumulated BGT through reward vaults without redeeming
- Potential interest in governance and ecosystem coordination

### 2.2 Stakeholders

| Stakeholder | Interest | Involvement |
|-------------|----------|-------------|
| Server Admin (Owner) | Community health, platform stability | Day-to-day operations, handover documentation |
| Naib Council (Top 7) | Strategic discussions, social leadership | Council role, potential future governance |
| Fedaykin (Top 69) | Peer networking, alpha sharing, coordination | Active participation |
| Berachain Ecosystem | Power user engagement, governance participation | Indirect beneficiary |

---

## 3. Functional Requirements

### 3.1 Eligibility Verification

#### 3.1.1 Data Source

Eligibility is determined by the following SQL query executed against Berachain on-chain data:

```sql
-- Users who claimed BGT but never redeemed (burned) any
-- Ordered by most BGT held

with bgt_claimed as (
    select
        "to"               as recipient,
        sum(reward / 1e18) as bgt_claimed
    from berachain_berachain.rewardvault_evt_rewardpaid
    group by 1
),

bgt_burned as (
    select
        "from"            as recipient,
        sum(value / 1e18) as bgt_burned
    from berachain_berachain.bgt_evt_transfer
    where "to" = 0x0000000000000000000000000000000000000000
    group by 1
)

select
    c.recipient,
    c.bgt_claimed as bgt_held
from bgt_claimed c
left join bgt_burned b on b.recipient = c.recipient
where coalesce(b.bgt_burned, 0) = 0
order by c.bgt_claimed desc
```

**Source file**: `docs/data/bgt-claimed-not-redeemed.sql`

#### 3.1.2 Refresh Cadence

- **Frequency**: Every 6 hours
- **Grace period**: During data source outages, no access revocations occur
- **Caching**: Last known valid list is cached and used during outages

#### 3.1.3 Wallet Verification

- Standard Collab.Land wallet signature verification
- No special support required for multisigs or smart contract wallets

### 3.2 Access Control

#### 3.2.1 Role Hierarchy

| Role | Criteria | Permissions |
|------|----------|-------------|
| **Naib** | Top 7 by BGT held | Access to #council-rock, Naib visual badge |
| **Fedaykin** | Top 8-69 by BGT held | Access to all public channels |
| **None** | Outside top 69 or has redeemed BGT | No server access |

#### 3.2.2 Dynamic Role Updates

Roles update automatically based on eligibility changes:

- **Promotion to Naib**: When a Fedaykin enters top 7
- **Demotion from Naib**: When a Naib falls below top 7
- **Access revocation**: When a member falls out of top 69 OR redeems any BGT

#### 3.2.3 Access Change Notifications

When a member loses access:

1. **DM Notification**: Member receives a direct message explaining:
   - Reason for removal (rank change or redemption detected)
   - Current rank/status
   - Path to regain access (if applicable)

2. **Public Announcement**: Message posted to #the-door channel:
   - Wallet address (truncated)
   - Reason for departure
   - No personally identifying information

### 3.3 Discord Server Structure

```
SIETCH
├── 📜 STILLSUIT (Info Category)
│   ├── #water-discipline ── Welcome message, community rules, Chatham House reminder
│   ├── #census ──────────── Live top 69 leaderboard, auto-updated every 6 hours
│   └── #the-door ────────── Public log of member joins and departures
│
├── 🔥 NAIB COUNCIL (Top 7 Only Category)
│   └── #council-rock ────── Private discussion for Naib council members
│
├── 💬 SIETCH-COMMONS (All Members Category)
│   ├── #general ─────────── Main discussion channel
│   ├── #spice ───────────── Market insights, protocol alpha, ecosystem news
│   └── #water-shares ────── Ideas and proposals for capital allocation
│
└── 🛠️ WINDTRAP (Operations Category)
    └── #support ─────────── Verification issues, bot status, technical help
```

### 3.4 Community Rules

#### 3.4.1 Chatham House Rules

All discussions in Sietch operate under Chatham House Rules:
- Participants may use information from discussions
- Identity of speakers may not be revealed
- No attribution of statements to individuals or their affiliations

#### 3.4.2 Code of Conduct

- Respectful discourse
- No doxxing or identity exposure
- No financial advice (discussions are for informational purposes)
- No solicitation or spam

---

## 4. Technical Requirements

### 4.1 System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dune API      │────▶│  Sietch Service │────▶│   Collab.Land   │
│  (Data Source)  │     │   (Custom API)  │     │  (Discord Bot)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Discord Server │
                        │    (Sietch)     │
                        └─────────────────┘
```

### 4.2 Sietch Service (Custom Middleware)

**Purpose**: Bridge between Dune Analytics and Collab.Land

**Hosting**: OVH bare metal VPS (existing infrastructure)

**Components**:

| Component | Function |
|-----------|----------|
| Cron Job | Executes Dune query every 6 hours |
| Cache Layer | Stores last valid eligibility list |
| REST API | Exposes eligibility endpoint for Collab.Land |
| Health Monitor | Detects Dune outages, triggers grace period |

**API Endpoints**:

```
GET /eligibility
Response: {
  "updated_at": "2025-12-17T12:00:00Z",
  "grace_period": false,
  "top_69": [
    {"rank": 1, "address": "0x...", "bgt_held": 12345.67},
    ...
  ],
  "top_7": ["0x...", "0x...", ...]
}

GET /health
Response: {
  "status": "healthy",
  "last_successful_query": "2025-12-17T12:00:00Z",
  "next_query": "2025-12-17T18:00:00Z"
}
```

### 4.3 Collab.Land Integration

**Integration Method**: Custom API Token Gating

**Configuration**:
- Token Gate Rule pointing to Sietch Service API
- Role assignment based on API response:
  - Address in `top_7` array → Naib role
  - Address in `top_69` array (not top 7) → Fedaykin role
  - Address not in list → No access

### 4.4 Non-Functional Requirements

| Requirement | Specification |
|-------------|---------------|
| Availability | 99% uptime for API service |
| Latency | API response < 500ms |
| Data Freshness | Maximum 6 hours stale |
| Grace Period | 24 hours during outages before any action |
| Security | HTTPS only, rate limiting, no PII storage |

### 4.5 Maintenance Requirements

- **Minimal ongoing maintenance** by design
- Automated alerts for service failures
- Comprehensive documentation for handover

---

## 5. Scope

### 5.1 In Scope (MVP)

- [x] Discord server creation with Dune-themed structure
- [x] Collab.Land integration for wallet verification
- [x] Custom eligibility service (Dune → API → Collab.Land)
- [x] Automatic role assignment (Naib, Fedaykin)
- [x] 6-hour eligibility refresh
- [x] Access change notifications (DM + public)
- [x] Grace period during outages
- [x] Handover documentation

### 5.2 Out of Scope (Future Phases)

- Formal on-chain governance/voting mechanisms
- Treasury management features
- Integration with other protocols
- Mobile app
- Multi-chain support
- Tiered membership beyond Top 69

### 5.3 Assumptions

1. Dune Analytics API remains available and performant
2. Collab.Land supports custom API token gating
3. BGT contract events are reliably indexed by Dune
4. Members will complete standard wallet signature verification

### 5.4 Constraints

1. Eligibility based solely on on-chain data (no off-chain criteria)
2. Single Discord server (no federation)
3. Manual server administration initially

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Dune API outage | Medium | High | Grace period + cached eligibility list |
| Collab.Land service changes | Low | High | Document API contract, monitor for deprecations |
| Sybil attacks (wallet splitting) | Low | Low | BGT acquisition mechanics make this impractical |
| Low adoption by eligible holders | Medium | Medium | Direct outreach to top holders |
| Council (Naib) inactivity | Medium | Low | Social role only in MVP; no blocking dependencies |
| Admin unavailability | Low | Medium | Comprehensive handover documentation |

---

## 7. Dependencies

### 7.1 External Services

| Service | Purpose | Criticality |
|---------|---------|-------------|
| Dune Analytics | On-chain data queries | Critical |
| Collab.Land | Discord token gating | Critical |
| Discord | Community platform | Critical |
| OVH VPS | Custom service hosting | Critical |

### 7.2 Data Dependencies

| Data | Source | Update Frequency |
|------|--------|------------------|
| BGT claimed events | `berachain_berachain.rewardvault_evt_rewardpaid` | Real-time (Dune) |
| BGT burn events | `berachain_berachain.bgt_evt_transfer` (to 0x0) | Real-time (Dune) |

---

## 8. Timeline & Milestones

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 1 | Discord server setup with channel structure | None |
| 2 | Sietch Service development & deployment | OVH VPS access, Dune API key |
| 3 | Collab.Land configuration & testing | Sietch Service live |
| 4 | Documentation & handover materials | All above complete |
| 5 | Soft launch with initial members | All above complete |
| 6 | Iteration based on feedback | Community feedback |

---

## 9. Documentation Requirements

### 9.1 Operational Documentation

- [ ] Server administration guide
- [ ] Collab.Land configuration reference
- [ ] Sietch Service deployment & maintenance runbook
- [ ] Incident response procedures

### 9.2 Handover Documentation

- [ ] Complete system architecture overview
- [ ] All credentials and access methods (securely stored)
- [ ] Escalation contacts
- [ ] Known issues and workarounds

### 9.3 Community Documentation

- [ ] Member onboarding guide
- [ ] FAQ for verification issues
- [ ] Community guidelines (Chatham House Rules explanation)

---

## 10. Appendix

### 10.1 Naming Convention Reference

Names drawn from Frank Herbert's **Dune** universe:

| Term | Dune Meaning | Sietch Usage |
|------|--------------|--------------|
| **Sietch** | Hidden desert community | Server name |
| **Naib** | Leader of a sietch | Top 7 council role |
| **Fedaykin** | Elite fighters, death commandos | Top 69 member role |
| **Stillsuit** | Survival gear preserving water | Info category (preserving knowledge) |
| **Spice** | Most valuable substance | Alpha/insights channel |
| **Water-shares** | Tribal wealth unit | Capital allocation channel |
| **Windtrap** | Device capturing moisture | Support/operations category |

### 10.2 Chatham House Rule (Full Text)

> "When a meeting, or part thereof, is held under the Chatham House Rule, participants are free to use the information received, but neither the identity nor the affiliation of the speaker(s), nor that of any other participant, may be revealed."

*Source: Chatham House (The Royal Institute of International Affairs)*

### 10.3 Reference Files

- Eligibility SQL: `docs/data/bgt-claimed-not-redeemed.sql`
- Naming research: `docs/research/naming-universe-loa-research.md`

---

*Document generated by PRD Architect*
