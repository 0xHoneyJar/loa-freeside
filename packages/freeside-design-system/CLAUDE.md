# Freeside Design System — working conventions

## Card viewports

Write the `@dsCard viewport` **last**, after every content edit in the turn, and set it to
measured height **+10%**. A card that declares more height than it uses renders identically;
one that declares less silently eats the 48px page margin the system defines.

Four cards were shipped clipped this way. Every time, the number was measured correctly and
then invalidated by a later edit in the same turn.

## Doctrine

`guidelines/doctrine-exposure.card.html` is the specification. `templates/_doctrine/doctrine.js`
is its implementation, and `guidelines/doctrine-conformance.card.html` asserts them against
each other on every load.

- Templates **never write copy**. They hand structured facts to the projector and render what
  comes back. A template that hand-writes a string is outside the guard.
- `guard()` fails closed: below Service it drops illegal lines rather than rendering them,
  and a drop fails the conformance verdict.
- Adding a new user-facing string means adding a projector case, not a literal.

### Ordinals are not identifiers

Row ordinals — the `01`, `02` … gutter in the roster — are **positions in the visible set only**.
They are safe to render for the same reason the count is: they describe what is on screen and
cannot be differenced against it to recover a hidden total.

They are **not** durable record identifiers and must never be used as one. An ordinal changes
under sorting, filtering, pagination, and any change in the viewer's access. Never persist one,
never put one in a URL, never use one as a foreign key, and never let one reach an export where a
reader could mistake it for a record number. The durable key is `rows[].id`, which the pack
supplies and the row-existence policy governs.

### Not the security boundary

Exposure decides what a permitted viewer is **shown**, never what they are permitted to **receive**.
Unauthorized rows, cells, counts, pagination metadata and exports must be filtered or authorized
**server-side, before the payload reaches the client**. DOM omission and CSS hiding are not access
control — the data is still in the response. Every check in `_doctrine/tests.js` asserts
presentation only; a green verdict says nothing about what was sent.

### Copy packs

Each template ships `copy.js` beside it and calls `D.registerPack({...})`. The runtime owns the
mechanism only — never product strings.

- **Catalogue, then selection.** A pack declares every fragment once, at module scope, in
  `catalogue` — policy that cannot see ctx. `select(ctx)` returns declared **IDs** or `D.NONE`;
  it never constructs a fragment. `view(ctx, out)` returns non-field extras. That split is what
  makes the policy tests bite: a minimum is a fact about the wording, fixed before any context
  exists, and test class B forces every fragment through `dispose()` at every context with no
  selector involved.
- Every fragment declares **orthogonal axes** independently: `kind` (prose/datum/action/label) ·
  `provenance` (doctrine/domain) · `minExposure` · `existence` (public/conditional/secret) ·
  `capability` · per-field `fallback`. A datum may be secret; prose may require Ledger.
- **Actions sit on four independent axes.** Role and capability decide whether an action may be
  **performed**; the resource's existence policy decides whether it may be **offered**; exposure
  governs only the **specificity** of its label and explanation; the destination resolves its own
  exposure under the access ceiling. The invariant `A7` enforces: availability must not depend on
  exposure alone, but presentation may be exposure-governed. An action carrying a `min` must also
  carry `plain` — a low-exposure label that preserves the offer without Service or Ledger
  vocabulary — and `dispose()` renders that instead of withdrawing the action. Capability and
  existence still withdraw it; those are the availability axes.
- **Packs never see a denial reason.** `decide()` keeps the exact reason for the audit; packs call
  `dispose()` and get `render` / `fallback` / `omit`. For a fragment whose existence may not be
  acknowledged, missing capability, insufficient exposure and true absence **all collapse to
  `omit`** — the collapse is the default inside one function, not a branch a pack opts into.
- A catalogued value is static. A fragment may declare `fill` for context integers
  (`{ceiling}`, `{exposure}`, `{level}` — Service and above only, enforced by `A4`) or a
  pack-supplied count via `fills(ctx)`.
- Classify by **provenance, not spelling**. "2 reservations" is legitimate data; the lexical lint is
  advisory and has no digit rule.
- Every representation channel is a disclosure channel. Text, numerals, geometry, ordering, colour,
  animation, accessibility metadata and DOM structure all represent the same facts, and each must
  stay within the precision the level permits — geometry is quantized, not exempt.
- Every required field declares a coherent `fallback`. A guard failure degrades that one field —
  it never blanks critical UI.
- Action labels are product copy: a pack ships its own `agency` table. The law is that actions are
  projected from the role, not that every product uses the same words.
- A pack may add its own `cases` (extra axes) and its own checks via `D.registerChecks()`.

### Tests are the source, the card is a renderer

`_doctrine/doctrine.js` engine · `_doctrine/fixtures.js` case matrix · `_doctrine/tests.js`
assertions · `<template>/checks.js` per-pack assertions. The Conformance card renders `audit()`;
it does not define cases or rules.

Five independent test classes: **A** structural validity (duplicate declarations, unknown selector
IDs, missing policy axes, missing required-field fallbacks, secret-on-required, actions ungated) ·
**B** fragment policy (every fragment × every context, no selector) · **C** selector behaviour (known
contexts choose expected IDs) · **D** reachability (every production fragment is selected somewhere;
canaries never are) · **E** deliberate failure (a canary projected below its floor really does fall
back, record the reason and fail a verdict). Plus **N**, non-visual leakage: ARIA, title, data-*,
form values, geometry and metadata are read off the **view model**, not trusted in markup. Adding a template means one `require` in
`_doctrine/run-checks.js` **and** one `<script>` in `guidelines/doctrine-conformance.card.html` —
they must stay in agreement.

Extend the matrix with `F.withCapability` / `F.withCeilingGrant`; never hand-build a case list.
A **capability** grant (export, adjust, freeze) must not change rows or columns. A **ceiling** grant
travels on `ceilingGrant` and legitimately may — that separation is what makes the rule testable.

CI: `node templates/_doctrine/run-checks.js` — exits non-zero on any failure or guard suppression.

## Review cards

`guidelines/doctrine-review-*.card.html` render the real template DCs in iframes, one context per
tile, through `guidelines/review-frames.js`. Badges and axis figures come from `D.resolve()` — never
typed. Two rules the loader exists to enforce: load at most three frames at once, and keep pushing
props until the frame reports content. A DC that mounts before its own doctrine scripts arrive
renders the static template with every hole empty and has no reason to re-render, which reviews as
a design fault when it is a loading fault.

Iframe content does not survive DOM-recapture screenshots or PDF export. Review these cards live;
verify their contents by reading the frames' DOM, not by looking at a capture.

## Environment

`environment.css` owns the interior of the cylinder, and it is deliberately thin. The place arrives
as a render or photograph in the **plate**; CSS supplies only sky behind, the Lado-Acheson axis
across, one arc closing overhead, and the overlays that seat the image in the page.

- **Layer order**: plate → grid → axis → curve → scrim → veil → anno. Every layer is optional; a
  plate and a veil is a legitimate composition.
- **Never lay the CSS axis over a plate.** A render carries its own light in perspective, and a
  horizontal line across it reads as a printing fault. The axis layer is for plate-less frames.
- **No CSS-drawn architecture.** An earlier version built the whole panorama in gradients — terraces,
  canal, crowd marks, inverted far side — and it read as an airport diagram. Gradients cannot carry
  luxury architecture. If the design needs the place, it needs a picture of the place.
- Exposure tunes the frame, never the asset: `--fs-env-plate-filter` desaturates at Service and
  Ledger, `--fs-env-bloom` steps down, `.fs-env-grid` appears. One canonical image, four precisions.

Annotations inside an environment are copy: in a product they project through Exposure.

## Registers

`data-register="light"` and `data-register="deep"` both exist so registers nest in both
directions. Never hardcode a hex to get a dark panel inside a light page.

`data-exposure="0..3"` sets page rhythm (`--fs-pad-page`, `--fs-gap-stack`). Don't set padding
per template.
