# Repository integration — 0xHoneyJar/loa-freeside

Written after a **read-only** inspection of `main` at tree `8e6164376d5c` (5,681 importable
files). **Nothing in that repository was edited, committed or pushed.**

## Recommended destination

```
packages/freeside-design-system/
```

The archive's root folder is named `freeside-design-system/`, so the copy is a straight move.

### Why `packages/`

`packages/README.md` states the rule directly: *"Workspace packages for the loa-freeside
monorepo. Domain assignment per ADR-007 §D-1 … CI enforces the platform/network firewall on
cross-domain commits."* It distinguishes published `@freeside/<name>` packages from internal
organizational directories, and lists `ui/` — *"Shared React UI components"* — as an existing
sibling. A design system is what that directory is for.

**Domain classification is mandatory.** This archive's `package.json` declares:

```json
"freeside": { "domain": "shared" }
```

Shared is the honest answer: the system is consumed by both platform surfaces
(`themes/sietch/dashboard/`) and network surfaces (`apps/freeside-operator-dash/`), and it adds
no cross-domain runtime code — it is CSS, plain JS and HTML. Confirm against ADR-007 §D-1
before the first CI run. If the firewall wants an explicit entry, that is a one-line addition,
not a restructure.

### Why *not* `apps/freeside-operator-dash/`

That app is a **consumer**, and structurally cannot be the source of truth:

- Its README describes it as an *"inward-facing operator visibility surface for the freeside
  `*-api` cell network"* — one audience, one job.
- It is a **server-rendered Hono service**. `src/render.ts` produces HTML in-process ("fully
  baked, no browser fetches"), `bin/http.ts` is a `@hono/node-server` entry, and `src/probe.ts`
  / `src/soju-lens.ts` do live network probing. There is no client-side asset pipeline for a
  stylesheet to enter through.
- It carries its own `pnpm-workspace.yaml` and pins `pnpm@8.15.9`, while the root pins
  `pnpm@9.15.4`. Nesting a shared package inside it would inherit that divergence.
- It already reads `packages/freeside-registry/registry.yaml` — the app itself treats
  `packages/` as where shared truth lives.

Placing the design system inside one app would make every other consumer depend on that app,
and would put the source of truth underneath one of its own consumers.

### Alternatives considered and rejected

| Path | Why not |
|---|---|
| `packages/ui/` | Exists with a different remit — shared React components. Merging would conflate a component library with a doctrine engine, tokens and templates, and would bury the conformance suite. |
| `themes/` | `themes/README.md` defines a theme as *"a complete backend service implementation"* with Discord bots, API endpoints and background jobs. Wrong shape entirely. |
| `sites/` | For deployed web properties (Nextra docs, marketing). The design system is a package a site could consume, not a site. |
| Its own repo | Defensible later. Not now — the first consumer is in this monorepo, so a same-repo package makes the first retrofit a relative import rather than a publish step. |

## Paths that must not be overwritten

The upload is **additive**. Nothing outside the new directory should change:

```
apps/freeside-operator-dash/**                    consumer app — untouched
apps/freeside-operator-dash/pnpm-workspace.yaml   the workspace file lives HERE, not at root
apps/mcp-gateway/**                               sibling app
packages/ui/**                                    existing shared React components — do NOT merge into
packages/README.md                                edit later, deliberately (see below)
packages/core/ adapters/ cli/ sandbox/ events/ protocol/ services/
packages/freeside-registry/**                     L1 registry read by the operator dash
themes/sietch/**                                  includes the earlier dashboard — see MIGRATION-FROM-FIRST-ATTEMPT.md
tools/operator-dash/**                            v0 spike, superseded but retained
decisions/**                                      ADRs
package.json  pnpm-lock.yaml  package-lock.json   root manifests
.oxlintrc.json  Makefile  CLAUDE.md               root config and agent rules
```

**Name collision to check first.** This archive contains its own `CLAUDE.md`. It belongs at
`packages/freeside-design-system/CLAUDE.md` and must **not** replace the repository root
`CLAUDE.md` (15,716 bytes). Verify the destination path before extracting.

## Manual upload steps

```bash
# 1 · from your clone of loa-freeside, on a branch
git checkout main
git pull
git checkout -b feat/freeside-design-system-v1-rc

# 2 · confirm the destination is empty
ls packages/freeside-design-system 2>/dev/null && echo "STOP: path exists" || echo "clear"

# 3 · extract somewhere neutral, NOT inside the repo
mkdir -p /tmp/fds && unzip ~/Downloads/freeside-design-system-v1-rc.zip -d /tmp/fds
ls /tmp/fds                      # expect exactly: freeside-design-system

# 4 · verify BEFORE it touches the repo
cd /tmp/fds/freeside-design-system
node scripts/verify.js           # expect: OK — tree is portable
node templates/_doctrine/run-checks.js
#   expect: 37 checks · 276 cases · 6 packs · PASS · 0 suppressions

# 5 · move it in
cd -
cp -R /tmp/fds/freeside-design-system packages/freeside-design-system

# 6 · confirm the diff is purely additive
git status --porcelain | grep -v '^?? packages/freeside-design-system/' || echo "additive only"

# 7 · run from inside the repo
(cd packages/freeside-design-system && npm test && npm run verify)

# 8 · commit
git add packages/freeside-design-system
git commit -m "feat(design-system): Freeside Design System v1.0.0-rc.1"
```

Do **not** run `pnpm install` at the repository root as part of this upload. The package has no
dependencies, and the root install runs `postinstall: scripts/rebuild-hounfour-dist.sh`, which
is unrelated to this change and will muddy the diff.

## How the dashboard consumes it later

Three ways, in increasing order of commitment.

### a · Stylesheet only — the retrofit path, and the right first step

For `themes/sietch/dashboard/` (React + Vite + Tailwind), add one import and remap the existing
token layer. `retrofit/retrofit.card.html` is the recipe; `examples/dashboard-palette/` is the
worked precedent — a repo with its own Tailwind/shadcn tokens remapped in **one file, no
component edits**.

```css
/* themes/sietch/dashboard/src/index.css */
@import '../../../../packages/freeside-design-system/styles.css';
```

Vite resolves that at build time. If the depth is awkward, alias it instead:

```ts
// themes/sietch/dashboard/vite.config.ts
resolve: {
  alias: { '@freeside/design-system': path.resolve(__dirname, '../../../packages/freeside-design-system') }
}
```

### b · Workspace dependency

The repo already uses `file:` deps — `apps/freeside-operator-dash/package.json` has
`"@0xhoneyjar/events": "file:../../packages/events"`. Follow that pattern:

```json
"dependencies": { "@freeside/design-system": "file:../../packages/freeside-design-system" }
```

Then `import '@freeside/design-system/styles.css'`. The archive declares the matching `exports`
map (`.`, `./styles.css`, `./environment.css`, `./tokens/*`, `./doctrine`, `./manifest`).

### c · Server-rendered consumers

`apps/freeside-operator-dash/src/render.ts` builds HTML in-process and cannot import CSS through
a bundler. Two options:

- Read the stylesheet at boot and inline it into a `<style>` tag. No build step, and it matches
  the app's existing "fully baked, no browser fetches" stance.
- Or serve the package as static files under a route and emit a `<link rel="stylesheet">`. Adds
  a route; keeps the CSS cacheable.

Either way the app consumes `styles.css` only. Do not copy tokens into it.

## Workspace files that may need a deliberate later edit

Each is a **separate, intentional** change — none is part of this upload:

| File | Change | Why deferred |
|---|---|---|
| `packages/README.md` | Add a row for `@freeside/design-system` under the right domain table | Wording the repo owner should own, and it needs the ADR-007 domain call confirmed |
| `apps/freeside-operator-dash/pnpm-workspace.yaml` | Already globs `packages/*`, so the package is picked up with no edit — **verify, do not assume** | There is no root `pnpm-workspace.yaml`; the only workspace file sits inside that app, which deserves its own conversation |
| Root `package.json` | Nothing required. Optionally add a `test:design-system` script | The package is self-contained and needs no root wiring |
| `.github/CODEOWNERS` | Add an owner for the new path | Ownership decision |
| `.oxlintrc.json` | Optionally extend from the shipped `_adherence.oxlintrc.json` | Opt-in; will surface findings in consumer code |
| CI workflow | Add `node packages/freeside-design-system/templates/_doctrine/run-checks.js` | Should land with the first consumer, so a red suite blocks something real |

## Verifying the upload after GitHub receives it

```bash
git clone git@github.com:0xHoneyJar/loa-freeside.git /tmp/verify-fds
cd /tmp/verify-fds/packages/freeside-design-system

node scripts/verify.js       # expect: OK — tree is portable
node templates/_doctrine/run-checks.js
#   expect: 37 checks · 276 cases · 6 packs · PASS · 0 suppressions · 0 advisories
node scripts/build.js        # counts must match dist/manifest.json as committed

node scripts/serve.js . 4173
# http://localhost:4173/dist/index.html                        → indexes every template and card
# http://localhost:4173/templates/roster/Roster.dc.html        → renders with data
```

Three things to check by eye on GitHub, because a local clone hides them:

1. **Case.** Asset and card filenames are lowercase-with-hyphens. macOS is case-insensitive;
   Linux and GitHub are not. `scripts/verify.js` catches this.
2. **The plates landed.** `assets/terrace-plate.png` and `assets/station-interior.png` must both
   be real files, not LFS pointers.
3. **`dist/full-system.html` is intact** (~3 MB, self-contained). Some upload paths truncate
   large single files.

## What this document does not do

It does not perform the integration. No branch was pushed, no file in `loa-freeside` was
modified, and no consumer was retrofitted. The retrofit trial is scoped in `KNOWN-GAPS.md §2`
and is deliberately separate work against `0xHoneyJar/freeside-dashboard`.
