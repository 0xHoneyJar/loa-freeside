# Build plan — User-flow moment continuity

| | |
|---|---|
| **Named track** | `flow-moment-continuity` (parallel; does not replace the active Shadow Audit cycle) |
| **Status** | Active — operator authorized 2026-07-14 |
| **Domain** | Shared product-governance substrate |
| **Tracking** | `arrakis-ydw0u` |

This is a compact PRD + SDD + sprint gate for a bounded parallel track. It stays outside the active Loa cycle so the build does not merge two rooms or rewrite Shadow Audit state.

## Product requirement

Product intent currently survives in issue comments, flags, ADRs, components, and operator memory, but a fresh agent cannot reliably join those surfaces. This produces two failures: an implementation remains after its job is forgotten, or a product hypothesis is presented as truth before evidence exists.

The Audit hypothesis is:

> Teams that understand how their community is composed and changing can stay closer to rapidly changing reality and make more informed decisions. Freeside surfaces the signal from fragmented social and onchain noise.

This remains a hypothesis until behavioral or qualitative evidence supports or falsifies it.

### Goals

| ID | Goal | Metric |
|---|---|---|
| **G-1** | Make the user-flow moment the stable join across issues, evidence, exemplars, components, and rollout state | One executable schema with no additional properties |
| **G-2** | Preserve the Audit hypothesis without presenting it as settled user truth | Audit exemplar starts at `cant-make-a-conclusion` and names falsification conditions |
| **G-3** | Keep component maturity separate from product-outcome confidence | Silver/Gold checks never mutate or imply Hivemind learning status |
| **G-4** | Give research flags an evidence contract | Any exposed research flow names flag, audience, owner, review trigger, and success/failure signals |
| **G-5** | Prevent false graduation claims | CI fails invalid default-on research and invalid Gold claims, with tests proving the red path |
| **G-6** | Avoid another hand-maintained ledger | The agent continuity receipt is rendered from the executable flow record |
| **G-7** | Carry intent across system buildings and front-facing products without schema forks | Each active consumer owns one validated system-component manifest pinned to the canonical workflow |

### Non-goals

- Changing the canonical Hivemind label schema.
- Adding actions or recommendations to the Hivemind label layer.
- Deciding that a hypothesis is true, taste is good, or a user should take an action.
- Replacing issues, ADRs, TDRs, Learning Memos, feature flags, or component annotations.
- Modifying the active Shadow Audit sprint or ledger.

## Architecture

```text
Hivemind truth/confidence ─┐
Issue and decision refs ───┤
Exemplars ─────────────────┤
Components + maturity ─────┼─► flow-moment record ─► continuity receipt
Research flag state ───────┤             │
Evidence contract/results ─┘             └─► CI promotion gates
```

The flow record points to existing sources and renders a disposable receipt. The local schema wraps the canonical Hivemind schema and requires all seven dimensions without extending its actionless object.

### Promotion invariants

1. A dark research hypothesis may exist before a flag is implemented.
2. Exposed research requires a flag reference.
3. Default-on research requires an operator decision and a learning reference.
4. Evidence-confidence claims require captured observations.
5. Silver requires intent, feel, inspiration, and rejected directions.
6. Gold adds a taste owner, 14 production days, active use, no regressions, and evidence references.
7. Component maturity never promotes outcome confidence.

### Failure semantics

- Invalid JSON, schema drift, or invalid promotion: exit `1` with field-level evidence.
- No records found: exit `1`; green must prove that something was validated.
- A valid unproven hypothesis: exit `0`; honest uncertainty is not a validation failure.

## Sprint slice

| Task | Goals | Acceptance criteria |
|---|---|---|
| **T-1 Contract** | G-1, G-3, G-4 | Strict schema composes Hivemind and models flow, evidence, exposure, exemplars, and maturity |
| **T-2 Audit exemplar** | G-2 | Community-composition moment is unproven and falsifiable |
| **T-3 Validator and receipt** | G-3, G-4, G-6 | CLI validates promotion invariants and renders continuity from source |
| **T-4 Red-path tests** | G-5 | Invalid Hivemind extension, exposed research without flag, unsupported default-on, and premature Gold all fail |
| **T-5 CI** | G-5 | Path-scoped workflow runs tests, validates records, and renders the exemplar |
| **T-6 Estate adoption** | G-7 | Reusable workflow validates thin component manifests across active APIs and front-facing products |

The slice is complete when targeted tests pass, the Audit record validates, at least four invalid promotions are proven red, and no active-cycle artifact changes.
