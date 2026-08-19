# ADR-006: Image Optimizer Stays on `d163aeqznbc6js` for `mature-freeside-operator-and-cutover` Cycle

**Date**: 2026-04-29
**Status**: Accepted
**Cycle**: `mature-freeside-operator-and-cutover` (Sprint 1, Phase 0 cutover)
**Authors**: opus-4-7-1m (via /vault dig + AWS API verification) + zksoju (operator approval)

## Context

The cycle planning assumed Phase 0 would migrate the org's "image plane" off CloudFront `d163aeqznbc6js.cloudfront.net` to a new sovereign endpoint `assets.0xhoneyjar.xyz`. This framing came from the external-services audit (`micodex-studio/grimoires/loa/proposals/external-services-audit-2026-04-29.md`) which identified d163 as "the entire org's image plane."

Pre-flight discovery 2026-04-29 (using `aws --profile admin` queries against account `891376933289`) revealed the d163 distribution is actually an **image-optimizer chain**, not a static-asset CDN:

- 2 origins:
  - `tf-next-image-optimizer` (API Gateway `mosnc349cc`) — handles default behavior
  - `thj-assets.s3.us-west-2.amazonaws.com` — handles `*.webp` cache behavior (direct bypass)
- 2 Lambdas behind the API Gateway:
  - `tf-next-image` (terraform-managed, `terraform-aws-next-js-image-optimization` module)
  - `Image-resizer` (custom-built, NOT terraform-managed; built ~mid-2024 by an early-org team member)
- Backing S3 bucket: `thj-assets` (us-west-2, private, OAC-protected)

This architecture has been **stable for ~2 years**. The operator confirmed it's load-bearing and pre-dates the freeside-* family entirely.

Full architecture map: SDD §0.4 + `~/vault/wiki/concepts/image-plane-architecture.md`.

## Decision

**The image optimizer chain (`Image-resizer` + `tf-next-image` Lambdas + their API Gateway routing) is OUT OF SCOPE for the `mature-freeside-operator-and-cutover` cycle.**

Phase 0 ships a NEW CloudFront distribution under `assets.0xhoneyjar.xyz` that:
- Points at the SAME `thj-assets` S3 bucket (no new bucket)
- Has the SAME `*.webp` cache behavior (mirrors legacy fast path)
- Default behavior is plain S3 direct (NO image optimizer chain replication)

Apps that consume direct webp paths get the new URL contract immediately. Apps that consume optimizer paths (`/images/{proxy+}` or `/_next/image*`) keep using `d163aeqznbc6js.cloudfront.net` — zero migration risk to the optimizer chain.

## Rationale

1. **Stability**: The optimizer chain has worked for 2 years under production load. Migrating it during a defensive cutover compounds risk unnecessarily.
2. **Scope discipline**: Phase 0's primary value is publishing a stable URL contract for external builders (Adeitasuna/MibeStats per SDD §0.2). That value lands without touching the optimizer.
3. **Format coverage limitation**: The optimizer is image-only (webp output via `TF_NEXTIMAGE_FORMATS=["image/webp"]`). mp4/video/audio bypass it entirely (operator-known; reflected in the `*.webp` cache behavior design). Re-hosting the optimizer requires re-architecting around this limitation; that's its own cycle.
4. **Mixed governance**: `tf-next-image` is terraform-managed; `Image-resizer` is custom + undocumented. Migrating both requires reconciling two different management models. Sprint-1 lacks the budget for that work.
5. **No urgency**: The audit's "SPOF" framing was partially correct but the actual SPOF risk is the AWS account + the S3 bucket (both shared by legacy and new distributions). Adding a new distribution provides config-isolation but doesn't reduce account-level risk; that requires multi-account work which is its own future cycle.

## Consequences

### Positive

- **Sprint-1 scope shrinks ~30%**: T12 (bulk sync) and T13 (dual-write cron) drop entirely. T11 (terraform apply) narrows to distribution + alias + ACM (no new bucket).
- **Optimizer chain risk: zero**. No code or config changes to the production optimizer.
- **Builder UX**: Adeitasuna and future external builders get the stable URL contract via `assets.0xhoneyjar.xyz/{world}/{category}/{...}` for direct-access patterns.
- **Knowledge captured**: The vault page `~/vault/wiki/concepts/image-plane-architecture.md` documents the optimizer chain for future cycles + new engineers.

### Negative

- **Apps using optimizer paths don't get the URL contract** in Sprint-1. They continue depending on `d163aeqznbc6js.cloudfront.net`. The "consolidated stable endpoint" promise is partial.
- **Custom `Image-resizer` Lambda remains undocumented**. Its source code is in S3 Lambda zip; no visible git repo. If it breaks, recovery requires reverse-engineering or rebuild. Risk persists past Sprint-1.
- **Future re-host work compounds**: when a future cycle decides to migrate the optimizer, it inherits the same complexity (mixed governance, format limitations, undocumented custom Lambda) we deferred today.

### Neutral / forward-pointing

Future cycles may decide to:

| Path | What | Tradeoff |
|---|---|---|
| **Sunset** | Apps migrate to direct webp serving; Lambdas decommissioned | Cleanest; requires per-app refactor; loses on-the-fly resize |
| **Re-host** | Replicate both Lambdas under `assets.0xhoneyjar.xyz` infrastructure; bring `Image-resizer` source under git management | Most fidelity; recovers undocumented infra as part of the work; heavy |
| **Replace** | Swap to CloudFront Functions (edge), Lambda@Edge, or Vercel Image Optimization | Modern; zero Lambda mgmt; format coverage may differ |

Each is a meaningful cycle of its own. None are Sprint-1 scope.

## Cross-references

- SDD: `~/bonfire/grimoires/loa/sdd.md` §0.1 (Amendment 2026-04-29) + §0.4 (Image Plane Architecture)
- PRD: `~/bonfire/grimoires/loa/prd.md` §4.2.B.1 (post-Amendment 2026-04-29)
- Sprint plan: `~/bonfire/grimoires/loa/sprint.md` T11 (revised), T12 (DESCOPED), T13 (DESCOPED), T11.5 (this ADR)
- Vault doctrine: `~/vault/wiki/concepts/image-plane-architecture.md`, `~/vault/wiki/concepts/url-contract-as-bridge.md`, `~/vault/wiki/concepts/contracts-as-bridges.md`
- External-services audit: `~/Documents/GitHub/micodex-studio/grimoires/loa/proposals/external-services-audit-2026-04-29.md`
- Beads: `bd-z5z` (T12 DEFERRED), `bd-a56` (T13 DEFERRED), `bd-in6` (T11 narrowed)

## Approval

- **2026-04-29**: opus-4-7-1m + zksoju (operator) — accepted post-pre-flight discovery, AskUserQuestion routing on /run halt confirmed amendment + ADR + vault filing approach.
