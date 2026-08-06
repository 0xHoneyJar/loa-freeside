# Freeside Design System

**v1.0.0-rc.1** · source of truth for Freeside interface work.

Freeside is an orbital resort with a machine underneath it. The design system exists to
hold both facts at once: the surface is a Mediterranean resort in a spindle, and the
substrate is a scoring, settlement and permission engine. Neither is hidden from the
other, and neither is dressed up as the other.

## Paradise and the substrate

There is **one underlying truth**, disclosed at four precisions. A guest on the terrace
and a principal reading the ledger are looking at the same number; they are not shown the
same amount of it. Nothing a guest reads is false at Ledger — it is only less specific.

That is the whole doctrine, and everything else follows from it:

| | Level | Register | What the interface admits |
|---|---|---|---|
| 0 | **Terrace** | light / Paradise | Conditions in words. No figures, no machine vocabulary, no counting. |
| 1 | **Atrium** | light / Paradise | Ranges and your own record. One place may be named. |
| 2 | **Service** | deep / Authority | The machine named. Exact figures, records, operations. |
| 3 | **Ledger** | deep / Authority | Economics and ownership, including the doctrine's own arithmetic. |

Exposure is computed, never chosen:

```
exposure = min(accessCeiling, max(depthBaseline, stateFloor))
```

- **Depth baseline** — how deep in the product this page sits (arrival 0 · account 1 · console 2 · settlement 3).
- **State floor** — an incident raises the floor, because a degraded system owes a more specific account of itself.
- **Access ceiling** — what the viewer's role permits (guest 0 · member 1 · operator 2 · principal 3). This is a **hard cap**. A state floor may raise exposure toward it and never through it. An alert is not an authorization.

When the floor wants more than the ceiling allows, the result is a **clamp**: the interface
acknowledges that something is being withheld without describing it, and the acknowledgment
itself is governed by the resource's existence policy.

### Copy is projected, not written

A template never writes a user-facing string. Each template ships a **copy pack** that
declares every fragment once, at module scope, with its policy attached — kind, provenance,
minimum exposure, existence, capability, and a fallback. A selector then returns declared
**IDs**; it never constructs a fragment. The engine decides.

This ordering is what makes the tests bite. A minimum is a fact about the wording, fixed
before any context exists, so the suite can force every fragment through `dispose()` at
every context with no selector involved.

Packs never see a denial reason. `decide()` keeps the exact reason for the audit; packs call
`dispose()` and get `render` / `fallback` / `omit`. For a resource whose existence may not be
acknowledged, missing capability, insufficient exposure and true absence all collapse to
`omit` — so the interface shows the same face regardless of why.

### Every channel is a disclosure channel

Text, numerals, geometry, ordering, colour, animation, accessibility metadata and DOM
structure all represent the same facts, and each must stay within the precision the level
permits. A bar whose width is the reading states the reading, whatever the caption says.
The capacity gauge in `templates/guest-surface/` is the reference implementation: at Terrace
it renders three quantized segments and the exact figure exists nowhere on the client.

### Not the security boundary

Exposure decides what a **permitted** viewer is **shown**. It never decides what a viewer is
permitted to **receive**. Unauthorized rows, cells, counts, pagination metadata and exports
must be filtered or authorized **server-side, before the payload reaches the client**. DOM
omission and CSS hiding are not access control — the data is still in the response. Every
check in the suite asserts presentation only; a green verdict says nothing about what was sent.

## Install

There are no runtime dependencies and no build step. Node 22+ is needed only for the test
runner and the static server.

```bash
# nothing to install — but this is harmless and creates no lockfile churn
npm install          # or: pnpm install
```

There is no lockfile in this package because there are no dependencies to lock. See
MANIFEST.md.

## Run

```bash
npm run dev          # serve the whole package at http://localhost:4173
npm run build        # regenerate dist/index.html + dist/manifest.json from the tree
npm run preview      # serve just dist/ at http://localhost:4174
npm test             # the conformance suite
npm run check        # alias of npm test
npm run verify       # portability check: paths, case, absolute refs, style holes
```

Everything must be served over `http://`. Opening a card as a `file://` URL fails: the
templates fetch their own scripts by relative path.

### Documentation

`npm run dev`, then open **<http://localhost:4173/dist/index.html>**. That page is generated
by reading the tree, so it cannot drift from what is on disk. It indexes every template,
card and component, and links the one-paper document.

### Templates

```
http://localhost:4173/templates/guest-surface/GuestSurface.dc.html
http://localhost:4173/templates/permission-gate/PermissionGate.dc.html
http://localhost:4173/templates/roster/Roster.dc.html
http://localhost:4173/templates/degraded-states/DegradedStates.dc.html
http://localhost:4173/templates/docs/Docs.dc.html
http://localhost:4173/templates/station-console/StationConsole.dc.html
```

Each folder has its own README covering what it demonstrates, which files to copy, and what
must stay imported.

### Tests

```bash
npm test
```

Runs `node templates/_doctrine/run-checks.js`, which exits non-zero on any failure **or any
guard suppression**. Expected on a clean checkout:

```
37 checks · 276 cases · 6 packs · 0 failures · 0 suppressions · 0 advisories
```

Six independent test classes:

| Class | Asserts |
|---|---|
| **A** structural validity | duplicate declarations, unknown selector IDs, missing policy axes, missing required-field fallbacks, secret-on-required, actions ungated |
| **B** fragment policy | every fragment × every context, forced through `dispose()` with no selector involved |
| **C** selector behaviour | known contexts choose the expected IDs |
| **D** reachability | every production fragment is selected somewhere; canaries never are |
| **E** deliberate failure | a canary projected below its floor really does fall back, record the reason, and fail a verdict |
| **N** non-visual leakage | ARIA, title, `data-*`, form values, geometry and metadata read off the **view model**, never trusted in markup |

## Consuming the system

### A greenfield product

1. Link the stylesheet. `styles.css` is the entry point and `@import`s everything under `tokens/`.
   `environment.css` is separate and optional — link it only if you use environmental frames.
2. Set `data-register="light"` or `"deep"` and one `data-accent="…"` pair on a container.
   Set `data-exposure="0..3"` for page rhythm. Never set padding per template.
3. Copy a template folder out of `templates/`, edit the one `base` line in its `ds-base.js`,
   and rewrite the strings in its `copy.js` — keeping the policy axes.
4. Wire `templates/_doctrine/run-checks.js` into CI and add one `require` per new pack.

### An existing repository

Use the retrofit layer rather than a rewrite. `retrofit/retrofit.card.html` is the recipe,
and `examples/dashboard-palette/` is a worked example: a repo with its own Tailwind/shadcn
token layer, remapped to Freeside colour in **one file with no component edits**.

The order that works: colour first, then type, then rhythm, then — only where a surface
genuinely has viewers at different depths — Exposure.

## Entry points

| Purpose | File |
|---|---|
| **Primary CSS entry** | `styles.css` |
| Environmental frames | `environment.css` |
| Doctrine engine | `templates/_doctrine/doctrine.js` |
| Test runner | `templates/_doctrine/run-checks.js` |
| Compiled components | `_ds_bundle.js` (read as `window.FreesideDesignSystem_1cacde.<Name>`) |
| Machine inventory | `dist/manifest.json` |
| Implementation rules for Claude Code | `CLAUDE.md` |

## Fonts

Two faces, no binaries shipped. See `docs/FONTS.md` for exact names, sources, loading
expectations and fallback stacks.

- **Michroma** — wordmark and display only.
- **Archivo** — everything else, including every numeral (tabular).

## Where to go next

| Document | Contents |
|---|---|
`MANIFEST.md` | every file, its purpose, source vs generated, which templates consume it |
`KNOWN-GAPS.md` | what is deliberately unfinished, blocking vs post-RC |
`REPO-INTEGRATION.md` | recommended path inside `0xHoneyJar/loa-freeside` and manual upload steps |
`MIGRATION-FROM-FIRST-ATTEMPT.md` | audit of the existing Freeside UI in that repo |
`UPLOAD-CHECKLIST.md` | the exact commands, in order |
`CHANGELOG.md` | what v1.0.0-rc.1 contains |
