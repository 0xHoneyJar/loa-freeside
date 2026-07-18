# User-flow moment contract

The user-flow moment is Freeside's stable join between product intent and implementation. It answers what progress a user is trying to make at one point in the journey, what we hypothesize will help, how the experience is exposed, and what evidence would support or falsify the hypothesis.

It is deliberately not another decision or learning ledger. Each record points to existing issues, ADRs, Learning Memos, feature flags, components, and evidence. Agents render a disposable continuity receipt from those sources:

```bash
node tools/flow-moment.mjs validate product/flow-moments
node tools/flow-moment.mjs render product/flow-moments/audit-community-composition.flow.json
```

System buildings and front-facing products consume those moments through a thinner manifest:

```bash
node tools/system-component.mjs validate product/system-components
node tools/system-component.mjs render product/system-components/loa-freeside.system.json
```

The system manifest captures the engineering operator, component object, consumer question, stable responsibility, trust surface, actions, ownership boundary, and handoff. It links to a canonical `FM-*` record when the relationship is real. An unmapped component must say why instead of inventing a user-truth relationship.

JSON Schema is the portable shape contract; it rejects structurally invalid records and exact duplicate array items. The repository CLIs are the canonical acceptance layer because identity invariants such as duplicate signal IDs and duplicate `flow_moment_id` values cannot be expressed by portable JSON Schema alone. CI and cross-repository consumers must run the appropriate CLI rather than treating schema-only validation as semantic acceptance.
Flow components make referential integrity explicit: `resolution: local` requires a `component:<component_id>` reference that resolves exactly once in `product/system-components`; `resolution: external` requires a non-component provenance reference and is not presented as locally verified.

## Three independent axes

| Axis | Answers | States |
|---|---|---|
| Hivemind learning status | Does the flow moment help the user progress? | `cant-make-a-conclusion`, `smol-evidence`, `directionally-correct`, `strongly-validated`, `hypothesis-failed` |
| Component maturity | Can an agent safely reuse this implementation pattern? | `uncaptured`, `silver`, `gold`, `retired` |
| Exposure | Who sees the experience, and why? | `dark`, `internal`, `partner`, `default-on`, `retiring`, `retired` |

A Gold component can appear inside a falsified flow. A Silver prototype can produce strong user evidence. Component promotion never changes Hivemind learning status.

## Promotion rules

- A product thesis starts as an unproven hypothesis.
- Dark research may be recorded before a flag is wired.
- Exposed research requires a feature-flag reference and an evidence contract.
- Default-on research requires a learning reference and an operator decision.
- Gold requires Silver metadata, a taste owner, 14 production days, active use, no regressions, and evidence references.
- Gold age is evaluated against the record's explicit `as_of` date. Advancing the maturity clock is therefore a reviewable record change, not an ambient CI clock; validation also refuses an `as_of` later than the validator's observed UTC date.
- CI validates claims and evidence pointers. It cannot decide whether the taste is good or the hypothesis is true.

## Evidence privacy

Product telemetry, website feedback, tickets, Discord, interviews, partner observations, and personal DMs may all orient learning. Raw private messages do not belong in the repository. Summarize them in operator voice, retain a provenance reference, and use direct quotations only when consented and redacted.

## Adding a moment

1. Copy an existing `product/flow-moments/*.flow.json` record.
2. Give the moment a stable `FM-*` identifier.
3. State the actor's entry state, desired progress, dream outcome, hypothesis, and falsification conditions.
4. Attach the canonical Hivemind classification without adding an action field.
5. Define behavioral and qualitative signals before exposure.
6. Attach exemplars with both what to adopt and what to reject.
7. Keep components `uncaptured` until their design intent is actually captured.
8. Run validation and render the receipt before requesting review.

## Cross-repository adoption

`loa-freeside` owns the schemas and validators. Consumer repositories own only:

- `product/system-components/<repo>.system.json`, containing their local responsibility and real flow links; and
- a thin workflow caller pinned to an immutable `loa-freeside` governance commit.

This makes drift reviewable without vendoring the contract into every API or product repository.
The `governance-ref` input must be a full lowercase 40-character commit SHA; branches
and tags are rejected before the governance checkout so a caller's verifier cannot move
without a reviewed caller change.
By default, the reusable workflow validates a portable system manifest: flow IDs and
`flow:<id>` references must agree, but the consumer does not need to vendor Freeside's
canonical `.flow.json` records. Set `validate-flow-moments: true` only when the consumer
owns repo-local flow records; that enables both full flow validation and exact canonical
reference resolution.

## Construct expertise on the operator surface

Constructs join the continuity surface through a region-owned territory, not through free-text tags on every system component. The three planes stay mechanically separate:

| Plane | Source | What it may claim |
|---|---|---|
| Orientation | `constructs info <slug> --json --rung local` → `orientation` | Prose that helps an operator frame the problem. Always `authoritative: false`. |
| Mechanics | The same info payload → `mechanics`, plus `constructs capabilities --json` | Declared skills, commands, runtime requirements, verb mutation class, determinism, and provenance. It grants no authority. |
| Authority | `grimoires/territory.yaml` projected through `constructs atlas --json`, then the graduated-trust ledger | The region's ceiling intersected with earned evidence. Unknown earned state collapses to `observe`. |

Mechanical gates read the atlas's structured `ratification_status`; the neighboring `ratification` sentence is operator orientation and is never parsed as state.

`loa-freeside` ratifies the first bounded territory at `grimoires/territory.yaml`. The joined operator receipt derives from the existing system component, the live Constructs producer, and that region-owned declaration:

```bash
# Deterministic smoke-render seam used by CI; partial remains visible by design
node tools/construct-operator.mjs render \
  --snapshot tools/fixtures/construct-operator.snapshot.json

# Live operator-local projection (producer path may also be set as CONSTRUCTS_CLI)
CONSTRUCTS_DIR="$HOME/.loa/constructs/packs" \
node tools/construct-operator.mjs render \
  --constructs-cli /path/to/loa-constructs/packages/constructs-cli/bin/constructs.mjs
```

Live mode invokes only `capabilities`, `atlas`, and `info --rung local`. Mutation verbs are displayed in a separate set but are never executed. Until the territory is committed on the region's default branch and the producer can prove stationing, the overall receipt stays `partial` rather than presenting a working-tree declaration as ratified expertise.
The checked-in fixture step is a smoke-render check, not a release-acceptance gate: its purpose is to prove that incomplete expertise remains inspectable. Release gates add `--require-ok` to reject `partial`; ordinary operator inspection deliberately renders partial receipts so missing or unratified state remains visible.
