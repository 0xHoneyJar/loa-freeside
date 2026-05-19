# @0xhoneyjar/beacon-schema

Sealed Effect Schema for the Freeside MCP federation **beacon contract**. Workspace package inside `freeside-mcp-gateway/packages/beacon-schema/`.

> Cycle C v0.3 broadcast layer · base shape (`schema_version: "2"`).
> Cycle D extends the `docs.*` block additively (no breaking change · v0.2.0 bump).

## Disambiguation

Two names look similar — they are not the same thing.

| Name | What | Where | Audience |
|---|---|---|---|
| **`construct-beacon`** | Construct in the constructs-network registry · ships SKILLS for AI-content-readability + MCP-codegen authoring (`auditing-content`, `defining-mcp-tools`, `generating-markdown`, `accepting-payments`) | constructs.network | Authors writing a `beacon.yaml` for their MCP construct |
| **`@0xhoneyjar/beacon-schema`** | npm package · sealed Effect Schema for `BeaconV2Schema` runtime validation + JSON Schema export + `build-beacon-json` CLI | npm registry · gateway monorepo | Gateway implementation + construct build steps + future external integrators |

Read it as: **`construct-beacon` HELPS YOU AUTHOR a beacon.yaml; `@0xhoneyjar/beacon-schema` VALIDATES that your beacon.yaml conforms to the federation contract.**

## Install

```bash
pnpm add -D @0xhoneyjar/beacon-schema
# requires effect ^3.10.0 as peerDep
```

## Use · validate a beacon at runtime

```typescript
import { BeaconV2Schema, decodeBeacon } from "@0xhoneyjar/beacon-schema";
import { Effect } from "effect";

const result = await Effect.runPromise(
  decodeBeacon(JSON.parse(rawBeaconJson))
);
// result is a typed BeaconV2 · throws on invalid input
```

## Use · YAML→JSON adapter (build step)

```bash
npx build-beacon-json --in beacon.yaml --out app/.well-known/beacon.json
```

Wired into each construct's `package.json`:

```json
{
  "scripts": {
    "build:beacon": "build-beacon-json --in beacon.yaml --out app/.well-known/beacon.json"
  }
}
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | Validation passed · JSON written |
| `1` | Validation failed · ParseError on stderr |
| `2` | Usage error (missing `--in` / `--out`) |

## Use · JSON Schema export

```typescript
import { BeaconV2JsonSchema } from "@0xhoneyjar/beacon-schema";
// canonical JSON Schema · publish at /.well-known/beacon-schema/v2.json
```

## Schema shape (v2)

```yaml
# beacon.yaml v2 · minimal
schema_version: "2"
mcp:
  shape: data | tool | proxy
  paths: [stdio, remote-http]
  remote: { transport: streamable-http, endpoint: ... }    # required if paths includes remote-http
  auth: { kind: none | api-key, header?, credentials_ref? }
  capabilities: [tools, resources, prompts, sampling, logging]
  tools: [...]
  pricing: { model: free | per-call | subscription | pay-per-call, description }
  publisher: <org>
```

### Auth refine rules

| `auth.kind` | `header` | `credentials_ref` |
|---|---|---|
| `none` | MUST be omitted | MUST be omitted |
| `api-key` | REQUIRED | REQUIRED |
| `jwt`, `oauth` | reserved · v0.3 schema accepts but gateway throws `CredentialResolverNotImplemented` at boot |

### `credentials_ref.key` convention

SCREAMING_SNAKE_CASE only (Railway env-var pattern · max 128 chars).

### `docs:` block

Cycle C ships `docs: Schema.optional(Schema.Unknown)` — accepts any docs payload during the transition. Cycle D files an additive PR replacing `Schema.Unknown` with a concrete `DocsBlockSchema` (tagline + example_invocations + assets + changelog_url). See [Cycle D coordination contract](../../grimoires/bonfire/specs/freeside-mcp-federation-docs-dx-sdd-2026-05-03.md).

## Develop

```bash
pnpm install        # from repo root · workspace setup
pnpm typecheck      # tsc --noEmit
pnpm build          # tsc -b → dist/
pnpm test           # tsx --test tests/*.test.ts (14 tests)
```

## Versioning

| Version | Cycle | Change |
|---|---|---|
| `0.1.0` | Cycle C v0.3 (this) | Base BeaconV2Schema · mcp + cli + payment + auth + credentials_ref · docs:Schema.Unknown placeholder |
| `0.2.0` | Cycle D (planned · additive PR) | Replaces `docs: Schema.Unknown` with `DocsBlockSchema` (tagline + example_invocations + assets + changelog_url) |
| `1.0.0` | After v0.3 stable | Promote to 1.0 once schema is exercised by 3+ tenants in production |

## License

MIT
# packages/beacon-schema/

**Package**: `@freeside/beacon-schema` · **Domain**: network · **Status**: scaffold (V3 lands in step 6)

Sealed schema package for the BeaconV3 contract — the boundary-declaration discipline every `freeside-*` module MUST conform to.

## What V3 adds (vs current V2)

Per [ADR-007 §D-4 + Appendix A](../../decisions/007-loa-freeside-absorption.md), four new required fields:

| Field | Purpose |
|-------|---------|
| `is` | Definitive scope (one_liner + scope bullets) |
| `is_not` | Explicit anti-scope (the discipline-forcing field; min 2 entries; each MUST start with "Does NOT" / "Will NOT" / "Refuses to") |
| `composes_with` | Sibling module references using fully-qualified Honeycomb Tag references (`TagName@version+schema_hash`) — type-checkable composition |
| `acvp_invariants` | Verifiability discipline per ACVP doctrine |

Plus `sealed_schemas` (hash-verified schema references) and `cycle_state` (honest maturity signal: candidate/active/mature/sunset/legacy).

## Planned shape

```
packages/beacon-schema/
├── schema/
│   └── beacon-v3.json           # canonical JSON Schema (the machine-enforceable artifact)
├── src/
│   ├── validate.ts              # validator using Ajv2020
│   ├── tag-resolver.ts          # Honeycomb Tag@version+hash resolution
│   └── types.ts                 # TS types derived from schema
├── tests/
│   ├── valid-beacons/           # fixtures that MUST pass
│   └── invalid-beacons/         # fixtures that MUST fail (with expected error messages)
├── package.json
└── README.md
```

## What lives here

Currently: this README. Full BeaconV3 schema package ships in [ADR-007 §Implementation step 6](../../decisions/007-loa-freeside-absorption.md). The schema spec is documented in [ADR-007 Appendix A](../../decisions/007-loa-freeside-absorption.md); the JSON Schema file is the binding artifact (spec ↔ schema correspondence enforced by CI).

## Honeycomb Tag lock (the load-bearing claim)

Type-checkable composition between modules works because:

1. `construct-honeycomb-substrate` ships canonical Tags at `lib/ports/<TagName>.ts`
2. Modules declare what Tag interfaces they SPEAK in `composes_with.<sibling>.tag`
3. Tag references use full qualification: `TagName@version+schema_hash`
4. `loa freeside doctor` validates by fetching the referenced module's beacon, confirming it declares that Tag, AND recomputing the schema_hash from the current Honeycomb Tag definition. Mismatches signal upstream evolution requiring migration.

Eliminates the false-positive composition risk flagged by flatline SKP-004 (name-equality insufficient).

## V2 → V3 migration window

Per ADR-007 §D-4 + Appendix A.4:

- V3 is REQUIRED for new modules
- Existing V2 broadcasters (`score-mibera`, `construct-mibera-codex`) migrate in their NEXT regular cycle (not forced sweep)
- V3 validator accepts V2 broadcasts as `cycle_state.status: legacy` during migration window
- `loa freeside doctor` warns on legacy beacons with `next_review` date
- Once migrated to V3, downgrade is forbidden (status field one-way)

## Source

`freeside-mcp-gateway/packages/beacon-schema/` (V2) gets git-mv'd here in [ADR-007 §Implementation step 4](../../decisions/007-loa-freeside-absorption.md), then V3 schema lands in step 6.

## Domain boundary

Network path. CI enforced.

## Related

- [ADR-007](../../decisions/007-loa-freeside-absorption.md) — dual-concern absorption
- [ADR-007 Appendix A](../../decisions/007-loa-freeside-absorption.md) — full normative schema
- `construct-honeycomb-substrate` — Tag source
- `packages/freeside-registry/` — consumer (validates registered beacons)
- `apps/mcp-gateway/` — consumer (validates aggregated beacons)
