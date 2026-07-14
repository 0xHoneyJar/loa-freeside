# Implementation report — User-flow moment continuity

**Track:** `flow-moment-continuity`

**Task:** `arrakis-ydw0u`

**Date:** 2026-07-14

## Executive summary

Implemented the first executable vertical slice of the user-flow-moment continuity contract. The Audit composition-and-movement thesis is now represented as an explicitly unproven, falsifiable Hivemind experiment; a validator separates outcome evidence, exposure state, and component maturity; and path-scoped CI proves invalid promotion claims fail closed.

The implementation does not create another decision or learning ledger. `product/flow-moments/*.flow.json` is the typed join, and the operator-facing continuity receipt is generated from it.

## Tasks completed

- **T-1 Contract:** `spec/product/flow-moment.schema.json:1` composes the canonical Hivemind schema and makes `flow_moment_id` the join (`:30`).
- **T-2 Audit exemplar:** `product/flow-moments/audit-community-composition.flow.json:4` records the operator-approved hypothesis at `cant-make-a-conclusion`, with behavioral and qualitative falsification signals.
- **T-3 Validator and receipt:** `tools/flow-moment.mjs:55` enforces semantic promotion rules; `:149` renders the continuity receipt.
- **T-4 Tests:** `tools/flow-moment.test.mjs` covers valid unproven state, Hivemind's actionless boundary, flag exposure, default-on evidence, typed provenance, evidence claims, Gold maturity, date bypass, and receipt rendering.
- **T-5 CI:** `.github/workflows/flow-moment-governance.yml:35` validates every flow record after proving the red paths.
- **T-6 Estate adoption:** `spec/product/system-component.schema.json`, `tools/system-component.mjs`, and the reusable workflow let each API or product declare a local responsibility without copying the canonical flow schema.
- **Documentation:** `docs/product/flow-moment-contract.md:12` explains the three independent axes and adoption workflow.

## Technical highlights

- Uses JSON Schema 2020-12 with `additionalProperties: false` throughout.
- Wraps rather than modifies the canonical Hivemind label schema.
- Allows a dark hypothesis before flag implementation, but requires a flag reference for any exposed state.
- Requires learning and operator-decision references before research becomes default-on.
- Requires both behavioral and qualitative evidence for `strongly-validated`.
- Requires Silver intent metadata and a 14-day, evidence-backed production floor for Gold.
- Fails when no records are found, preventing a green check that validated nothing.

## Testing summary

```bash
pnpm exec oxlint tools/flow-moment.mjs tools/flow-moment.test.mjs tools/system-component.mjs tools/system-component.test.mjs
node --test tools/flow-moment.test.mjs tools/system-component.test.mjs
node tools/flow-moment.mjs validate product/flow-moments --today 2026-07-14
node tools/flow-moment.mjs render product/flow-moments/audit-community-composition.flow.json
node tools/system-component.mjs validate product/system-components
node tools/system-component.mjs render product/system-components/loa-freeside.system.json
```

Result: 16 tests passed; 1 real flow record and 1 canonical system-component manifest passed; both receipts rendered; targeted lint passed; both workflow YAML files parsed. The reusable install is isolated from a caller's pnpm workspace.

## Known limitations

- The Audit moment remains `dark`; this slice does not invent or wire a dashboard feature flag.
- External `github:`, `bead:`, and URL references are type-checked but not fetched over the network in CI.
- CI blocks invalid records and promotion claims when flow-governance files change. It does not yet require every product-code PR to declare a flow moment.
- Consumer repositories call the reusable workflow and validator checkout by immutable commit SHA so contract changes cannot arrive implicitly.
- Component `github:0xHoneyJar/freeside-dashboard#111` remains honestly `uncaptured`; this slice does not claim Silver or Gold adoption in the dashboard.
- The older standalone Hivemind shell validator is unchanged; the flow validator uses full JSON Schema validation for the nested Hivemind object.

## Reviewer verification

1. Run the six commands above.
2. Change the exemplar exposure from `dark` to `internal` without adding `flag_ref`; validation must fail.
3. Add an action field under `hivemind`; validation must fail.
4. Claim Gold with a production date fewer than 14 days old; validation must fail.
5. Render the receipt and verify that actor, hypothesis, evidence, exemplars, boundaries, exposure, and component maturity are all present.
