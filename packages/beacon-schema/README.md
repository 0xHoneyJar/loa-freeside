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
