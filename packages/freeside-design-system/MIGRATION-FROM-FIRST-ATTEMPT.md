# Migration from the first attempt

An audit of Freeside UI work already in `0xHoneyJar/loa-freeside@main` (tree `8e6164376d5c`),
read **read-only**. Nothing was modified.

The short version: **there is no previous design system to migrate from.** There are two
earlier UI artifacts and one v0 spike. All three are consumers or prototypes, none is a token
layer or a doctrine, and **none should be deleted**.

---

## What exists today

### 1 · `themes/sietch/dashboard/` — the earlier UI attempt

React 18 + Vite + Tailwind + shadcn/ui, ~60 files. The most substantial existing interface.

```
src/index.css                          Tailwind entry + CSS custom properties
tailwind.config.js                     the theme (2,154 bytes)
src/components/ui/                     shadcn primitives — button, card, avatar, dropdown-menu
src/components/config/                 FeatureGateMatrix · RoleMappingTable · ThresholdEditor · TierHierarchy
src/components/sandbox/                DecisionTrace · PermissionResult · StateEditor
src/components/history/                Timeline · DiffViewer · RestoreModal
src/components/guards/RoleGuard.tsx    role-based render gating
src/components/layout/                 DashboardLayout · Header · Sidebar
src/pages/                             Dashboard · Login · Sandbox · ServerSelect
```

**Belongs to the old visual attempt.** Its theme is **Arrakis/Dune**, not Freeside —
`themes/README.md` describes `sietch/` as *"Arrakis/Dune themed service for BGT communities"*
and notes the naming convention is *"named after their community identity"*. Different fiction,
different palette, no relationship to Cannes Sky, Lado Sunlight or the register system.

**What remains genuinely useful — and is conceptually close to this system:**

| Existing | Relationship to the RC |
|---|---|
| `components/guards/RoleGuard.tsx` | Role-based **render gating**. The closest existing thing to Exposure — but it gates *whether* something renders, where Exposure governs *how much of it* renders. A useful integration point, not a replacement. |
| `components/sandbox/PermissionResult.tsx` + `DecisionTrace.tsx` | A permission decision and its trace, already rendered as UI. This is the same shape as the permission gate's `showTrace` block. Strong candidate for the first retrofit. |
| `components/config/ThresholdEditor.tsx`, `TierHierarchy.tsx`, `RoleMappingTable.tsx` | Real operator surfaces over roles, tiers and thresholds. The roster template is the closest RC analogue. |
| `components/config/FeatureGateMatrix.tsx` | A capability matrix. Maps onto the capability axis, and the *capability grant must not change rows or columns* rule applies to it directly. |
| `utils/accessibility.ts`, `components/shared/VirtualList.tsx`, `hooks/useVirtualScroll.ts` | Infrastructure worth keeping as-is. Note the RC's non-visual-leakage class (**N**) applies to virtualized lists: a row count in ARIA is as readable as a visible one. |
| `hooks/useOptimisticUpdate.ts` | Unrelated to disclosure. Keep. |

**Do not delete.** It is the only working operator UI in the repo and it has tests beside every
component.

### 2 · `apps/freeside-operator-dash/` — a consumer, and current

A server-rendered Hono service, ~19 files. Reads `packages/freeside-registry/registry.yaml`
and renders a federation tile grid, an identity-api phase scoreboard, and the Soju-lens
cross-surface identity reconciler.

**This is a consumer artifact, not a design attempt.** `src/render.ts` bakes HTML in-process —
its styling is inline, there is no token layer, and no design decision in it is meant to be
reused. It is the clearest candidate for consuming `styles.css` (see REPO-INTEGRATION.md §c).

One conceptual overlap worth naming: the tile grid already colours tiles by probe state
(`up` · `auth-gated` · `degraded` · `scaffold` · `down` · `unreachable`). That is a **severity**
channel, and the RC's degraded-state template says severity tracks *state* while specificity
tracks *exposure*. If that dashboard ever gains non-operator viewers, the six states are exactly
the kind of vocabulary that needs an exposure floor.

**Do not delete.** Actively used, and documented by ADR-009 §D-9.

### 3 · `tools/operator-dash/` — superseded v0 spike

Four files, ~40 KB, mostly `dash.ts`. The operator-dash README calls it *"v0 spike (superseded
by this)"*.

**Superseded, but do not delete** — it is referenced from the newer app's README as audit trail.

### 4 · Not a UI attempt, but adjacent

- `infrastructure/observability/grafana/dashboards/*.json` — Grafana dashboards. Out of scope;
  the operator-dash README explicitly says it is *"not a replacement for Grafana / CloudWatch"*.
- `sites/docs/` (Nextra) and `sites/web/` (Next.js) — deployed web properties, per
  `sites/README.md`. Future consumers of the stylesheet, and where public-facing Terrace and
  Atrium work would eventually live.

---

## Superseded by this release candidate

Nothing is superseded by **deletion**. What the RC supersedes is a set of *implicit decisions*
that the existing UI made by default:

| Implicit decision in the old UI | What the RC establishes instead |
|---|---|
| Tailwind utility classes carry the design decisions | Tokens carry them. `data-register` + `data-accent` + `data-exposure`, and components read only `--fs-accent-1` / `--fs-accent-2` — never past them. |
| Dune/Arrakis theming | Freeside: Cannes Sky, Lado Sunlight, Lunar Concrete, Babylon Foliage, Deep Space Ink. Two registers, five accent pairs. |
| Role gating is binary — render or do not | Exposure is graded. The same fact appears at four precisions, and a refusal has three disclosure modes rather than one. |
| Strings are written in components | Strings are declared in a copy pack with policy attached and projected through `dispose()`. A template that writes a literal is outside the guard. |
| shadcn defaults for radius, shadow, elevation | Square by default, roundness earned by context; mineral tint + hairline before any shadow; no glow in the base register. |
| Ad-hoc dark mode | Two named registers that nest in both directions. Never a hardcoded hex to get a dark panel. |

---

## What may later be mapped through the retrofit layer

In priority order, and **one at a time**:

1. **`src/index.css` + `tailwind.config.js`** — the single highest-leverage change. Remap the
   existing CSS custom properties to Freeside primitives in one file. Zero component edits.
   `examples/dashboard-palette/` is exactly this, already worked: `freeside-palette.css` plus
   `vendor/tokens.css` and `vendor/shadcn-compat.css` showing the before/after.
2. **`components/ui/`** (button, card) — four shadcn primitives. Map to `components/actions/Button`
   and `components/surfaces/Card` variants once the colour layer is in.
3. **`components/sandbox/PermissionResult.tsx`** — the natural first Exposure candidate, because
   it already renders a permission decision. The permission-gate template is the reference.
4. **`components/config/*`** — the roster template's per-cell sensitivity and per-action
   capability model applies directly.
5. **`apps/freeside-operator-dash/src/render.ts`** — stylesheet only, inlined at boot.

## What must not travel in the other direction

The retrofit is one-way. Do not copy old dashboard assumptions into the design system:

- **No Tailwind dependency.** The system is plain CSS custom properties. It must stay consumable
  by a server-rendered Hono app that has no bundler.
- **No shadcn component contracts.** Freeside components are already implemented with their own
  `.d.ts` contracts.
- **No Dune vocabulary.** Sietch, Arrakis and BGT-community naming stay in `themes/sietch/`.
- **No binary role gating replacing Exposure.** `RoleGuard` decides whether to mount. Exposure
  decides how specific the mounted thing is allowed to be. Collapsing them loses the doctrine.
- **No client-side filtering treated as authorization.** The sandbox components render decision
  traces, which is presentation. Server-side filtering remains the boundary.

---

## Conceptual and structural differences, summarized

**Structural.** The old attempt is an *application* — routes, pages, stores, a login flow. The RC
is a *package* — tokens, a doctrine engine, copyable templates and a conformance suite, with no
router, no store and no auth. That is why it belongs in `packages/` and the dashboard does not
move.

**Conceptual.** The old attempt asks *may this user see this component?* The RC asks *how much of
this one truth is this user owed?* The first question has a boolean answer and needs no tests
beyond "did it render". The second has four answers per fragment, which is why there are 37
checks over 276 cases and why the fragment catalogue is declared before any context exists.

The two questions are complementary. `RoleGuard` answering the first one correctly is a
precondition for the second being meaningful — and both sit on top of server-side authorization,
which neither of them is.
