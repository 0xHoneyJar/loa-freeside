# Tests

The suite lives at `../templates/_doctrine/tests.js` beside the engine it exercises, because the
two are one unit and reference each other by relative path. This file documents how to run it and
what each class actually asserts.

## Run

```bash
npm test          # → node templates/_doctrine/run-checks.js
npm run check     # alias
```

No install needed — the suite has no dependencies. Node 22+.

Expected on a clean checkout:

```
37 checks · 276 cases · 6 packs
VERDICT PASS · 0 failures · 0 suppressions · 0 advisories
```

The runner exits non-zero on any failure **or any guard suppression**. A suppression means
`guard()` dropped a line rather than rendering it — that is a defect, not a warning, because it
means a projection was attempted that policy forbade.

## The six classes

| Class | Name | What it does |
|---|---|---|
| **A** | Structural validity | Duplicate declarations, unknown selector IDs, missing policy axes, missing required-field fallbacks, secret-on-required, actions ungated. `A4` restricts context-integer fills to Service and above. `A7` is the action-axes invariant. |
| **B** | Fragment policy | Every fragment × every context, forced through `dispose()` **with no selector involved**. This is the check the earlier inline-construction design could not make bite: because policy is declared before any context exists, the test can assert it directly rather than inferring it from a branch. |
| **C** | Selector behaviour | Known contexts choose the expected IDs. |
| **D** | Reachability | Every production fragment is selected somewhere; canaries never are. Catches a fragment you declared and then orphaned. |
| **E** | Deliberate failure | A canary projected below its floor really does fall back, records the reason, and fails a verdict. Proves the guard is load-bearing rather than decorative. |
| **N** | Non-visual leakage | ARIA, `title`, `data-*`, form values, geometry, ordering and metadata read off the **view model**, never trusted in markup. Every representation channel is a disclosure channel. |

## What a green verdict does and does not mean

**Does:** no fragment renders above its permitted precision in any of the 276 contexts; every
required field has a coherent fallback; no action's availability depends on exposure alone; no
channel on the screen carries more precision than the level permits.

**Does not:** say anything about what the server sent. Every check asserts **presentation only**.
Unauthorized rows, cells, counts, pagination metadata and exports must be filtered or authorized
**server-side, before the payload reaches the client**. DOM omission and CSS hiding are not access
control — the data is still in the response.

## Extending the matrix

Use the fixture helpers. Never hand-build a case list:

```js
F.withCapability(cases, 'export')     // a capability grant must NOT change rows or columns
F.withCeilingGrant(cases, 2)          // a ceiling grant travels on ceilingGrant and legitimately MAY
```

That separation is what makes the rule testable: if both grants arrived by the same route, "a
capability grant must not add a row" would be unprovable.

## Adding a template

Two edits that must stay in agreement:

1. One `require` in `../templates/_doctrine/run-checks.js`
2. One `<script>` in `../cards/doctrine-conformance.card.html`

The Conformance card renders `audit()`; it does not define cases or rules. Tests are the source,
the card is a renderer.
