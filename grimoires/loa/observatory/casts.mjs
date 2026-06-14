// casts.mjs — the canonical construct → sprite map. Single source of truth for
// the Observatory's character binding, shared by sim-gen.mjs and trace-gen.mjs
// (hoisted out of sim-gen so the two never drift). A construct's FACE is bound to
// its IDENTITY, never to its position in the run — that positional binding was
// bug-20260613-fee9d9 (gecko rendering as the `noether` character).
export const CASTS = [
  ["noether", "noether"], ["the-arcade", "arcade"], ["protocol", "proto"], ["gecko", "gecko"],
  ["vocabulary-bank", "vocab"], ["the-easel", "easel"], ["k-hole", "khole"], ["artisan", "artisan"],
];

const SPRITES = CASTS.map(([, spr]) => spr);
const BY_CONSTRUCT = new Map(CASTS.map(([construct, spr]) => [construct, spr]));

// Resolve a construct slug to its sprite. Mapped constructs get their canonical
// face; unmapped constructs get a DETERMINISTIC name-hash sprite (stable across
// folds) — never SPRS[i]. Identity decides the face, so order never can.
export function sprFor(slug) {
  const key = String(slug).replace(/_/g, "-");
  if (BY_CONSTRUCT.has(key)) return BY_CONSTRUCT.get(key);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SPRITES[h % SPRITES.length];
}
