// level-contract — the Observatory level treaty (obs-level/1).
// ONE invariant list enforced on both sides of the seam: trace-gen validates
// before writing, game.html validates (inlined copy, CONTRACT_REV-stamped)
// before loading. Evolution rule: unknown fields ignored, missing-optional
// defaulted, missing-required → reject whole. (Panel fill W1-4 · obs-panel-20260611)
export const CONTRACT_REV = 1;
export const SCHEMA = "obs-level/1";
export const VERDICTS = ["APPROVED", "CHECKPOINT", "EMITTED", "REJECTED", "DENIED"];

export function validateLevel(L) {
  const errs = [];
  const E = (m) => errs.push(m);
  if (!L || typeof L !== "object") return { ok: false, errors: ["level is not an object"] };
  if (!Array.isArray(L.rooms) || !L.rooms.length) E("rooms[] missing or empty");
  if (!Array.isArray(L.seams)) E("seams[] missing");
  if (!Array.isArray(L.envelopes) || !L.envelopes.length) E("envelopes[] missing or empty");
  if (errs.length) return { ok: false, errors: errs };
  const n = L.rooms.length;
  L.rooms.forEach((r, i) => {
    if (r.id !== i) E(`rooms[${i}].id=${r.id} — ids must be contiguous from 0`);
    if (!Number.isInteger(r.gx) || !Number.isInteger(r.gy)) E(`rooms[${i}] gx/gy must be integers`);
    if (typeof r.live !== "number" || r.live < 0 || r.live > 1) E(`rooms[${i}].live must be in [0,1]`);
    if (typeof r.name !== "string" || !r.name.length || r.name.length > 28) E(`rooms[${i}].name must be 1..28 chars`);
  });
  const seen = new Set();
  L.seams.forEach((s, i) => {
    if (!Array.isArray(s) || s.length !== 2 || s.some(x => !Number.isInteger(x) || x < 0 || x >= n))
      return E(`seams[${i}] endpoints must be valid room ids`);
    const k = Math.min(...s) + ":" + Math.max(...s);
    if (seen.has(k)) E(`seams[${i}] duplicate seam ${k}`); seen.add(k);
  });
  const hasSeam = (a, b) => L.seams.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  L.envelopes.forEach((h, i) => {
    if (!Number.isInteger(h.from) || h.from < 0 || h.from >= n) E(`envelopes[${i}].from invalid`);
    if (!Number.isInteger(h.to) || h.to < 0 || h.to >= n) E(`envelopes[${i}].to invalid`);
    if (h.from === h.to) E(`envelopes[${i}] from===to`);
    else if (Number.isInteger(h.from) && Number.isInteger(h.to) && !hasSeam(h.from, h.to))
      E(`envelopes[${i}] has no seam ${h.from}→${h.to} (hopPath would walk uncarved wall)`);
    if (h.verdict !== undefined && !VERDICTS.includes(h.verdict)) E(`envelopes[${i}].verdict '${h.verdict}' not in enum {${VERDICTS.join(",")}}`);
    if (h.keepers !== undefined && (!Number.isInteger(h.keepers) || h.keepers < 1 || h.keepers > 5)) E(`envelopes[${i}].keepers must be int 1..5`);
    const g = h.transform?.badge;
    if (g !== undefined && (typeof g !== "string" || [...g].length < 1 || [...g].length > 2)) E(`envelopes[${i}].transform.badge must be 1..2 chars`);
    if (h.wave !== undefined && !Number.isInteger(h.wave)) E(`envelopes[${i}].wave must be an integer`);
  });
  return { ok: errs.length === 0, errors: errs };
}

// Default the optionals in place (evolution rule). Returns the level.
export function defaultLevel(L) {
  L.meta = L.meta ?? {};
  L.meta.contract_rev = L.meta.contract_rev ?? CONTRACT_REV;
  L.envelopes.forEach((h, i) => {
    h.verdict = h.verdict ?? "EMITTED";
    h.keepers = h.keepers ?? 1;
    h.wave = h.wave ?? i;
    h.transform = h.transform ?? { badge: "✦", line: "the handoff lands" };
  });
  return L;
}
