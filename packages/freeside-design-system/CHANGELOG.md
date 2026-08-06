# Changelog

## 1.0.0-rc.1 — 2026-08-05

First release candidate. Frozen for handoff to `0xHoneyJar/loa-freeside`.

Baseline at freeze: **37 checks · 276 cases · 6 packs · 0 failures · 0 suppressions · 0 advisories**.

### Doctrine

- **Exposure** as the single mechanism. `exposure = min(accessCeiling, max(depthBaseline, stateFloor))`,
  with four levels — Terrace, Atrium, Service, Ledger.
- **Access is a ceiling.** A state floor raises exposure toward it and never through it.
  A clamp acknowledges without describing, and the acknowledgment is itself governed by the
  resource's existence policy.
- **Centralized disposition policy.** `decide()` keeps the internal reason for the audit;
  packs call `dispose()` and receive only `render` / `fallback` / `omit`. For a resource whose
  existence may not be acknowledged, missing capability, insufficient exposure and true
  absence all collapse to `omit` — the collapse is the default inside one function, not a
  branch a pack opts into.
- **Catalogue, then selection.** A pack declares every fragment once at module scope in
  `catalogue`, as policy that cannot see `ctx`. `select(ctx)` returns declared IDs or `D.NONE`.
  `view(ctx, out)` returns non-field extras. That split is what lets test class B force every
  fragment through `dispose()` at every context with no selector involved.
- **Orthogonal axes per fragment:** `kind` · `provenance` · `minExposure` · `existence` ·
  `capability` · per-field `fallback`. A datum may be secret; prose may require Ledger.
- **Actions sit on four independent axes.** Role and capability decide whether an action may
  be *performed*; the resource's existence policy decides whether it may be *offered*;
  exposure governs only the *specificity* of its label and explanation; the destination
  resolves its own exposure under the same access ceiling. Invariant `A7`: availability must
  not depend on exposure alone, but presentation may be exposure-governed. An action carrying
  a `min` must also carry `plain` — a low-exposure label that preserves the offer without
  Service or Ledger vocabulary — and `dispose()` renders that instead of withdrawing the action.
- **Every representation channel is a disclosure channel.** Text, numerals, geometry, ordering,
  colour, animation, accessibility metadata and DOM structure all represent the same facts and
  each must stay within the permitted precision. Geometry is quantized, not exempt.
- **Not the security boundary.** Presentation only. Server-side filtering is the real boundary,
  and the suite says nothing about what was sent.

### Conformance

- Six test classes — A structural validity · B fragment policy · C selector behaviour ·
  D reachability · E deliberate failure · N non-visual leakage.
- `templates/_doctrine/fixtures.js` is the single case matrix, shared by CI and the
  Conformance card. Extend it with `F.withCapability` / `F.withCeilingGrant`; never hand-build
  a case list.
- A **capability** grant must not change rows or columns. A **ceiling** grant travels on
  `ceilingGrant` and legitimately may — that separation is what makes the rule testable.
- CI entry point: `node templates/_doctrine/run-checks.js`. Exits non-zero on any failure
  **or any guard suppression**.

### Foundations

- Colour: primitives, registers (light / Paradise, deep / Authority), five accent pairs,
  semantic states, materials, inks. 248 tokens across four files plus `environment.css`.
- Type: two faces, six roles. Michroma sets the wordmark and display; Archivo sets everything
  else including every numeral, tabular. Casing fixed per role.
- Space: 4px sub-unit, 8px rhythm, exposure-scoped page padding and stack gap.
- Form: square by default; roundness is earned by context. Mineral tint + hairline before any
  shadow; no glow in the base register.

### Environmental media system

- `environment.css` is deliberately thin. The place arrives as a **render in the plate**;
  CSS supplies sky behind, one arc closing overhead, and the overlays that seat the image.
- Layer order: plate → grid → axis → curve → scrim → veil → anno. Every layer optional.
- Exposure tunes the *frame*, never the asset: `--fs-env-plate-filter` desaturates at Service
  and Ledger, `--fs-env-bloom` steps down, `.fs-env-grid` appears. One canonical image, four
  precisions.
- The CSS axis is never laid over a plate: a render carries its own light in perspective.

### Templates

Six copyable folders, each with a README: guest surface · permission gate · roster ·
degraded states · docs / long-form · Station Console. Print variants under `templates/_print/`.

### Components

15 implemented components across five groups — actions, chat, data, status, surfaces — each
with a `.jsx` implementation, a `.d.ts` contract, a `.prompt.md` usage doc and a specimen card.

### Documentation

26 cards as portable source: doctrine (exposure, conformance, three review cards), brand
(environment, glyphs, marks, wordmark), colour (5), type (3), spacing (3), components (5),
retrofit. Plus the one-paper full-system document.

### Known at freeze

See `KNOWN-GAPS.md`. Nothing in it blocks upload.
