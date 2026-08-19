# Asset URL Contract — `assets.0xhoneyjar.xyz`

> **Audience**: external community builders (Adeitasuna's MibeStats, future
> consumers) and internal cycles (Mibera-2/3/4/rekey, future world migrations).

This doc declares the canonical URL contract for the sovereign asset surface
at `https://assets.0xhoneyjar.xyz/`. It is paired with a machine-readable
JSON Schema and a TypeScript interface — fetch either to programmatically
consume the contract.

| Artifact | Path | Purpose |
|---|---|---|
| **TS interface** | `freeside-storage/packages/protocol/src/url-contract.ts` | Canonical typed contract |
| **JSON Schema** | `freeside-storage/packages/protocol/url-contract.schema.json` | ajv-runtime validation |
| **This doc** | `loa-freeside/docs/asset-url-contract.md` | Human surface |

The schema is the durable artifact. Future versioning works by incrementing
the schema (semver) and republishing this doc to match. Builders should
prefer the schema for programmatic consumption and treat this doc as the
narrative companion.

---

## 1. Canonical template

```
https://assets.0xhoneyjar.xyz/{world}/{category}/{...}
```

| Token | Meaning |
|---|---|
| `{world}` | Top-level world slug. v1 enum: `Mibera`, `Purupuru`, `sprawl`. Matches the top-level S3 prefix on `thj-assets`. |
| `{category}` | World-specific sub-prefix. See per-world tables below for allowed values. |
| `{...}` | Tail path within the category — typically `{tokenId}.png`, `{hash}.png`, or category-specific naming. |

JSON Schema `$id`: `https://github.com/0xHoneyJar/freeside-storage/blob/main/packages/protocol/url-contract.schema.json`

Validate with ajv:

```typescript
import Ajv from 'ajv';
import schema from '@freeside-storage/protocol/url-contract.schema.json' with { type: 'json' };

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);
if (!validate(currentContract)) console.error(validate.errors);
```

---

## 2. Mibera (worked example)

The most-consumed world. v1 routes:

| Canonical route | Backing TODAY (post-sprint-1) | Backing AFTER named cycle | Phase |
|---|---|---|---|
| `/Mibera/generated/{tokenId}.webp` | S3 `thj-assets` (direct via `assets.0xhoneyjar.xyz`) | (unchanged) | — |
| `/Mibera/final/{tokenId}.png` | S3 `thj-assets` at legacy `reveal_phase8/images/{hash}.png` (Irys still serves the same hash but bytes may differ) | S3 `thj-assets` at canonical tokenId-keyed route | **mibera-2** _(optional polish)_ |
| `/Mibera/reveal/phase{N}/{hash}.png` | CloudFront `d163aeqznbc6js/images/...` (legacy URL preserved during sprint-1) | Same key shape, eventually re-keyed canonical | **mibera-rekey** |
| `/Mibera/parcels/{id}.png` | `thj-assets.s3…/parcels/parcelsImages/{id}.png` (S3-direct, not via this CDN today) | S3 `thj-assets` at canonical route | **mibera-3** |
| `/Mibera/miladies/{id}.png` | `thj-assets.s3…/fractures/miladies/images/{id}.png` (S3-direct) | S3 `thj-assets` at canonical route | **mibera-3** |
| `/Mibera/reveal/phase1.1/{hash}.png` | IPFS `bafy…ipfs.dweb.link/{hash}.png` | S3 `thj-assets` at canonical route | **mibera-4** |
| `/Mibera/og/{id}.png` | Mixed (Irys + Cloudinary) | (TBD; future cycle) | future |
| `/Mibera/traits/{...}` | CloudFront `d163aeqznbc6js` (dimensions trait map) | (unchanged path; backing may rotate) | — |

Allowed Mibera categories (v1): `final`, `reveal`, `parcels`, `miladies`,
`traits`, `og`, `generated`, `expressions`, `layers`, `archetypes`.

> 🪞 **Mibera primary renders — important correction (2026-04-29)**: the original framing
> of this cycle assumed the 10k Mibera-primary PNGs only lived on Irys (and would need a
> future Mibera-2 cycle to re-host). That was wrong. The same hash-keyed PNGs already
> live on `thj-assets` at `reveal_phase{1..8}/images/{hash}.png` (8 phases of reveal
> renderings; phase 8 is the canonical/latest per Gumi 2026-04-29). Codex consumers
> wanting to flip from `gateway.irys.xyz/...` to the new CDN can do so today via:
>
> ```
> gateway.irys.xyz/7rpvw…/{hash}.png
>   → assets.0xhoneyjar.xyz/reveal_phase8/images/{hash}.png
> ```
>
> The `mibera-2` cycle is now **optional polish** that rekeys the legacy depth-2
> hash-keyed shape to canonical depth-3 tokenId-keyed shape. The codex flip is not
> blocked on it. See [`construct-mibera-codex` issue #54](https://github.com/0xHoneyJar/construct-mibera-codex/issues/54).

---

## 3. Purupuru

Path shapes preserved from current CloudFront mirror. Sprint-1 rotates origin
to `assets.0xhoneyjar.xyz`; key paths unchanged.

| Canonical route | Backing TODAY |
|---|---|
| `/Purupuru/cards/{cardId}.webp` | S3 `thj-assets` (via new alias) |
| `/Purupuru/layers/{layerId}.webp` | S3 `thj-assets` (via new alias) |
| `/Purupuru/archetypes/{id}` | S3 `thj-assets` (via new alias) |
| `/Purupuru/sound/{...}` | S3 `thj-assets` (sound assets — when published) |

Allowed Purupuru categories (v1): `cards`, `layers`, `archetypes`, `sound`.

---

## 4. Sprawl (rektdrop, cubquests)

Path shapes preserved; sub-app discriminator is the second segment.

| Canonical route | Backing TODAY |
|---|---|
| `/sprawl/rektdrop/{...}` | S3 `thj-assets` (via new alias) |
| `/sprawl/cubquests/{...}` | S3 `thj-assets` (via new alias) |

Allowed sprawl categories (v1): `rektdrop`, `cubquests`.

---

## 5. Future-cycle phase roster

The contract declares migration phase IDs that future cycles consume. Each
phase ID matches the `MigrationPhaseId` enum in the TS interface; consumers
can codegen against the enum.

| Phase ID | Cycle | Scope | Status |
|---|---|---|---|
| `sprint-1` | `mature-freeside-operator-and-cutover` | Establish parallel CloudFront against `thj-assets`; preserve `*.webp` fast path; preserve legacy URL shapes; publish this contract | **shipping now** |
| `mibera-2` | `mibera-2` (TBD) | Re-host Mibera finals from Irys to S3 `thj-assets` at `/Mibera/final/{tokenId}.png` | future |
| `mibera-3` | `mibera-3` (TBD) | Re-host parcels + miladies from S3-direct to S3 `thj-assets` at canonical routes | future |
| `mibera-4` | `mibera-4` (TBD) | Re-host IPFS-pinned reveal phase 1.1 from dweb gateway to S3 `thj-assets` | future |
| `mibera-rekey` | `mibera-rekey` (TBD; after mibera-2/3/4) | Single rekey pass: `/images/reveal_phase{N}/...` → `/Mibera/reveal/phase{N}/...`; redirects for grace window; deprecate legacy on published timeline | future |

Future cycles consume this contract by reading the JSON Schema's
`migrationPhases` array. They MAY add new phase IDs by extending the enum
(additive minor — does NOT require a major version bump).

---

## 6. Forward-compat for IPFS permanence

`assets.0xhoneyjar.xyz` is the public endpoint. The backing layer can swap
transparently across cycles:

```
S3 (today, sprint-1)
  → S3 + IPFS gateway origin (CloudFront origin failover)
  → self-hosted IPFS gateway with S3 fallback
  → IPFS pinning service primary, S3 archive
```

The URL contract is invariant across these transitions. CloudFront supports
multiple origins with failover (Pinata's CloudFront + IPFS origin pattern is
canonical). Future cycles may adopt this without changing
`assets.0xhoneyjar.xyz/...` consumer URLs.

---

## 7. Versioning + governance

- **Policy**: semver.
- **v1**: locked at `1.0.0` (this cycle).
- **Additive minors**: extending category enums, adding canonical routes,
  adding migration phase IDs. Backwards-compatible.
- **Breaking changes**: changing `host`, `template`, removing routes, removing
  worlds. Requires:
  1. Major version bump (e.g. `1.0.0` → `2.0.0`).
  2. **90-day deprecation window** during which v1 and v2 coexist.
  3. Public announcement to community builders (this doc + Discord + relevant
     world repos).
- **Schema is canonical**: when this doc and the JSON Schema disagree, the
  schema wins. File a PR against the schema first; this doc updates to match.

---

## 8. How to consume the schema

### Via TypeScript

```typescript
import {
  URL_CONTRACT_V1,
  isCanonicalPath,
  type URLContract,
  type WorldSlug,
  type MigrationPhaseId,
} from '@freeside-storage/protocol';

const ok = isCanonicalPath(URL_CONTRACT_V1, '/Mibera/generated/0.webp');
// → true

// Discover routes for a world
const mibera = URL_CONTRACT_V1.worlds.find((w) => w.slug === 'Mibera');
console.log(mibera.routes.length); // → 6+
```

### Via JSON Schema (codegen, runtime validation)

```bash
# Codegen client types
npx quicktype \
  --src https://raw.githubusercontent.com/0xHoneyJar/freeside-storage/main/packages/protocol/url-contract.schema.json \
  --src-lang schema \
  --lang typescript \
  --out url-contract.gen.ts

# Or runtime ajv validation
npm install ajv
```

```typescript
import Ajv from 'ajv';
import schema from './url-contract.schema.json' with { type: 'json' };

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

if (!validate(currentContract)) {
  console.error('contract mismatch:', validate.errors);
}
```

### Via the JSON Schema `$id` (any language with ajv-equivalent)

```
https://github.com/0xHoneyJar/freeside-storage/blob/main/packages/protocol/url-contract.schema.json
```

Pin the schema by version (semver tag) for reproducibility:

```
https://github.com/0xHoneyJar/freeside-storage/blob/v1.0.0/packages/protocol/url-contract.schema.json
```

---

## 9. Sources of truth

- **Schema** (canonical): `freeside-storage/packages/protocol/url-contract.schema.json`
- **TS interface**: `freeside-storage/packages/protocol/src/url-contract.ts`
- **Default v1 instance**: `URL_CONTRACT_V1` (exported from the TS module)
- **SDD provenance**: `bonfire/grimoires/loa/sdd.md` §0.2 (per-world contract amendment) + §0.3 (contracts-as-bridges instance-N reframe)
- **PRD provenance**: `bonfire/grimoires/loa/prd.md` (post-§4.2.B amendments)
- **Doctrine page**: `~/vault/wiki/concepts/url-contract-as-bridge.md` (instance-4 of contracts-as-bridges)
- **Cycle**: `mature-freeside-operator-and-cutover` (Sprint 1)

For schema PRs, route through `freeside-storage`'s repo. For doc updates,
this file is the home; cross-link from the schema's `$comment` fields when
adding new sections.
