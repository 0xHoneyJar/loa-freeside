#!/usr/bin/env python3
"""Quarantine digest — Sprint-1 T4 · FR-1 (active surfacing).

Prints a Markdown digest of the manifest's quarantine[] list for the PR comment
and the CI step summary. Read-only; the teeth live in tools/quarantine/gate.sh.
"""
import sys
import yaml

MANIFEST = sys.argv[1] if len(sys.argv) > 1 else "tools/extraction/extraction-manifest.yaml"

doc = yaml.safe_load(open(MANIFEST)) or {}
entries = doc.get("quarantine") or []

out = ["## 🟡 Quarantine Report", ""]
out.append(f"**{len(entries)}** test file(s) are quarantined (proven-STRANDED, excluded from required CI):")
out.append("")
if entries:
    for q in entries:
        out.append(
            f"- `{q.get('file')}` — owner **{q.get('owner', '?')}**, "
            f"expires **{q.get('expiry', '?')}**, bead `{q.get('bead', '?')}`"
        )
        reason = (q.get("reason") or "").strip()
        if reason:
            out.append(f"  - _{reason}_")
else:
    out.append("_(none — the required suite excludes nothing)_")
out.append("")
out.append(
    "_Teeth (expiry · owner · signature-drift) enforced by the required "
    "`Manifest + Quarantine Gate` in pr-validation. This report is informational._"
)
print("\n".join(out))
