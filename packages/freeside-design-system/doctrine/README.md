# Doctrine

The engine is **not** in this directory. It lives at `../templates/_doctrine/`, because every
template loads it by the relative path `../_doctrine/doctrine.js` and the tests, fixtures and
runner reference each other the same way. Moving the files here to satisfy a directory diagram
would break all six templates and the conformance card. This file is the map instead.

| File | What it owns |
|---|---|
| [`../templates/_doctrine/doctrine.js`](../templates/_doctrine/doctrine.js) | The engine. Exposure resolution, the fragment catalogue contract, disclosure and existence policy, capability and role rules, the reason→disposition collapse, action projection, destination exposure, the pack registry, `audit()`, and the advisory lexical lint. |
| [`../templates/_doctrine/fixtures.js`](../templates/_doctrine/fixtures.js) | The case matrix — the single source of contexts, shared by CI and the Conformance card. Extend with `F.withCapability` / `F.withCeilingGrant`; never hand-build a case list. |
| [`../templates/_doctrine/tests.js`](../templates/_doctrine/tests.js) | The assertions. Six classes — see `../tests/README.md`. |
| [`../templates/_doctrine/run-checks.js`](../templates/_doctrine/run-checks.js) | CI entry point. `node templates/_doctrine/run-checks.js`. Exits non-zero on any failure **or any guard suppression**. |

## The one formula

```
exposure = min(accessCeiling, max(depthBaseline, stateFloor))
```

- **depthBaseline** — arrival 0 · account 1 · console 2 · settlement 3
- **stateFloor** — nominal 0 · degraded 2 · alert 2 (an incident owes a more specific account)
- **accessCeiling** — guest 0 · member 1 · operator 2 · principal 3 — a **hard cap**

A state floor raises exposure toward the ceiling and never through it. When the floor wants more
than the ceiling allows, the result is a **clamp**: acknowledge without describing, and let the
resource's existence policy govern the acknowledgment itself.

## The public surface packs may use

```js
D.registerPack({ id, catalogue, select, view, fills, cases })
D.registerChecks(id, checks)      // pack-specific assertions
D.dispose(fragment, ctx, opts)    // → { disposition: 'render'|'fallback'|'omit', value, degraded }
D.resolve(input)                  // → ctx { exposure, ceiling, depth, floor, level, machine, … }
D.project(packId, ctx)            // → the view model a template renders
D.can(role, capability, grants)
D.destinationExposure(ctx, dest)  // an action's destination resolves its OWN exposure
D.NONE                            // an explicit "select nothing" outcome
D.audit()                         // → the full conformance report
```

`decide()` is **internal**. It keeps the exact denial reason for the audit; packs call `dispose()`
and receive only a disposition. For a resource whose existence may not be acknowledged, missing
capability, insufficient exposure and true absence all collapse to `omit` — the collapse is the
default inside one function, not a branch a pack opts into.

## Adding a pack

1. Write `templates/<slug>/copy.js` calling `D.registerPack({...})`.
2. Declare every fragment once in `catalogue`, at module scope, with its policy axes. Policy
   cannot see `ctx`.
3. `select(ctx)` returns declared **IDs** or `D.NONE`. It never constructs a fragment.
4. Add one `require` in `templates/_doctrine/run-checks.js` **and** one `<script>` in
   `cards/doctrine-conformance.card.html`. They must stay in agreement.
5. `npm test`. Class D will tell you if a fragment you declared is never reachable.
