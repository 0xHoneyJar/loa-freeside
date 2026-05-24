# Freeside ecosystem — baseline + gaps

> The `@0xhoneyjar` packages / typed-specs audit (2026-05-23). Where we are, the baseline every building should hit, the gaps, and the path. Companion to `FREESIDE.md` (what exists) + `MENTAL-MODELS.md` (how to think). When this and the code disagree, the code wins — re-run the audit.

## The baseline standard — "the inventory-api shape"

A building is **at baseline** when all five hold. `inventory-api` is the only one that does today; it's the reference.

| # | Criterion | Why |
|---|---|---|
| 1 | **`@0xhoneyjar/<name>`** package scope | the org's publishable npm org — the only scope that can ship |
| 2 | **Typed SDK exports** (`main` + `types` + `exports`) | the *consume hot-path* — agents/builders `import` a typed surface (code-mode), per the two-organ model. No typed export = not consumable. |
| 3 | **`.well-known/beacon.json`** (BeaconV3, `schema_version "3"`) | the discovery/awareness surface; declares is/is_not/capabilities |
| 4 | **Registry entry** (`*-api` slug, matching) | the catalog lists it |
| 5 | **Gateway/registry resolves it** (no dep drift) | it's actually reachable/linkable |

## The gap matrix (2026-05-23, root-level)

| Building | (1) scope | (2) typed SDK | (3) BeaconV3 | (4) registry | Baseline |
|---|---|---|---|---|---|
| **inventory-api** | ✅ `@0xhoneyjar/inventory` | ✅ | ✅ | ✅ | ✅ **GOLD** |
| sonar-api | ❌ `envio-indexer` | ❌ | ✅ | ✅ slug | ❌ |
| storage-api | ❌ `freeside-storage` (unscoped) | ❌ | ✅ | ✅ | ❌ |
| mint-api | ❌ `freeside-mint` (unscoped) | ❌ | ✅ | ✅ | ❌ |
| activities-api | ❌ `freeside-activities` (unscoped) | ❌ | ✅ | ✅ | ❌ |
| mediums-api | ◑ root unscoped, but **publishes `@0xhoneyjar/medium-registry`** (sub-pkg) | ◑ (sub-pkg) | ✅ | ✅ | ◑ partial |
| score-api | ? (runtime repo, score-mibera) | ? | ✅ | ✅ | ? needs check |
| **beacon-schema** (network) | ❌ `@freeside/beacon-schema` | ✅ (is the schema) | n/a | n/a | ❌ + **gateway drift** |
| **freeside-registry** (network) | ❌ `@freeside/freeside-registry` | ✅ | n/a | n/a | ❌ |
| **freeside-cli** (network) | ❌ `@freeside/freeside-cli` | ✅ | n/a | n/a | ❌ |

> Caveat: this is a root-`package.json` scan. Buildings that publish from a sub-package (mediums → `@0xhoneyjar/medium-registry`) are undercounted. A precise per-sub-package audit is exactly what `doctor` should do (see Recommendation).

## Gap 1 — four naming conventions coexist (the headline)

`@0xhoneyjar/*` · `@freeside/*` · unscoped `freeside-*` · `envio-indexer`. **The published org scope is `@0xhoneyjar`** (medium-registry, validator-widget, loa-hounfour, the gateway's expected beacon-schema dep all use it). Everything else is drift from the `@arrakis → @freeside` rename (ADR-007) that diverged from publishability. **Converge everything on `@0xhoneyjar/*`.** Repo/product names stay `*-api`; only the npm scope changes.

## Gap 2 — typed specs are missing (the functional one)

Only `inventory-api` (+ mediums' `medium-registry` sub-pkg) exports a **typed SDK at all**. For sonar/storage/mint/activities the beacon *declares* capabilities, but there's no `import { … } from '@0xhoneyjar/sonar'` to deliver them. **The consume hot-path (typed code-mode, the whole point of the two-organ model) doesn't exist for ~5 of 7 buildings.** A beacon without a typed SDK behind it is a menu with no kitchen.

## Gap 3 — the gateway drift

`apps/mcp-gateway` depends on `@0xhoneyjar/beacon-schema` (`workspace:*`) but the source package is `@freeside/beacon-schema` → the dep doesn't resolve. The scope migration fixes this as a side effect.

## The path to baseline (sequence)

1. **Scope migration** → all `@0xhoneyjar/*` (task #9). Highest leverage; resolves the gateway drift. Start with the loa-freeside network packages (beacon-schema/registry/cli) since the gateway already expects them.
2. **Typed SDK exports per building** — each building exports its substrate (`main` + `types` + `exports`). This is the real consume unlock. `inventory-api` is the template (`index.ts` → typed re-exports → `dist`). sonar is the outlier — `envio-indexer` is an app, not a library; it needs a thin typed client package (`@0xhoneyjar/sonar`) over its GraphQL.
3. **Make `doctor` the baseline gate** — extend the `doctor` made real this session to check all five criteria (scope, typed exports, beacon, registry-match, resolves) per building. Then the baseline is **machine-enforced**, not a one-time manual audit — the awareness surface polices itself.

## Recommendation — `doctor` as the self-policing baseline

The single highest-leverage move: teach `loa freeside doctor` the five baseline criteria. It already fetches beacons + reconciles `rename`; add scope-check + typed-export-check + registry-slug-match. Then this gap report becomes a `doctor` run, drift gets caught in CI, and "stronger baseline" stops being a snapshot and becomes a ratchet. This is the awareness surface (discovery) verifying the substrate (consumption) — ACVP applied to the ecosystem's own health.
