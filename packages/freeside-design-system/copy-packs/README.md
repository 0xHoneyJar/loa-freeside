# Copy packs

Each pack ships **beside its template**, not in this directory. A template loads its pack with
`<script src="./copy.js">`; hoisting the packs here would break that relative load and split each
template across two places. This file is the index.

| Pack id | File | Template | Fragments |
|---|---|---|---|
| `guest-surface` | [`../templates/guest-surface/copy.js`](../templates/guest-surface/copy.js) | Guest surface | conditions, occupancy, arrivals, tonight, service activity, who is here, rates, the capacity gauge, actions |
| `permission-gate` | [`../templates/permission-gate/copy.js`](../templates/permission-gate/copy.js) | Permission gate | refusal prose per disclosure mode, withheld notes, the resolution trace, actions |
| `roster` | [`../templates/roster/copy.js`](../templates/roster/copy.js) | Roster | column policies, per-cell fragments, counts, export and hidden notes, row actions |
| `degraded-states` | [`../templates/degraded-states/copy.js`](../templates/degraded-states/copy.js) | Degraded + alert states | severity prose per state × exposure, impact, metrics, recovery steps |
| `docs` | [`../templates/docs/copy.js`](../templates/docs/copy.js) | Docs / long-form | chrome only — the article prose is authored, and the boundary is documented at the top of that file |

`templates/station-console/` has **no pack**. It is not doctrine-projected: its strings are
template-owned, which is why it is exempt from the pack checks. See `../KNOWN-GAPS.md §1`.

Pack-specific assertions live beside the pack too — currently only
[`../templates/roster/checks.js`](../templates/roster/checks.js), registered via
`D.registerChecks()`.

## The shape every pack has

```js
D.registerPack({
  id: 'my-surface',

  // Policy. Declared once, at module scope. Cannot see ctx — that is the point:
  // a minimum is a fact about the wording, fixed before any context exists.
  catalogue: {
    'head.terrace': prose('Conditions are comfortable'),
    'head.service': prose('Ring 4 at 82% of rated load', { min: 2 }),
    'act.console':  act('Open operations \u00b7 sector 4', { min: 2, plain: 'Open the console', capability: 'view:all' })
  },

  // Selection. Returns declared IDs, or D.NONE. Never builds a fragment.
  select: ctx => ({ headline: ctx.machine ? 'head.service' : 'head.terrace' }),

  // Non-field extras: flags, view-model geometry, derived booleans.
  view: (ctx, out) => ({ register: ctx.level.register, hasHead: out.headline != null }),

  // Context integers for {n}-style fills, computed from the VISIBLE set only.
  fills: ctx => ({ n: visible(ctx).length })
});
```

Every fragment declares its axes independently: `kind` (prose · datum · action · label) ·
`provenance` (doctrine · domain) · `minExposure` · `existence` (public · conditional · secret) ·
`capability` · per-field `fallback`. A datum may be secret; prose may require Ledger.

**Actions carry an extra obligation.** Availability is role, capability and existence; exposure
governs only the *specificity* of the label. An action with a `min` must also carry `plain` — a
low-exposure label that preserves the offer without Service or Ledger vocabulary. `A7` fails a
pack that omits it.
