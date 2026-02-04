# Product Requirements Document: WYSIWYG Theme Builder

**Version**: 1.0.0
**Status**: Draft
**Created**: 2026-01-21
**Branch**: feature/wysiwyg-themes

---

## 1. Executive Summary

Build a visual theme builder that enables non-technical users to create Web3-integrated community experiences similar to the Sietch theme. The builder follows the MEE6 model of browser-based setup while providing blockchain data integration capabilities (NFT collections, token balances, on-chain activity).

**Vision**: WordPress for Web3 communities - start simple, enable a marketplace ecosystem.

**MVP Success Metric**: Internal team can recreate Sietch-equivalent theme using the builder UI.

---

## 2. Problem Statement

### Current Pain Points

1. **High barrier to entry**: Creating blockchain-integrated community themes requires developer resources
2. **Slow iteration**: Theme changes require code deployments, blocking community customization
3. **No self-service**: Community admins cannot brand their space without technical help
4. **Fragmented tooling**: Web3 data integration requires custom code for each project

### Opportunity

- MEE6 demonstrates demand for self-service Discord setup
- Web3 communities need branded experiences with blockchain data
- Existing Sietch theme proves the concept; now democratize creation

---

## 3. Goals & Success Metrics

### Business Goals

| Goal | Metric | Target |
|------|--------|--------|
| Enable self-service theme creation | Internal team recreates Sietch via UI | MVP |
| Scale to many communities | Support 10,000+ communities | Architecture goal |
| Future marketplace potential | Theme format supports sharing | Design constraint |

### Non-Goals (Explicit Out of Scope for MVP)

- Theme marketplace/sharing functionality
- Monetization features
- Mobile app builder
- Non-EVM chain support

---

## 4. User Personas

### Primary: Community Admin (Non-Technical)

- **Profile**: Discord server owner, project founder, community manager
- **Goal**: Brand their community space with Web3 data integration
- **Pain**: Can't code, relies on devs for every change
- **Expectation**: MEE6-like simplicity with Web3 power

### Secondary: Technical Power User

- **Profile**: Developer extending themes, building custom integrations
- **Goal**: Programmatic theme creation, CLI automation (gaib integration)
- **Pain**: GUI-only tools are limiting
- **Expectation**: JSON/code escape hatches, API access

### Future: Theme Creator (Marketplace)

- **Profile**: Designer/developer creating themes for others
- **Goal**: Build and potentially sell themes
- **Note**: Not MVP, but architecture should enable this path

---

## 5. Functional Requirements

### 5.1 Theme Builder UI

#### 5.1.1 Builder Modes (Hybrid Approach)

| Mode | User Type | Description |
|------|-----------|-------------|
| **Wizard** | Beginners | Step-by-step: Pick template → Configure → Deploy |
| **Visual Canvas** | Visual users | Figma/Canva-style drag-drop interface |
| **Code/JSON** | Power users | Direct JSON editing, CLI integration (gaib) |

#### 5.1.2 Live Preview

All preview modes must be available:
- Side-by-side editor + preview (default)
- Inline editing (click to edit on preview)
- Preview in new tab (auto-updates)

#### 5.1.3 Core Components (MVP)

| Component | Description | Priority |
|-----------|-------------|----------|
| **Token Gate** | Show/hide content based on token/NFT holdings | P0 |
| **NFT Gallery** | Display owned NFTs, filter by traits, showcase | P0 |
| **Leaderboard** | Rank members by holdings, activity, scores | P0 |
| **Profile Card** | Member profile with Web3 data | P0 |
| **Text/Rich Content** | Markdown/HTML content blocks | P0 |
| **Layout Containers** | Rows, columns, grids, tabs | P0 |

### 5.2 Web3 Data Integration

#### 5.2.1 Supported Data Sources

| Source | Data Types | Chains |
|--------|-----------|--------|
| **NFT Collections** | Ownership, traits, rarity, floor price | Multi-chain EVM |
| **Token Balances** | Holdings, staked amounts, rewards | Multi-chain EVM |
| **On-chain Activity** | Transactions, governance votes | Multi-chain EVM |
| **Custom Contracts** | Arbitrary contract reads | Multi-chain EVM |

#### 5.2.2 Contract Input Security

- Validate contract addresses (checksum, format)
- Whitelist known ABIs for common patterns
- Rate limit contract queries
- Sandbox contract interactions (read-only)

#### 5.2.3 Multi-Chain Support

Support all EVM chains from day 1:
- Ethereum mainnet
- L2s: Arbitrum, Optimism, Base, Polygon
- Configurable RPC endpoints per chain
- Chain-agnostic component design

### 5.3 Platform Coverage

Themes apply across all touchpoints:

| Platform | Customization Level |
|----------|-------------------|
| **Web Dashboard** | Full theme control |
| **Public Community Pages** | Full theme control |
| **Discord Embeds** | Colors, templates (permission-aware) |

#### 5.3.1 Discord Permission Modes

| Mode | Permissions | Capabilities |
|------|-------------|--------------|
| **Greenfield** | Full bot permissions | Full embed customization |
| **Restricted** | Limited permissions | Template-based, safe defaults |

### 5.4 Theme Data Model

#### 5.4.1 Storage Requirements

- JSON-based theme configuration
- Version history (undo/rollback)
- Draft vs published states
- Multi-community isolation

#### 5.4.2 Theme Schema (Conceptual)

```typescript
interface Theme {
  id: string;
  version: string;
  name: string;
  description: string;

  // Visual configuration
  branding: {
    colors: ColorPalette;
    fonts: FontConfig;
    logo?: string;
  };

  // Layout structure
  pages: Page[];
  components: ComponentInstance[];

  // Web3 configuration
  contracts: ContractBinding[];
  chains: ChainConfig[];

  // Platform-specific
  discord?: DiscordThemeConfig;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
```

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Theme render time | <500ms | Responsive user experience |
| Builder load time | <3s | Competitive with MEE6 |
| Support 10k communities | Horizontal scale | Business growth target |
| Theme config size | <1MB | Reasonable storage per community |

### 6.2 Security

| Requirement | Implementation |
|-------------|---------------|
| Contract address validation | Checksum, format, known malicious list |
| Read-only contract interactions | No write operations from theme engine |
| Input sanitization | All user inputs sanitized |
| Rate limiting | Per-community query limits |
| XSS prevention | Sanitize rendered content |

### 6.3 Reliability

| Requirement | Target |
|-------------|--------|
| Theme builder uptime | 99.5% |
| Theme rendering uptime | 99.9% |
| Data backup | Daily, 30-day retention |

### 6.4 Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive design (desktop-first, mobile-aware)
- Leverage existing Arrakis infrastructure

---

## 7. Technical Constraints

### 7.1 Architecture Principles

1. **Use existing infrastructure**: SQLite + Redis stack, PostgreSQL if available
2. **Minimize new dependencies**: Only add complexity where justified
3. **Sietch as reference**: Don't modify Sietch; use as implementation guide
4. **Parallel development**: Build new engine, migrate later

### 7.2 Integration Points

| System | Integration |
|--------|-------------|
| Existing auth | Reuse admin authentication |
| Existing billing | Theme features may be tier-gated |
| Existing Web3 infra | Reuse RPC connections, caching |
| gaib CLI | Programmatic theme creation (future) |

### 7.3 Future-Proofing

- Theme format must support marketplace sharing (future)
- API-first design for CLI/automation
- Component system extensible for new Web3 primitives

---

## 8. Scope & Prioritization

### 8.1 MVP (Phase 1)

**Goal**: Recreate Sietch-equivalent theme via builder UI

| Feature | Priority | Notes |
|---------|----------|-------|
| Theme data model & storage | P0 | Foundation |
| Core components (6 types) | P0 | Token gate, NFT gallery, leaderboard, profile, text, layout |
| Visual canvas builder | P0 | Drag-drop interface |
| Live preview (side-by-side) | P0 | Real-time feedback |
| Multi-chain contract binding | P0 | EVM chains |
| Basic wizard flow | P1 | Guided onboarding |
| Theme versioning | P1 | Undo/rollback |

### 8.2 Phase 2 (Post-MVP)

| Feature | Priority |
|---------|----------|
| Full component library expansion | P1 |
| Inline editing preview mode | P1 |
| Discord embed builder | P1 |
| JSON/code editing mode | P2 |
| gaib CLI integration | P2 |
| Theme templates gallery | P2 |

### 8.3 Future Phases

| Feature | Phase |
|---------|-------|
| Theme marketplace | Phase 3+ |
| Theme monetization | Phase 3+ |
| Mobile optimization | Phase 3+ |

---

## 9. Risks & Mitigations

### 9.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance at 10k scale | Medium | High | Design for horizontal scaling, caching strategy |
| Malicious contract inputs | Medium | High | Strict validation, read-only, rate limits |
| Complexity creep | High | Medium | Strict MVP scope, defer features to phases |

### 9.2 Product Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Too complex for non-technical users | Medium | High | Wizard mode, user testing, templates |
| Insufficient for power users | Low | Medium | JSON escape hatch, API access |

### 9.3 Dependencies

| Dependency | Owner | Risk |
|------------|-------|------|
| Existing auth system | Platform | Low - stable |
| RPC infrastructure | Platform | Medium - rate limits |
| Web3 data accuracy | External | Medium - cache staleness |

---

## 10. Open Questions

1. **Theme isolation**: How strictly should themes be isolated between communities?
2. **Caching strategy**: How to balance freshness vs performance for Web3 data?
3. **Component versioning**: How to handle component updates without breaking themes?
4. **Migration path**: Timeline for migrating Sietch to theme engine?

---

## 11. Appendix

### A. Competitive Reference

| Product | Strengths | Gaps |
|---------|-----------|------|
| MEE6 | Easy setup, popular | No Web3 integration |
| Collab.Land | Web3 token gating | No visual builder |
| Guild.xyz | Role management | Limited customization |

### B. Sietch Feature Inventory

Reference for MVP parity:
- Token-gated access
- NFT showcase galleries
- Member leaderboards
- Profile cards with holdings
- Multi-chain support
- Discord integration

---

*Document generated from PRD discovery session 2026-01-21*
