# Sprint S-24: Incumbent Detection & Shadow Ledger

## Implementation Report

**Sprint ID**: S-24
**Phase**: 11 - Shadow Mode
**Status**: Complete

---

## Summary

Implemented the incumbent detection and shadow ledger system for Phase 11 (Shadow Mode). This enables Arrakis to run in shadow mode alongside existing token-gating providers (Collab.Land, Matrica, Guild.xyz), tracking divergences without affecting members, and proving accuracy before taking over gating duties.

## Tasks Completed

### S-24.1: IncumbentDetector Class
- **File**: `packages/adapters/coexistence/incumbent-detector.ts`
- Implemented auto-detection of incumbent providers using three evidence types:
  - Bot ID matching (highest confidence: 0.95)
  - Channel name patterns (medium confidence: 0.7)
  - Role name patterns (lower confidence: 0.5)
- Detection algorithm aggregates evidence by incumbent type and normalizes confidence

### S-24.2: Confidence Scoring
- **File**: `packages/core/domain/coexistence.ts`
- Defined confidence weights per evidence type
- Confidence aggregation: sum of evidence scores normalized to 0-1
- Minimum confidence threshold (default 0.3) filters low-confidence detections

### S-24.3: Shadow Ledger ScyllaDB Schema
- **File**: `infrastructure/migrations/003_shadow_ledger_schema.cql`
- Three main tables:
  - `shadow_member_state`: Per-member incumbent vs Arrakis state
  - `shadow_divergences`: Divergence history (false positives/negatives)
  - `shadow_predictions`: Accuracy validation predictions
- Materialized views for efficient guild-level queries
- 90-day TTL on all tables for automatic cleanup

### S-24.4: Shadow Member State Repository
- **File**: `packages/adapters/coexistence/shadow-ledger.ts`
- `ScyllaDBShadowLedger` implements `IShadowLedger` port
- CRUD operations for member states
- Batch insert support for efficient sync
- Guild-level state queries

### S-24.5: Divergence Recording
- Automatic divergence type classification (false_positive vs false_negative)
- Resolution tracking with timestamps
- Divergence counts by type for analytics

### S-24.6: Prediction Tracking
- UUID-based prediction IDs
- Verification workflow with actual value comparison
- Batch verification support
- Accuracy calculation over time ranges

### S-24.7: Detection Tests (>90% Accuracy)
- **Files**:
  - `packages/adapters/coexistence/incumbent-detector.test.ts` (51 tests)
  - `packages/adapters/coexistence/shadow-ledger.test.ts` (32 tests)
- 83 total tests, all passing
- Coverage includes:
  - Bot ID detection for all known providers
  - Channel pattern matching
  - Role pattern matching
  - Confidence scoring and normalization
  - Error handling
  - Shadow ledger CRUD operations
  - Divergence and prediction tracking

## Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `packages/core/domain/coexistence.ts` | Domain types, constants, patterns |
| `packages/core/ports/shadow-ledger.ts` | IShadowLedger port interface |
| `packages/adapters/coexistence/incumbent-detector.ts` | IncumbentDetector implementation |
| `packages/adapters/coexistence/shadow-ledger.ts` | ScyllaDBShadowLedger adapter |
| `packages/adapters/coexistence/index.ts` | Barrel exports |
| `infrastructure/migrations/003_shadow_ledger_schema.cql` | ScyllaDB schema |
| `packages/adapters/coexistence/incumbent-detector.test.ts` | Detection tests |
| `packages/adapters/coexistence/shadow-ledger.test.ts` | Ledger tests |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/domain/index.ts` | Export coexistence types |
| `packages/core/ports/index.ts` | Export shadow-ledger interface |
| `packages/adapters/package.json` | Add coexistence export path |

## Architecture Notes

### Hexagonal Architecture
- **Port**: `IShadowLedger` interface in `@arrakis/core/ports`
- **Adapter**: `ScyllaDBShadowLedger` in `@arrakis/adapters/coexistence`
- Clean separation allows swapping storage backend

### Detection Strategy
1. Bot ID matching is most reliable (unique IDs per provider)
2. Channel patterns catch provider-specific verification channels
3. Role patterns catch common naming conventions
4. Evidence is aggregated by provider and normalized

### ScyllaDB Schema Design
- Partition keys designed for efficient guild-level queries
- Clustering order by timestamp for newest-first retrieval
- Time-window compaction for divergences (efficient for time-series)
- Size-tiered compaction for member state and predictions

## Test Results

```
 ✓ coexistence/shadow-ledger.test.ts  (32 tests) 18ms
 ✓ coexistence/incumbent-detector.test.ts  (51 tests) 15ms

 Test Files  2 passed (2)
      Tests  83 passed (83)
```

## Known Patterns

### Collab.Land
- Bot IDs: `703886990948565003`, `704521096837464076`
- Channels: `collabland-join`, `collab-land`, `cl-verify`
- Roles: patterns containing "collab", "holder", "verified"

### Matrica
- Bot ID: `879673158287544361`
- Channels: `matrica-verify`, `matrica-join`
- Roles: patterns containing "matrica"

### Guild.xyz
- Bot ID: `868172385000509460`
- Channels: `guild-verify`, `guild-join`
- Roles: patterns containing "guild.xyz", "guildxyz"

## SDD References
- SDD §7.1 Shadow Mode Architecture
- SDD §7.1.2 Incumbent Detection
- SDD §7.1.3 Shadow Ledger Schema
- SDD §7.1.4 Shadow Sync Interval (6 hours default)

## Next Steps
- Sprint S-25: Shadow Sync Service (periodic sync orchestration)
- Integration with community onboarding wizard
- Dashboard for divergence visualization
