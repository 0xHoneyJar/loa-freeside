---
title: "ADR-006: Architect Pool Unreachability by Direct Alias"
trust_tier: operator-authored
read_state: unread
confidence: 0.5
decay_class: reference
last_confirmed: 2026-06-03
operator_signed: self_attested
---

# ADR-006: Architect Pool Unreachability by Direct Alias

**Status**: Accepted
**Date**: 2026-02-11
**Context**: Bridgebuilder Hardening — PR #51 Review Feedback (cycle-013, Finding F-8)

## Context

The pool mapping system defines 5 pool IDs (`cheap`, `fast-code`, `reviewer`, `reasoning`, `architect`) but only 4 model aliases map directly to pools via `ALIAS_TO_POOL`. The `architect` pool ID is deliberately excluded from direct alias mapping.

During cross-model review (GPT-5.2), the reviewer suggested adding `architect` to `ALIAS_TO_POOL` for completeness. This ADR documents why that suggestion was correctly rejected.

## Decision

**`architect` is a pool ID but NOT a model alias.** It is only reachable through:

1. **`native` alias on enterprise tier** — `NATIVE_POOL['enterprise'] = 'architect'`
2. **Tier default** — `ACCESS_LEVEL_POOLS['enterprise'].default = 'architect'`

The `ALIAS_TO_POOL` mapping deliberately excludes it:

```typescript
export const ALIAS_TO_POOL: Partial<Record<ModelAlias, PoolId>> = {
  cheap: 'cheap',
  'fast-code': 'fast-code',
  reviewer: 'reviewer',
  reasoning: 'reasoning',
  // architect: intentionally excluded — see ADR-006
};
```

The TypeScript type `Partial<Record<ModelAlias, PoolId>>` enforces this at compile time — not all aliases need a pool mapping.

## Rationale

This asymmetry **IS the access control**:

1. **Anti-escalation**: If `architect` were a direct alias, any tier could request it. The `resolvePoolId()` fallback would catch unauthorized access, but the intent would be ambiguous — is the caller confused or attempting escalation?

2. **Tier gating by design**: The most expensive pool (GPT-5.2/Claude Opus 4.6 class models) should only be reachable through tier-aware resolution paths that encode the business rule: "you must be enterprise to use architect."

3. **Defense in depth**: Even if `resolvePoolId()` correctly falls back unauthorized `architect` requests to the tier default, excluding it from `ALIAS_TO_POOL` prevents the request from ever being interpreted as a valid intent. The system treats `architect` as an unknown alias → tier default, rather than a known-but-unauthorized alias → tier default with logged fallback.

## Consequences

- Enterprise users requesting the best model use `native` (which resolves to `architect`), not `architect` directly
- Free/pro users cannot even express intent to use `architect` — the alias doesn't exist in the mapping
- Pool claim validation (`validatePoolClaims`) can still validate `architect` as a pool_id in JWT claims, since `VALID_POOL_IDS` includes all 5 pools
- Future pool additions should follow this pattern: if a pool is tier-restricted, exclude it from `ALIAS_TO_POOL` and route through `native` or tier defaults

## Pattern

This ADR is an instance of the **Capability-Based Security** pattern (Dennis & Van Horn, 1966). Pool IDs are unforgeable capability tokens; tier-aware resolution is the capability distribution authority. The 5-pool vs 4-alias asymmetry is the attenuation mechanism — `architect` capabilities are only distributed to enterprise principals via `native` resolution, never via direct alias mapping.

See SDD §10.1 for the full pattern mapping.

## References

- @see Hounfour RFC #31 §3.1 Model Catalog — pool vocabulary definition
- @see Hounfour RFC #31 §12 Agent Distribution via Arrakis — tier routing
- @see `packages/adapters/agent/pool-mapping.ts` — implementation
- @see ADR-005 Budget Unit Convention — companion decision in same system
- @see Dennis & Van Horn (1966) — "Programming Semantics for Multiprogrammed Computations"
- @see SDD §10.1 — Capability-Based Security Pattern
