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
