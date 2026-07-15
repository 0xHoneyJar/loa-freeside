# Implementation report — User-flow moment continuity

**Track:** `flow-moment-continuity`

**Task:** `arrakis-ydw0u`

**Date:** 2026-07-14

## Executive summary

Implemented the first executable vertical slice of the user-flow-moment continuity contract. The Audit composition-and-movement thesis is now represented as an explicitly unproven, falsifiable Hivemind experiment; a validator separates outcome evidence, exposure state, and component maturity; and path-scoped CI proves invalid promotion claims fail closed.

The implementation does not create another decision or learning ledger. `product/flow-moments/*.flow.json` is the typed user-flow join, `grimoires/territory.yaml` is the region-owned expertise declaration, and every operator receipt is derived from those sources plus producer-owned Constructs JSON.

## Tasks completed

- **T-1 Contract:** `spec/product/flow-moment.schema.json:1` composes the canonical Hivemind schema and makes `flow_moment_id` the join (`:30`).
- **T-2 Audit exemplar:** `product/flow-moments/audit-community-composition.flow.json:4` records the operator-approved hypothesis at `cant-make-a-conclusion`, with behavioral and qualitative falsification signals.
- **T-3 Validator and receipt:** `tools/flow-moment.mjs:55` enforces semantic promotion rules; `:149` renders the continuity receipt.
- **T-4 Tests:** `tools/flow-moment.test.mjs` covers valid unproven state, Hivemind's actionless boundary, flag exposure, default-on evidence, typed provenance, evidence claims, Gold maturity, date bypass, and receipt rendering.
- **T-5 CI:** `.github/workflows/flow-moment-governance.yml:35` validates every flow record after proving the red paths.
- **T-6 Estate adoption:** `spec/product/system-component.schema.json`, `tools/system-component.mjs`, and the reusable workflow let each API or product declare a local responsibility without copying the canonical flow schema.
- **T-7 Constructs info contract:** `loa-constructs#276` adds `info_schema_version: 1.0`, separates non-authoritative `orientation` from declared `mechanics`, exposes per-skill capability metadata, and supports pinned local provenance.
- **T-8 Freeside territory ratification:** `grimoires/territory.yaml` declares three product-governance outcomes and stations The Arcade + Beacon at an observe-only ceiling over an explicit file blast radius.
- **T-9 Operator expertise projection:** `tools/construct-operator.mjs` joins the system-component record, territory atlas, construct info, and CLI capabilities into deterministic JSON or Markdown.
- **T-10 Deterministic seams and CI:** `tools/construct-operator.test.mjs` and its checked-in producer snapshot prove prose/authority separation, mechanical unavailability, structured ratification, fail-closed authority, read/write verb separation, and byte-stable rendering.
- **Documentation:** `docs/product/flow-moment-contract.md:12` explains the three independent axes and adoption workflow.

## Technical highlights

- Uses JSON Schema 2020-12 with `additionalProperties: false` throughout.
- Wraps rather than modifies the canonical Hivemind label schema.
- Allows a dark hypothesis before flag implementation, but requires a flag reference for any exposed state.
- Requires learning and operator-decision references before research becomes default-on.
- Requires both behavioral and qualitative evidence for `strongly-validated`.
- Requires Silver intent metadata and a 14-day, evidence-backed production floor for Gold.
- Fails when no records are found, preventing a green check that validated nothing.
- Refuses a construct whose prose claims authority or whose mechanics claim an authority effect.
- Treats missing construct details and unchecked territory ratification as `partial`, not success.
- Reads detailed expertise from the producer's pinned local rung; Freeside does not maintain a parallel construct catalog or territory schema.
- Separates Constructs mutation verbs structurally and never invokes them from the operator receipt.

## Testing summary

```bash
pnpm exec oxlint tools/flow-moment.mjs tools/flow-moment.test.mjs tools/system-component.mjs tools/system-component.test.mjs tools/construct-operator.mjs tools/construct-operator.test.mjs
node --test tools/flow-moment.test.mjs tools/system-component.test.mjs tools/construct-operator.test.mjs
node tools/flow-moment.mjs validate product/flow-moments --today 2026-07-14
node tools/flow-moment.mjs render product/flow-moments/audit-community-composition.flow.json
node tools/system-component.mjs validate product/system-components
node tools/system-component.mjs render product/system-components/loa-freeside.system.json
node tools/construct-operator.mjs render --snapshot tools/fixtures/construct-operator.snapshot.json
```

Result: 38 tests passed; 1 real flow record and 1 canonical system-component manifest passed; all three receipts rendered; the live producer validated the Freeside territory and returned both stationings as expected dry-runs pending default-branch ratification. Targeted lint and workflow parsing pass. Portable consumer validation no longer requires canonical flow records unless `validate-flow-moments: true`, and the reusable install remains isolated from a caller's pnpm workspace.

## Known limitations

- The Audit moment remains `dark`; this slice does not invent or wire a dashboard feature flag.
- External `github:`, `bead:`, and URL references are type-checked but not fetched over the network in CI.
- CI blocks invalid records and promotion claims when flow-governance files change. It does not yet require every product-code PR to declare a flow moment.
- Consumer repositories call the reusable workflow and validator checkout by immutable commit SHA so contract changes cannot arrive implicitly.
- Component `github:0xHoneyJar/freeside-dashboard#111` remains honestly `uncaptured`; this slice does not claim Silver or Gold adoption in the dashboard.
- The older standalone Hivemind shell validator is unchanged; the flow validator uses full JSON Schema validation for the nested Hivemind object.
- The live operator projection depends on the `loa-constructs#276` info-contract change. CI uses a deterministic snapshot until that producer contract is merged and can be pinned by release.
- The territory is deliberately unratified on this feature branch. Producer dry-runs report the untracked/non-default-branch blockers; no station receipt is written before merge.
- The CLI receipt is the first operator projection. The deployed Hono operator dashboard can consume this JSON later, but this slice does not introduce a cross-repository runtime dependency into that service.

## Reviewer verification

1. Run the seven commands above.
2. Change the exemplar exposure from `dark` to `internal` without adding `flag_ref`; validation must fail.
3. Add an action field under `hivemind`; validation must fail.
4. Claim Gold with a production date fewer than 14 days old; validation must fail.
5. Render the receipt and verify that actor, hypothesis, evidence, exemplars, boundaries, exposure, and component maturity are all present.
6. Set `orientation.authoritative` to `true` in the construct snapshot; the operator test must fail closed.
7. Run the live projection against the producer CLI and verify that orientation, declared mechanics, pinned provenance, and observe-only effective authority render as separate fields.
