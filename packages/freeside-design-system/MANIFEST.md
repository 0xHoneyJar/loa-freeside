# Manifest

`@freeside/design-system` **v1.0.0-rc.1** — every file in the archive.

## Counts

| | |
|---|---|
| Files | **197** |
| Templates | **6** (+ 6 print variants) |
| Components | **15** across 5 groups |
| Copy packs | **5** template packs · **6** registered (the sixth is `_canary`) |
| Fragments | **198** catalogued |
| Cards | **26** (21 in `cards/`, 5 beside their components) |
| Tokens | **168** unique `--fs-*` names · **248** declarations across theme scopes |
| Assets | **3** |
| Tests | **37** checks over **276** cases |

### Verified baseline

Running the **exported copies** of the engine, fixtures, tests and all five packs:

```
37 checks · 276 cases · 6 packs
VERDICT PASS · 0 failures · 0 suppressions · 0 advisories
```

### Two count corrections

- **Fragments are 198, not 163.** `audit()` on this tree reports 198 catalogued fragments.
  Earlier project notes cite 163; that number predates later additions and is stale.
- **Tokens: 168 or 248, depending on the question.** 168 distinct `--fs-*` names are declared;
  248 declarations exist once the 16 theme scopes (`[data-register="…"]`, `[data-accent="…"]`)
  are counted separately, since a name is redeclared per scope.


### Lore filename mappings

Two source-note filenames were converted to ASCII-safe package paths so they remain portable
across Windows, Linux, archive tooling and Git clients.

| Original filename | Exported filename | Reason |
|---|---|---|
| `Freeside Skys, Sea Resort, plants tumbling over the balconies.txt` | `docs/reference/lore-freeside-skies-sea-resort-balconies.txt` | Normalized spacing, punctuation and wording into a stable ASCII-safe repository path. |
| `Vingtième Siècle.txt` | `docs/reference/lore-vingtieme-siecle.txt` | Removed accented characters and normalized the title into a stable ASCII-safe repository path. |

## Dependencies and the lockfile

**There is no lockfile, because there are no npm dependencies.** The package dependency
graph is empty. Node 22+ is required by the conformance runner, documentation generator and
the zero-package-dependency static server built on `node:http`.

Consequences worth knowing:

- `npm install` succeeds and installs nothing.
- `npm ci` **fails**, because it requires a lockfile. That is expected, not a defect.
- No package compilation is required before serving the source tree.
- Interactive cards and templates require pinned browser copies of React, ReactDOM and Babel.
  They default to unpkg; template runtimes can be remapped through `window.__resources` as
  documented in `README.md`.
- The committed conformance and full-system documents under `dist/` are the offline artifacts.

Fonts and interactive browser runtimes are deliberately not vendored. See `docs/FONTS.md` and
the Browser runtime section of `README.md`.

## Structure, and where it departs from the requested tree

The requested layout asked for `src/`, `styles/`, `doctrine/`, `copy-packs/` and `tests/` as
directories holding source. Three of those would have broken the system, so they are index files
pointing at the real locations instead:

| Requested | Actual | Why |
|---|---|---|
| `src/` | *(absent)* | There is no separate source root. The source **is** `tokens/` + `styles.css` + `components/` + `templates/`. A `src/` wrapper would add a level with nothing in it. |
| `styles/` | `styles.css`, `environment.css` at root | `styles.css` is the package entry (`main`, `style`, `exports["."]`). Every template's `ds-base.js` resolves it as `<base>/styles.css`. Moving it breaks all six. |
| `doctrine/` | `templates/_doctrine/` + `doctrine/README.md` | Every template loads the engine as `../_doctrine/doctrine.js`, and the engine, fixtures, tests and runner reference each other the same way. Moving them breaks all six templates **and** the Conformance card. |
| `copy-packs/` | `templates/<slug>/copy.js` + `copy-packs/README.md` | A template loads its pack as `./copy.js`. Hoisting the packs would break that and split each template across two directories. |
| `tests/` | `templates/_doctrine/tests.js` + `tests/README.md` | Same unit as the engine. |
| `cards/` | `cards/` ✓ | Renamed from `guidelines/`. Same depth, so `../styles.css` still resolves. |
| `dist/` | `dist/` ✓ | Committed, not ignored — it is the portable docs site. |

The separation the requested tree was protecting — source vs documentation vs tests vs assets vs
examples vs generated output — is preserved. What is not preserved is relocating files whose
relative paths are load-bearing.

## Every file

**Kind** is `source` (edit this) or `generated` (regenerate, do not hand-edit).
**Runtime** is whether a rendered template or card fetches it in the browser.

| Path | Purpose | Kind | Runtime | Consumed by |
|---|---|---|---|---|
| `.gitignore` | Ignore list (dist/ is committed on purpose) | source | no | — |
| `ARCHIVE-NOTE.md` | Packaging and archive verification notes | source | no | — |
| `MANIFEST.md` | Complete package inventory, counts and provenance mappings | source | no | — |
| `CHANGELOG.md` | What v1.0.0-rc.1 contains | source | no | — |
| `CLAUDE.md` | Implementation rules for Claude Code | source | no | — |
| `KNOWN-GAPS.md` | Deliberately unfinished work, blocking vs post-RC | source | no | — |
| `MIGRATION-FROM-FIRST-ATTEMPT.md` | Audit of existing Freeside UI in loa-freeside | source | no | — |
| `README.md` | What the system is, how to run it, how to consume it | source | no | — |
| `REPO-INTEGRATION.md` | Destination inside loa-freeside + manual upload steps | source | no | — |
| `UPLOAD-CHECKLIST.md` | The exact commands, in order | source | no | — |
| `_adherence.oxlintrc.json` | Optional oxlint rules for adherence checking in consumers | generated | no | — |
| `_ds_bundle.js` | Compiled components, read as window.FreesideDesignSystem_1cacde.<Name> | generated | yes | all (via ds-base.js) |
| `_ds_manifest.json` | Compiler output — namespace, component and card index | generated | no | — |
| `assets/horse-mark.svg` | Mark asset | source | no | — |
| `assets/station-interior.png` | Source render of the cylinder interior. Provenance for the plate | source | no | — |
| `assets/terrace-plate.png` | THE canonical plate. Graded from station-interior.png toward Cannes blue | generated | yes | guest-surface, permission-gate, roster, station-console, cards |
| `cards/README.md` | Card index, groups, and the viewport rule | source | no | — |
| `cards/brand-environment.card.html` | Specimen / documentation card | source | no | — |
| `cards/brand-glyphs.card.html` | Specimen / documentation card | source | no | — |
| `cards/brand-marks.card.html` | Specimen / documentation card | source | no | — |
| `cards/brand-wordmark.card.html` | Specimen / documentation card | source | no | — |
| `cards/colors-accents.card.html` | Specimen / documentation card | source | no | — |
| `cards/colors-core.card.html` | Specimen / documentation card | source | no | — |
| `cards/colors-inks.card.html` | Specimen / documentation card | source | no | — |
| `cards/colors-materials.card.html` | Specimen / documentation card | source | no | — |
| `cards/colors-registers.card.html` | Specimen / documentation card | source | no | — |
| `cards/doctrine-conformance.card.html` | Specimen / documentation card | source | no | — |
| `cards/doctrine-exposure.card.html` | Specimen / documentation card | source | no | — |
| `cards/doctrine-review-guest-surface.card.html` | Specimen / documentation card | source | no | — |
| `cards/doctrine-review-permission-gate.card.html` | Specimen / documentation card | source | no | — |
| `cards/doctrine-review-roster.card.html` | Specimen / documentation card | source | no | — |
| `cards/retrofit.card.html` | Specimen / documentation card | source | no | — |
| `cards/review-frames.css` | Review card chrome | source | yes | doctrine-review-* cards |
| `cards/review-frames.js` | Iframe loader for the review cards — staggered load, prop retry | source | yes | doctrine-review-* cards |
| `cards/spacing-radii.card.html` | Specimen / documentation card | source | no | — |
| `cards/spacing-scale.card.html` | Specimen / documentation card | source | no | — |
| `cards/spacing-shadows.card.html` | Specimen / documentation card | source | no | — |
| `cards/type-labels.card.html` | Specimen / documentation card | source | no | — |
| `cards/type-scale.card.html` | Specimen / documentation card | source | no | — |
| `cards/type-system.card.html` | Specimen / documentation card | source | no | — |
| `components/actions/Button.d.ts` | Component contract | source | no | — |
| `components/actions/Button.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/actions/Button.prompt.md` | Component usage documentation | source | no | — |
| `components/actions/Input.d.ts` | Component contract | source | no | — |
| `components/actions/Input.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/actions/Input.prompt.md` | Component usage documentation | source | no | — |
| `components/actions/actions.card.html` | Component specimen card | source | no | — |
| `components/chat/ChatBubble.d.ts` | Component contract | source | no | — |
| `components/chat/ChatBubble.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/chat/ChatBubble.prompt.md` | Component usage documentation | source | no | — |
| `components/chat/chat.card.html` | Component specimen card | source | no | — |
| `components/data/DataTable.d.ts` | Component contract | source | no | — |
| `components/data/DataTable.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/data/DataTable.prompt.md` | Component usage documentation | source | no | — |
| `components/data/InfoRow.d.ts` | Component contract | source | no | — |
| `components/data/InfoRow.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/data/InfoRow.prompt.md` | Component usage documentation | source | no | — |
| `components/data/MessageBox.d.ts` | Component contract | source | no | — |
| `components/data/MessageBox.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/data/MessageBox.prompt.md` | Component usage documentation | source | no | — |
| `components/data/Step.d.ts` | Component contract | source | no | — |
| `components/data/Step.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/data/Step.prompt.md` | Component usage documentation | source | no | — |
| `components/data/data.card.html` | Component specimen card | source | no | — |
| `components/status/Callout.d.ts` | Component contract | source | no | — |
| `components/status/Callout.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/status/Callout.prompt.md` | Component usage documentation | source | no | — |
| `components/status/Spinner.d.ts` | Component contract | source | no | — |
| `components/status/Spinner.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/status/Spinner.prompt.md` | Component usage documentation | source | no | — |
| `components/status/StatusBadge.d.ts` | Component contract | source | no | — |
| `components/status/StatusBadge.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/status/StatusBadge.prompt.md` | Component usage documentation | source | no | — |
| `components/status/StatusPill.d.ts` | Component contract | source | no | — |
| `components/status/StatusPill.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/status/StatusPill.prompt.md` | Component usage documentation | source | no | — |
| `components/status/TierBadge.d.ts` | Component contract | source | no | — |
| `components/status/TierBadge.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/status/TierBadge.prompt.md` | Component usage documentation | source | no | — |
| `components/status/status.card.html` | Component specimen card | source | no | — |
| `components/surfaces/Card.d.ts` | Component contract | source | no | — |
| `components/surfaces/Card.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/surfaces/Card.prompt.md` | Component usage documentation | source | no | — |
| `components/surfaces/Panel.d.ts` | Component contract | source | no | — |
| `components/surfaces/Panel.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/surfaces/Panel.prompt.md` | Component usage documentation | source | no | — |
| `components/surfaces/Tile.d.ts` | Component contract | source | no | — |
| `components/surfaces/Tile.jsx` | Component implementation | source | yes | consumers via _ds_bundle.js |
| `components/surfaces/Tile.prompt.md` | Component usage documentation | source | no | — |
| `components/surfaces/surfaces.card.html` | Component specimen card | source | no | — |
| `copy-packs/README.md` | Pack index + the shape every pack has | source | no | — |
| `dist/conformance.html` | Conformance report, standalone and offline | generated | no | — |
| `dist/full-system.html` | The Whole System, on One Paper — fully self-contained, works offline | generated | no | — |
| `dist/manifest.json` | Machine-readable inventory. Regenerate with npm run build | generated | no | — |
| `dist/previews/README.md` | What each preview covers, and why they exist | source | no | — |
| `dist/previews/full-system-1.png` | Page images of the one-paper document | generated | no | — |
| `dist/previews/full-system-2.png` | Page images of the one-paper document | generated | no | — |
| `dist/previews/full-system-3.png` | Page images of the one-paper document | generated | no | — |
| `dist/previews/full-system-4.png` | Page images of the one-paper document | generated | no | — |
| `dist/previews/full-system-5.png` | Page images of the one-paper document | generated | no | — |
| `doc-page.js` | <doc-page> web component — paged print geometry | source | yes | _print/DesignSystemPrint |
| `docs/FONTS.md` | Font names, sources, loading, fallback stacks. No binaries shipped | source | no | — |
| `docs/architecture/README.md` | Architecture notes per foundation area | source | no | — |
| `docs/architecture/brand-and-icons.md` | Architecture notes per foundation area | source | no | — |
| `docs/architecture/color.md` | Architecture notes per foundation area | source | no | — |
| `docs/architecture/components.md` | Architecture notes per foundation area | source | no | — |
| `docs/architecture/space-and-form.md` | Architecture notes per foundation area | source | no | — |
| `docs/architecture/type.md` | Architecture notes per foundation area | source | no | — |
| `docs/authoring-skill.md` | Documentation | source | no | — |
| `docs/reference/lore-emergency-bar.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-freeside-port.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-freeside-skies-sea-resort-balconies.txt` | Provenance — artificial Cannes sky, hanging gardens and balcony vegetation | source | no | — |
| `docs/reference/lore-freeside.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-intercontinental.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-lado-acheson.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-nightclub.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-rue-jules-verne.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-villa-straylight.txt` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/lore-vingtieme-siecle.txt` | Provenance — floating restaurant, luxury dining and real-meat economy | source | no | — |
| `docs/reference/mood-strip.png` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/wordmark-candidates-1.png` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/reference/wordmark-candidates-2.png` | Provenance — wordmark candidates, mood strip, lore source notes | source | no | — |
| `docs/system-overview.md` | Documentation | source | no | — |
| `doctrine/README.md` | Map to the engine + the one formula + the public API | source | no | — |
| `environment.css` | Environmental media system — plate, grid, axis, curve, scrim, veil | source | yes | guest-surface, permission-gate, roster |
| `examples/README.md` | Example index + the order that works | source | no | — |
| `examples/dashboard-palette/dashboard-deep.html` | Worked retrofit — one file, no component edits | source | no | — |
| `examples/dashboard-palette/dashboard-light.html` | Worked retrofit — one file, no component edits | source | no | — |
| `examples/dashboard-palette/freeside-palette.css` | Worked retrofit — one file, no component edits | source | no | — |
| `examples/dashboard-palette/palette-mapping.html` | Worked retrofit — one file, no component edits | source | no | — |
| `examples/dashboard-palette/vendor/horai-light.css` | Worked retrofit — the vendor token layer being mapped FROM | source | no | — |
| `examples/dashboard-palette/vendor/shadcn-compat.css` | Worked retrofit — the vendor token layer being mapped FROM | source | no | — |
| `examples/dashboard-palette/vendor/tokens.css` | Worked retrofit — the vendor token layer being mapped FROM | source | no | — |
| `image-slot.js` | <image-slot> web component — the drag-and-drop plate | source | yes | guest-surface, permission-gate |
| `package.json` | Scripts, exports map, domain classification. No dependencies | source | yes | all |
| `retrofit/retrofit.card.html` | Retrofit recipe — adopting Freeside colour in a repo with its own tokens | source | no | — |
| `scripts/build.js` | Generates dist/index.html + dist/manifest.json by reading the tree | source | no | — |
| `scripts/serve.js` | Zero-dependency static server (npm run dev / preview) | source | no | — |
| `scripts/verify.js` | Portability check — paths, case, absolute refs, style holes | source | no | — |
| `styles.css` | PRIMARY CSS ENTRY POINT. @imports everything under tokens/ | source | yes | all |
| `templates/_doctrine/doctrine.js` | THE ENGINE. Exposure, disposition collapse, action projection, audit() | source | yes | all |
| `templates/_doctrine/fixtures.js` | The case matrix + the _canary pack. Shared by CI and the Conformance card | source | yes | all + tests |
| `templates/_doctrine/run-checks.js` | CI entry point. npm test runs this | source | no | tests |
| `templates/_doctrine/tests.js` | The 37 assertions across six classes | source | no | tests |
| `templates/_print/DegradedStates.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/DesignSystemPrint.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/Docs.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/DoctrineReviewPrint.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/GuestSurface.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/PermissionGate.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/Roster.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/StationConsole.dc.html` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/ds-base.js` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/_print/support.js` | Print variant — generated from the live template, image-slot flattened to <img>, plate inlined | generated | no | dist/full-system.html |
| `templates/degraded-states/DegradedStates.dc.html` | Template entry point | source | yes | itself |
| `templates/degraded-states/.thumbnail` | Claude Design template thumbnail metadata | generated | no | degraded-states |
| `templates/degraded-states/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/degraded-states/copy.js` | Copy pack — fragment catalogue, selector, view model | source | yes | its own template |
| `templates/degraded-states/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/degraded-states/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `templates/docs/Docs.dc.html` | Template entry point | source | yes | itself |
| `templates/docs/.thumbnail` | Claude Design template thumbnail metadata | generated | no | docs |
| `templates/docs/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/docs/copy.js` | Copy pack — fragment catalogue, selector, view model | source | yes | its own template |
| `templates/docs/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/docs/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `templates/guest-surface/GuestSurface.dc.html` | Template entry point | source | yes | itself |
| `templates/guest-surface/.thumbnail` | Claude Design template thumbnail metadata | generated | no | guest-surface |
| `templates/guest-surface/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/guest-surface/copy.js` | Copy pack — fragment catalogue, selector, view model | source | yes | its own template |
| `templates/guest-surface/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/guest-surface/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `templates/permission-gate/PermissionGate.dc.html` | Template entry point | source | yes | itself |
| `templates/permission-gate/.thumbnail` | Claude Design template thumbnail metadata | generated | no | permission-gate |
| `templates/permission-gate/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/permission-gate/copy.js` | Copy pack — fragment catalogue, selector, view model | source | yes | its own template |
| `templates/permission-gate/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/permission-gate/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `templates/roster/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/roster/Roster.dc.html` | Template entry point | source | yes | itself |
| `templates/roster/.thumbnail` | Claude Design template thumbnail metadata | generated | no | roster |
| `templates/roster/checks.js` | Pack-specific conformance assertions | source | no | tests |
| `templates/roster/copy.js` | Copy pack — fragment catalogue, selector, view model | source | yes | its own template |
| `templates/roster/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/roster/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `templates/station-console/README.md` | Template guide — exposure, controls, what to copy, what not to hardcode | source | no | — |
| `templates/station-console/StationConsole.dc.html` | Template entry point | source | yes | itself |
| `templates/station-console/.thumbnail` | Claude Design template thumbnail metadata | generated | no | station-console |
| `templates/station-console/ds-base.js` | Loads the design system. EDIT ITS ONE base LINE when copying out | source | yes | its own template |
| `templates/station-console/support.js` | Design Component runtime. Do not edit | generated | yes | its own template |
| `tests/README.md` | How to run the suite + what each class asserts | source | no | — |
| `thumbnail.html` | Package tile — brand mark + swatch strip | source | no | — |
| `tokens/colors.css` | Design tokens | source | yes | all (via styles.css) |
| `tokens/fonts.css` | Design tokens | source | yes | all (via styles.css) |
| `tokens/spacing.css` | Design tokens | source | yes | all (via styles.css) |
| `tokens/typography.css` | Design tokens | source | yes | all (via styles.css) |

## Generated files, and how to regenerate them

| File | Regenerate with | Notes |
|---|---|---|
| `dist/index.html` | `npm run build` | Derived by reading the tree, so it cannot drift |
| `dist/manifest.json` | `npm run build` | Same. `generatedAt` changes each run |
| `_ds_bundle.js` | *(design-system compiler)* | Compiled from `components/**/*.jsx`. Committed so consumers need no build step |
| `_ds_manifest.json` | `npm run build` **(card index)** + *(design-system compiler)* | The build rewrites `cards` from the tree; every other key is the compiler's. `npm run verify` fails on a card target that does not exist |
| `_adherence.oxlintrc.json` | *(design-system compiler)* | Optional lint rules |
| `templates/_print/*` | see below | Generated from the live templates |
| `dist/conformance.html` | *(no generator in this repo)* | Hand-synchronized — see below |
| `dist/full-system.html` | inline the print document | 3 MB, fully self-contained |
| `dist/previews/*.png` | page captures of the above | Review material |
| `assets/terrace-plate.png` | luminance-keyed duotone over `station-interior.png` | The grading recipe is in `KNOWN-GAPS.md §4` |

### `dist/conformance.html` is synchronized by hand

`npm run build` regenerates `dist/index.html` and `dist/manifest.json` only. The two
standalone artifacts — `dist/conformance.html` and `dist/full-system.html` — are produced by
the design-system publisher, which is not part of this repo, so a change to a card does not
reach them automatically.

`dist/conformance.html` carries the Conformance card as an inline copy: a JSON-encoded
document in `<script type="__bundler/template">`, whose trailing `<script>` block is
byte-identical to the trailing `<script>` of `cards/doctrine-conformance.card.html`. When that
renderer changes, splice the new block into the encoded template and re-encode with the
bundler's own convention — `JSON.stringify` with literal non-ASCII, then `</` → `</`.
Nothing else in the file changes: the asset manifest, the external-resource and page-order
blocks, and the unpacker prologue are all left byte-for-byte alone.

`dist/full-system.html` does **not** embed the Conformance card — it bundles the
`templates/_print/*` documents — so a Conformance renderer change does not apply to it. It
**does** embed `templates/_print/support.js`, gzip-compressed and base64-encoded in its
`<script type="__bundler/manifest">` asset map, and that runtime executes: the bundled
document's helmet mounts nine ordered external scripts (`doctrine.js`, then five `copy.js`
packs), which is exactly the path the ordered-execution fix protects. A `support.js` change
therefore has to be re-embedded, not merely noted.

To re-embed: decode the entry (base64 → gzip), confirm it differs from the file on disk,
recompress the disk bytes deterministically (level 9, `mtime=0`), and write back only that
entry's `data` — `mime` and `compressed` stay as the publisher set them. The replacement
stream will **not** be byte-identical to the publisher's original, which used a different gzip
implementation (header OS byte `0x0a`); that is not a requirement. What must hold is that the
entry decompresses to exactly the on-disk file, that the operation is idempotent, and that the
finished artifact still unpacks in a browser — verify by loading it and checking that all five
copy packs register and the helmet scripts report `async === false`.

### Print variants

`templates/_print/*` are generated from the live templates with three transforms:

1. The `@template` marker is stripped, so the picker keeps `templates/<slug>/` as the only entry.
2. `./copy.js` is rewritten to `../<slug>/copy.js`.
3. `<image-slot src="…">` becomes a plain `<img>`, and the plate is inlined as a 42 KB JPEG data
   URI — because a static export has no use for a drop target, and the bundler cannot inline a
   `src` that lives on a web component's attribute.

Do not hand-edit them. Change the live template and regenerate.

## Not included

| Omitted | Why |
|---|---|
| Font binaries | Not licensed for redistribution. `docs/FONTS.md` gives names, sources, loading and fallbacks. |
| `node_modules/` | No dependencies. |
| A lockfile | Nothing to lock — see above. |
| Four lore reference notes | Source filenames contained characters the export tooling rejects (commas and accented characters). Seven of eleven were carried through to `docs/reference/`; the omitted ones are narrative source notes with no bearing on any implementation decision. |
