# Space, Form, Elevation, Grid & Motion

The structural machine beneath the paradise. Square, gridded, precise — with organic softness held in reserve for hospitality/environmental contexts only.

---

## 1. Spacing scale

4px sub-unit, 8px rhythm. Emit as `--fs-space-*` primitives.

| Token | px | Typical |
|---|---|---|
| `--fs-space-0` | 0 | — |
| `--fs-space-1` | 4 | icon gaps, hairline insets |
| `--fs-space-2` | 8 | tight stacks, chip padding |
| `--fs-space-3` | 12 | control padding |
| `--fs-space-4` | 16 | base unit — card padding, list gap |
| `--fs-space-5` | 20 | — |
| `--fs-space-6` | 24 | section inner gap |
| `--fs-space-8` | 32 | card gap, block spacing |
| `--fs-space-10` | 40 | — |
| `--fs-space-12` | 48 | section padding |
| `--fs-space-16` | 64 | band rhythm |
| `--fs-space-20` | 80 | large band |
| `--fs-space-24` | 96 | hero |
| `--fs-space-32` | 128 | full-bleed section |

---

## 2. Form philosophy — radius

**Default is square.** The system is engineered; corners are architectural. A single small radius exists for interactive affordance; generous radii and pills are a *context privilege*.

| Token | Value | Use |
|---|---|---|
| `--fs-radius-none` | 0 | **default** — cards, panels, bands, inputs, terminals, wayfinding |
| `--fs-radius-sm` | 2px | interactive controls (buttons, toggles) — just enough to read as pressable |
| `--fs-radius-md` | 4px | ⚖ reserved — soft cards in hospitality context only |
| `--fs-radius-pill` | 999px | organic-only — spa/garden chips, guest avatars, water-feature UI |

Rule: if you're unsure, it's square. Roundness must be *earned* by an organic/hospitality context (`data-context`), the same way darkness is earned.

---

## 3. Lines & hairlines

Thin sunset rules are a signature (see the axial device, the board dividers, table gridlines).

| Token | Value |
|---|---|
| `--fs-hairline` | 1px solid `--fs-line-hairline` (sunset @ low alpha / lunar concrete) |
| `--fs-rule-structural` | 1px solid `--fs-line-structural` (lunar concrete) |
| `--fs-rule-axial` | the wordmark device — 1px sunset rules flanking the star |

Prefer hairlines + surface tints for separation **before** shadow.

---

## 4. Elevation

A **light** system. Elevation = mineral tint + hairline first, soft low shadow second. **No glow** in the base system (glow is Nightlife-context only).

| Token | Composition | Use |
|---|---|---|
| `--fs-elev-0` | flat, on `surface-base` | page, bands |
| `--fs-elev-1` | `surface-raised` + `--fs-hairline` + `0 1px 2px rgba(10,19,26,.06)` | cards, list rows |
| `--fs-elev-2` | `surface-raised` + hairline + `0 4px 16px rgba(10,19,26,.08)` | popovers, menus |
| `--fs-elev-3` | + `0 12px 40px rgba(10,19,26,.12)` | modals, overlays |
| `--fs-elev-sky` | the Lado-Acheson gradient wash | **hero only** — the one signature "glow", reserved |

Shadows use Deep-Space-Ink-tinted rgba, never pure black — keeps the warm mineral cast.

---

## 5. Grid & layout

The boards are built on a **banded** system: full-width horizontal bands, numbered sections, and a recurring left-content / right-image split. Codify:

- **Base grid:** 12 columns, `--fs-space-6` (24px) gutter, max content width ~1440 for boards / ~1200 for product.
- **Band primitive:** full-bleed horizontal section, `--fs-space-16`–`20` vertical rhythm, optional numeric index (`01`) in the left margin (Cannes Sky, display face).
- **Split primitive:** content-left / image-right (or reverse), image feathered into the mineral base at the seam (see `brand-and-icons.md` imagery).
- **Authority footer band:** constant Deep Space strip carrying tagline + JP + coordinates + monogram — the recurring "you are inside the machine" signature.
- **The gravity axis (wayfinding order):** Freeside spins, so gravity peaks at the center and tapers to zero-g at the tips. Wayfinding is therefore **one-dimensional** — order every directory, level list, and map legend along that axis rather than alphabetically:

  `ZERO-G TIP · hang gliding` → `LOW-G` → `PROMENADE · full g, recreation` → `LOW-G` → `SPINDLE TIP · Villa Straylight`

  Encode position as a `g` value in mono (tier 07) beside level names (`LV 12 · 0.4g`). The center is public and light-register; both tips are restricted — one recreational, one authority.
- **Z-index scale:** `--fs-z-base 0`, `-nav 100`, `-overlay 400`, `-modal 500`, `-toast 700`.

---

## 6. Motion

Restrained and *engineered* — precise, never bouncy. Motion is a machine running smoothly.

| Token | Value |
|---|---|
| `--fs-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--fs-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` |
| `--fs-dur-fast` | 160ms — hovers, toggles |
| `--fs-dur-base` | 240ms — reveals, transitions |
| `--fs-dur-slow` | 420ms — overlays, register shifts |
| `--fs-dur-signature` | 1200ms+ — the Lado-Acheson sun sweep |

- **Signature motion:** the axial line "draws" and the star ignites on brand reveals (the artificial sun coming up). Use sparingly — hero and load only.
- Respect `prefers-reduced-motion`: drop the sun sweep and all non-essential transitions.
- Register/context changes cross-fade at `--fs-dur-slow`; no slide/scale.
