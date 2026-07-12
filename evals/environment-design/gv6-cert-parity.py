#!/usr/bin/env python3
"""
gv6-cert-parity.py — GV6 cross-org cert_hash recompute (issue AITOBIAS04/echelon-core#178).

The "any-party re-derivation" side of the GV6 byte-match gate: given an Echelon
verdict-integrity envelope, recompute its cert_hash with OUR canonicalizer and
byte-match it against the published expectation. A cert that disagrees with the
re-run is invalid by definition — this module is the re-run.

Canonicalizer REUSE (noether: never reinvent crypto): loa_cheval.jcs.canonicalize
(RFC 8785) — the SAME core the audit-envelope and genome hash chains use. Echelon's
`jcs-subset/v0` is RFC 8785 narrowed to a validated input domain (FORGE spec
JCS_SUBSET_V0.md @ 20626a23, §4: byte-identical on that domain), so a faithful
8785 impl byte-matches by construction. Confirmed 2026-07-03 against the shared
vector: full parity (canonical bytes, sha256, cert_hash, verdict_id) plus 27/27
input-bearing FORGE primitive vectors.

Known domain delta (disclosed on #178): loa_cheval.jcs does NOT enforce the
subset's NFC-string reject — non-NFC input is canonicalized verbatim rather than
refused. Cannot cause a hash mismatch on producer-valid envelopes (Echelon rejects
non-NFC at production); it only means WE are not the domain gate.

cert_hash recipe (NORMATIVE, from jcs-subset-v0-rule.md §3):
  1. take the served envelope document
  2. remove forge_seam.calibration_ref (ONLY that key — it embeds cert_hash itself)
  3. canonicalize → sha256 → "sha256:" + hex

Usage:
  gv6-cert-parity.py verify --vector <gv6-cert-vector.json> [--json]
      → full parity: strip check, canonical-byte match (localizes the first
        diverging offset), sha256, cert_hash, independent verdict_id recompute.
  gv6-cert-parity.py primitives --vectors <jcs-test-vectors.json> [--json]
      → run FORGE's primitive canonical_vectors through loa_cheval.jcs.
        Builder-token vectors (no JSON-representable "input") are skipped.

Exit: 0 parity · 1 mismatch · 2 usage/missing file · 70 cannot import loa_cheval.jcs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys
from pathlib import Path


# --- reuse the canonical RFC-8785 core (never reinvent) ----------------------
# Same resolver as genome-chain.py: walk UP looking for a loa_cheval adapters
# dir so this works from evals/ in loa-freeside or any vendored layout.
def _find_adapters() -> "Path | None":
    env = os.environ.get("LOA_GENOME_ADAPTERS")
    if env and (Path(env) / "loa_cheval" / "jcs.py").is_file():
        return Path(env)
    here = Path(__file__).resolve()
    for base in [here.parent, here.parent.parent, *here.parents]:
        for cand in (base / "adapters", base / ".claude" / "adapters"):
            if (cand / "loa_cheval" / "jcs.py").is_file():
                return cand
    return None


_ADAPTERS = _find_adapters()
if _ADAPTERS is not None:
    sys.path.insert(0, str(_ADAPTERS))

try:
    from loa_cheval.jcs import canonicalize as _jcs_canonicalize
except Exception as exc:  # fail LOUD — no parity verdict without the core
    print(f"gv6-cert-parity: FATAL — cannot import loa_cheval.jcs (RFC-8785 core): {exc}",
          file=sys.stderr)
    sys.exit(70)


def _canon_bytes(value) -> bytes:
    out = _jcs_canonicalize(value)
    return out if isinstance(out, bytes) else out.encode("utf-8")


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cert_hash(envelope: dict) -> str:
    """The §3 recipe: strip forge_seam.calibration_ref, canonicalize, sha256."""
    stripped = copy.deepcopy(envelope)
    stripped.get("forge_seam", {}).pop("calibration_ref", None)
    return "sha256:" + _sha256_hex(_canon_bytes(stripped))


def _first_divergence(ours: bytes, expected: bytes) -> str:
    off = next((i for i, (a, b) in enumerate(zip(ours, expected)) if a != b),
               min(len(ours), len(expected)))
    ctx_o = ours[max(0, off - 30):off + 30].decode("utf-8", "replace")
    ctx_e = expected[max(0, off - 30):off + 30].decode("utf-8", "replace")
    return (f"first divergence at byte {off} (len {len(ours)} vs {len(expected)}); "
            f"ours[..]={ctx_o!r} expected[..]={ctx_e!r}")


def cmd_verify(args) -> int:
    v = json.loads(Path(args.vector).read_text())
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "pass": ok, "detail": detail})

    # 1. our strip must equal the published stripped_document
    stripped = copy.deepcopy(v["envelope_document"])
    stripped.get("forge_seam", {}).pop("calibration_ref", None)
    check("strip_matches_stripped_document", stripped == v["stripped_document"])

    # 2. canon-layer byte match FIRST — localizes number/sort divergence pre-hash
    ours = _canon_bytes(stripped)
    expected = v["expected_canonical_utf8"].encode("utf-8")
    if ours == expected:
        check("canonical_bytes", True, f"{len(ours)} bytes")
    else:
        check("canonical_bytes", False, _first_divergence(ours, expected))

    # 3. hash layer
    digest = _sha256_hex(ours)
    check("canonical_sha256",
          digest == v["expected_canonical_sha256"].removeprefix("sha256:"), digest)
    check("cert_hash", "sha256:" + digest == v["expected_cert_hash"], "sha256:" + digest)

    # 4. independent end-to-end recipe over the served envelope
    check("cert_hash_recipe_e2e", cert_hash(v["envelope_document"]) == v["expected_cert_hash"])

    # 5. verdict_id = canonicalize({"subject", "factors"}) per the rule doc
    if "expected_verdict_id" in v:
        vd = {"subject": v["envelope_document"]["subject"],
              "factors": v["envelope_document"]["factors"]}
        vdig = "sha256:" + _sha256_hex(_canon_bytes(vd))
        check("verdict_id_recompute", vdig == v["expected_verdict_id"], vdig)

    failed = [c for c in checks if not c["pass"]]
    result = {"match": not failed, "vector_id": v.get("vector_id"),
              "canon_strategy": "loa_cheval.jcs (RFC 8785) vs jcs-subset/v0",
              "checks": checks}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for c in checks:
            print(f"{'PASS' if c['pass'] else 'FAIL'}  {c['check']}"
                  + (f" — {c['detail']}" if c["detail"] else ""))
        print(f"\nRESULT: {'MATCH' if not failed else f'MISMATCH ({len(failed)} failed)'}")
    return 0 if not failed else 1


def cmd_primitives(args) -> int:
    v = json.loads(Path(args.vectors).read_text())
    passed = skipped = 0
    fails: list[dict] = []
    for tv in v["canonical_vectors"]:
        if "input" not in tv:  # builder-token: not JSON-representable
            skipped += 1
            continue
        out = _canon_bytes(tv["input"]).decode("utf-8")
        if out == tv["canonical"]:
            passed += 1
        else:
            fails.append({"name": tv["name"], "got": out, "expected": tv["canonical"]})
    result = {"match": not fails, "passed": passed, "failed": len(fails),
              "skipped_builder_tokens": skipped, "failures": fails}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"primitives: {passed} pass / {len(fails)} fail / {skipped} skipped (builder-token)")
        for f in fails:
            print(f"  FAIL {f['name']}: got {f['got']!r} expected {f['expected']!r}")
    return 0 if not fails else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    sub = p.add_subparsers(dest="cmd", required=True)
    pv = sub.add_parser("verify", help="full parity against a gv6 cert vector")
    pv.add_argument("--vector", required=True)
    pv.add_argument("--json", action="store_true")
    pp = sub.add_parser("primitives", help="FORGE primitive canonical vectors")
    pp.add_argument("--vectors", required=True)
    pp.add_argument("--json", action="store_true")
    args = p.parse_args()
    try:
        return cmd_verify(args) if args.cmd == "verify" else cmd_primitives(args)
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        print(f"gv6-cert-parity: error — {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
