#!/usr/bin/env bash
# CR-005 collection-protocol compatibility matrix entrypoint.
#
# Invoked identically from loa-freeside, sonar-api, and freeside-dashboard once
# each consumer pins an artifact produced by `pnpm run pack:artifact`.
#
# Usage (from this package root):
#   ./scripts/ci-compat.sh
#
# Consumer mode (verify a pinned tarball + sidecar before install/tests):
#   COLLECTION_PROTOCOL_TARBALL=/path/to/pkg.tgz \
#   COLLECTION_PROTOCOL_MANIFEST=/path/to/pkg.manifest.json \
#   ./scripts/ci-compat.sh --verify-only
set -euo pipefail

TAG="[collection-protocol-compat]"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERIFY_ONLY=false
if [[ "${1:-}" == "--verify-only" ]]; then
  VERIFY_ONLY=true
fi

echo "$TAG root=$ROOT"

if [[ "$VERIFY_ONLY" == "true" ]]; then
  : "${COLLECTION_PROTOCOL_TARBALL:?set COLLECTION_PROTOCOL_TARBALL}"
  if [[ -n "${COLLECTION_PROTOCOL_MANIFEST:-}" ]]; then
    node "$ROOT/scripts/verify-artifact.mjs" \
      --tarball "$COLLECTION_PROTOCOL_TARBALL" \
      --manifest "$COLLECTION_PROTOCOL_MANIFEST" \
      ${COLLECTION_PROTOCOL_EXPECT_VERSION:+--expect-version "$COLLECTION_PROTOCOL_EXPECT_VERSION"} \
      ${COLLECTION_PROTOCOL_EXPECT_MAJOR:+--expect-major "$COLLECTION_PROTOCOL_EXPECT_MAJOR"} \
      ${COLLECTION_PROTOCOL_EXPECT_MINOR:+--expect-minor "$COLLECTION_PROTOCOL_EXPECT_MINOR"}
  elif [[ -n "${COLLECTION_PROTOCOL_LEGACY_SHA256:-}" ]]; then
    node "$ROOT/scripts/verify-artifact.mjs" \
      --tarball "$COLLECTION_PROTOCOL_TARBALL" \
      --legacy-sha256 "$COLLECTION_PROTOCOL_LEGACY_SHA256"
  else
    echo "$TAG ERROR: set COLLECTION_PROTOCOL_MANIFEST or COLLECTION_PROTOCOL_LEGACY_SHA256" >&2
    exit 2
  fi
  echo "$TAG verify-only passed"
  exit 0
fi

expect_fail() {
  local label="$1"
  shift
  echo "$TAG probe fail: $label"
  if "$@"; then
    echo "$TAG ERROR: expected failure for $label" >&2
    exit 1
  fi
}

echo "$TAG frozen install"
pnpm install --frozen-lockfile

echo "$TAG typecheck"
pnpm run typecheck

echo "$TAG unit tests"
pnpm test

SOURCE_COMMIT="$(git rev-parse HEAD)"
export SOURCE_COMMIT

# Keep pack outputs outside package `.tmp` so `pnpm run clean` between epochs
# cannot delete the prior artifact under comparison.
PACK_ROOT="${TMPDIR:-/tmp}/collection-protocol-compat-$$"
mkdir -p "$PACK_ROOT"
trap 'rm -rf "$PACK_ROOT"' EXIT

echo "$TAG isolated pack epoch A (clean checkout-equivalent staging)"
OUT_A="$PACK_ROOT/epoch-a"
rm -rf "$OUT_A"
mkdir -p "$OUT_A"
pnpm run clean
pnpm run pack:artifact -- --out "$OUT_A" --source-commit "$SOURCE_COMMIT"

echo "$TAG isolated pack epoch B (second clean epoch)"
OUT_B="$PACK_ROOT/epoch-b"
rm -rf "$OUT_B"
mkdir -p "$OUT_B"
pnpm run clean
pnpm run pack:artifact -- --out "$OUT_B" --source-commit "$SOURCE_COMMIT"

TARBALL_A="$(ls "$OUT_A"/*.tgz)"
TARBALL_B="$(ls "$OUT_B"/*.tgz)"
MANIFEST_A="$(ls "$OUT_A"/*.manifest.json)"
MANIFEST_B="$(ls "$OUT_B"/*.manifest.json)"

SHA_A="$(shasum -a 256 "$TARBALL_A" | awk '{print $1}')"
SHA_B="$(shasum -a 256 "$TARBALL_B" | awk '{print $1}')"
if [[ "$SHA_A" != "$SHA_B" ]]; then
  echo "$TAG ERROR: non-reproducible artifact across isolated epochs ($SHA_A vs $SHA_B)" >&2
  exit 1
fi
if ! cmp -s "$MANIFEST_A" "$MANIFEST_B"; then
  echo "$TAG ERROR: non-reproducible manifest across isolated epochs" >&2
  exit 1
fi
if ! cmp -s "$TARBALL_A" "$TARBALL_B"; then
  echo "$TAG ERROR: tarball bytes differ across isolated epochs" >&2
  exit 1
fi

echo "$TAG seeded stale dist must not enter the artifact"
STALE_OUT="$PACK_ROOT/epoch-stale"
rm -rf "$STALE_OUT"
mkdir -p "$STALE_OUT"
# Seed stale outputs into checkout dist. pack:artifact builds the packer and
# the package in isolated staging trees and must ignore checkout dist entirely.
pnpm run build
mkdir -p "$ROOT/dist/stale-seed"
echo '{"stale":true}' > "$ROOT/dist/stale-seed/extra-declaration.json"
echo 'export const stale = true' > "$ROOT/dist/__stale_decl.js"
pnpm run pack:artifact -- --out "$STALE_OUT" --source-commit "$SOURCE_COMMIT"
STALE_TGZ="$(ls "$STALE_OUT"/*.tgz)"
STALE_SHA="$(shasum -a 256 "$STALE_TGZ" | awk '{print $1}')"
if [[ "$STALE_SHA" != "$SHA_A" ]]; then
  echo "$TAG ERROR: seeded-stale pack diverged from clean isolated pack" >&2
  exit 1
fi
if tar -tzf "$STALE_TGZ" | grep -q 'stale-seed\|__stale_decl'; then
  echo "$TAG ERROR: stale dist file leaked into tarball" >&2
  exit 1
fi

echo "$TAG modified checkout dist/harness/pack.js must not execute"
POISON_OUT="$PACK_ROOT/epoch-poison"
rm -rf "$POISON_OUT"
mkdir -p "$POISON_OUT"
PACK_JS="$ROOT/dist/harness/pack.js"
if [[ ! -f "$PACK_JS" ]]; then
  pnpm run build
fi
cp "$PACK_JS" "$PACK_ROOT/pack.js.bak"
cat >> "$PACK_JS" <<'EOF'
export const packArtifact = () => {
  throw new Error("CHECKOUT_DIST_EXECUTED");
};
EOF
pnpm run pack:artifact -- --out "$POISON_OUT" --source-commit "$SOURCE_COMMIT"
mv "$PACK_ROOT/pack.js.bak" "$PACK_JS"
POISON_TGZ="$(ls "$POISON_OUT"/*.tgz)"
POISON_SHA="$(shasum -a 256 "$POISON_TGZ" | awk '{print $1}')"
if [[ "$POISON_SHA" != "$SHA_A" ]]; then
  echo "$TAG ERROR: poisoned checkout dist changed pack output" >&2
  exit 1
fi
if ! cmp -s "$TARBALL_A" "$POISON_TGZ"; then
  echo "$TAG ERROR: poisoned checkout dist changed pack bytes" >&2
  exit 1
fi

echo "$TAG archive member negatives (preflight before extract)"
python3 - "$TARBALL_A" "$PACK_ROOT" <<'PY'
import io, os, sys, tarfile, tempfile, shutil, json, hashlib

src, pack_root = sys.argv[1], sys.argv[2]
epoch_a = os.path.dirname(src)
manifest_file = next(p for p in os.listdir(epoch_a) if p.endswith(".manifest.json"))
manifest = json.load(open(os.path.join(epoch_a, manifest_file)))

nfc_cafe = "caf\u00e9"
nfd_cafe = "cafe\u0301"

def write_pax_record(key, value):
    body = f"{key}={value}\n".encode("utf-8")
    length = len(body)
    while True:
        prefix = f"{length} ".encode("utf-8")
        total = len(prefix) + len(body)
        if total == length:
            return prefix + body
        length = total

def add_pax_header(out_tf, records, global_header=False):
    payload = b"".join(write_pax_record(k, v) for k, v in records.items())
    info = tarfile.TarInfo(name="././@PaxHeader")
    info.type = tarfile.XGLTYPE if global_header else tarfile.XHDTYPE
    info.size = len(payload)
    info.mtime = 0
    out_tf.addfile(info, io.BytesIO(payload))

def add_regular(out_tf, arcname, data, pax=None, global_pax=None):
    if global_pax:
        add_pax_header(out_tf, global_pax, global_header=True)
    if pax:
        add_pax_header(out_tf, pax, global_header=False)
    info = tarfile.TarInfo(name=arcname)
    info.type = tarfile.REGTYPE
    info.size = len(data)
    info.mtime = 0
    out_tf.addfile(info, io.BytesIO(data))

def build(mode, dest):
    work = tempfile.mkdtemp(prefix="cp-ci-evil-")
    try:
        with tarfile.open(src, "r:gz") as tf:
            tf.extractall(work)
        pkg = os.path.join(work, "package")

        def iter_files():
            for root, _dirs, files in os.walk(pkg):
                for name in files:
                    path = os.path.join(root, name)
                    yield path, os.path.relpath(path, work)

        def add_tree(out_tf):
            for path, arc in iter_files():
                out_tf.add(path, arcname=arc)

        fmt = tarfile.GNU_FORMAT if mode == "gnu_longname_undeclared" else tarfile.USTAR_FORMAT
        with tarfile.open(dest, "w:gz", format=fmt) as out_tf:
            if mode == "undeclared_root":
                add_tree(out_tf)
                evil = os.path.join(work, "EVIL.txt")
                open(evil, "w").write("x\n")
                out_tf.add(evil, arcname="EVIL.txt")
            elif mode == "abs_symlink":
                add_tree(out_tf)
                link = tarfile.TarInfo("package/abs-link")
                link.type = tarfile.SYMTYPE
                link.linkname = "/tmp/evil"
                out_tf.addfile(link)
            elif mode == "rel_symlink":
                add_tree(out_tf)
                link = tarfile.TarInfo("package/rel-link")
                link.type = tarfile.SYMTYPE
                link.linkname = "package.json"
                out_tf.addfile(link)
            elif mode == "hardlink":
                first = None
                for path, arc in iter_files():
                    out_tf.add(path, arcname=arc)
                    if first is None:
                        first = arc
                link = tarfile.TarInfo("package/hard-link-extra")
                link.type = tarfile.LNKTYPE
                link.linkname = first
                out_tf.addfile(link)
            elif mode == "duplicate_member":
                first_path = first_arc = None
                for path, arc in iter_files():
                    out_tf.add(path, arcname=arc)
                    if first_path is None:
                        first_path, first_arc = path, arc
                out_tf.add(first_path, arcname=first_arc)
            elif mode == "case_collide":
                add_tree(out_tf)
                collide = os.path.join(work, "collide-bytes")
                open(collide, "w").write("x\n")
                out_tf.add(collide, arcname="package/Package.json")
            elif mode == "pax_local_undeclared":
                for path, arc in iter_files():
                    data = open(path, "rb").read()
                    if arc == "package/package.json":
                        add_regular(
                            out_tf,
                            "package/package.json",
                            data,
                            pax={"path": "package/UNDECLARED.json"},
                        )
                    else:
                        add_regular(out_tf, arc, data)
            elif mode == "pax_global_undeclared":
                first = True
                for path, arc in iter_files():
                    data = open(path, "rb").read()
                    if first:
                        add_regular(
                            out_tf,
                            arc,
                            data,
                            global_pax={"path": "package/UNDECLARED.json"},
                        )
                        first = False
                    else:
                        add_regular(out_tf, arc, data)
            elif mode == "gnu_longname_undeclared":
                long_name = "package/" + ("u" * 120) + "-UNDECLARED.json"
                for path, arc in iter_files():
                    data = open(path, "rb").read()
                    info = tarfile.TarInfo(
                        name=long_name if arc == "package/package.json" else arc
                    )
                    info.type = tarfile.REGTYPE
                    info.size = len(data)
                    info.mtime = 0
                    out_tf.addfile(info, io.BytesIO(data))
            elif mode == "malformed_pax":
                for path, arc in iter_files():
                    data = open(path, "rb").read()
                    if arc == "package/package.json":
                        payload = b"999 path=package/package.json\n"
                        info = tarfile.TarInfo(name="././@PaxHeader")
                        info.type = tarfile.XHDTYPE
                        info.size = len(payload)
                        info.mtime = 0
                        out_tf.addfile(info, io.BytesIO(payload))
                        add_regular(out_tf, arc, data)
                    else:
                        add_regular(out_tf, arc, data)
            elif mode == "unicode_nfc_collide":
                add_tree(out_tf)
                a = os.path.join(work, "nfc-bytes")
                b = os.path.join(work, "nfd-bytes")
                open(a, "wb").write(b"a\n")
                open(b, "wb").write(b"b\n")
                out_tf.add(a, arcname=f"package/{nfc_cafe}.json")
                out_tf.add(b, arcname=f"package/{nfd_cafe}.json")
            elif mode == "normalized_manifest_mismatch":
                for path, arc in iter_files():
                    data = open(path, "rb").read()
                    if arc == "package/package.json":
                        add_regular(
                            out_tf,
                            "package/package.json",
                            data,
                            pax={"path": f"package/{nfd_cafe}-missing.json"},
                        )
                    else:
                        add_regular(out_tf, arc, data)
            else:
                raise SystemExit(mode)
    finally:
        shutil.rmtree(work, ignore_errors=True)

def ustar_header(name, size, typeflag, linkname=""):
    def enc(s, n):
        b = s.encode("utf-8") if isinstance(s, str) else s
        return b + b"\x00" * (n - len(b))
    def octal(v, n):
        s = oct(v)[2:]
        body = s.encode("ascii").rjust(n - 1, b"0") + b"\x00"
        if len(body) != n:
            body = (s + " ").encode("ascii").rjust(n, b"0")[:n]
        return body
    hdr = bytearray(512)
    hdr[0:100] = enc(name, 100)
    hdr[100:108] = octal(0o644, 8)
    hdr[108:116] = octal(0, 8)
    hdr[116:124] = octal(0, 8)
    hdr[124:136] = octal(size, 12)
    hdr[136:148] = octal(0, 12)
    hdr[148:156] = b"        "
    hdr[156] = ord(typeflag)
    hdr[157:257] = enc(linkname, 100)
    hdr[257:263] = b"ustar\x00"
    hdr[263:265] = b"00"
    hdr[265:297] = enc("root", 32)
    hdr[297:329] = enc("root", 32)
    hdr[329:337] = octal(0, 8)
    hdr[337:345] = octal(0, 8)
    chksum = sum(hdr) & 0o777777
    hdr[148:156] = octal(chksum, 8)
    return bytes(hdr)

def pad_blocks(data):
    rem = (512 - (len(data) % 512)) % 512
    return data + b"\x00" * rem

def build_mixed_raw(mode, dest):
    """Exact L/x and K/x probes where bsdtar and a PAX-wins parser disagree."""
    import gzip
    parts = []
    if mode == "mixed_gnu_pax_path":
        lp = b"package/gnu-evil.txt\x00"
        parts += [ustar_header("././@LongLink", len(lp), "L"), pad_blocks(lp)]
        payload = write_pax_record("path", "package/pax-safe.txt")
        parts += [ustar_header("././@PaxHeader", len(payload), "x"), pad_blocks(payload)]
        content = b"payload\n"
        parts += [ustar_header("package/short.txt", len(content), "0"), pad_blocks(content)]
    elif mode == "mixed_gnu_pax_linkpath":
        kp = b"package/gnu-target\x00"
        parts += [ustar_header("././@LongLink", len(kp), "K"), pad_blocks(kp)]
        payload = write_pax_record("linkpath", "package/pax-target")
        parts += [ustar_header("././@PaxHeader", len(payload), "x"), pad_blocks(payload)]
        parts += [ustar_header("package/link", 0, "2", linkname="short"), pad_blocks(b"")]
    else:
        raise SystemExit(mode)
    parts += [b"\x00" * 1024]
    with gzip.open(dest, "wb") as f:
        f.write(b"".join(parts))

modes = [
    "undeclared_root",
    "abs_symlink",
    "rel_symlink",
    "hardlink",
    "duplicate_member",
    "case_collide",
    "pax_local_undeclared",
    "pax_global_undeclared",
    "gnu_longname_undeclared",
    "malformed_pax",
    "unicode_nfc_collide",
    "normalized_manifest_mismatch",
]
for mode in modes:
    dest = os.path.join(pack_root, f"{mode}.tgz")
    build(mode, dest)
    digest = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    man = dict(manifest)
    man["artifact_sha256"] = digest
    man_path = os.path.join(pack_root, f"{mode}.manifest.json")
    json.dump(man, open(man_path, "w"), indent=2)
    open(man_path, "a").write("\n")
    print(mode, dest)

for mode in ("mixed_gnu_pax_path", "mixed_gnu_pax_linkpath"):
    dest = os.path.join(pack_root, f"{mode}.tgz")
    build_mixed_raw(mode, dest)
    digest = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    man = dict(manifest)
    man["artifact_sha256"] = digest
    man_path = os.path.join(pack_root, f"{mode}.manifest.json")
    json.dump(man, open(man_path, "w"), indent=2)
    open(man_path, "a").write("\n")
    print(mode, dest)
PY

for mode in \
  undeclared_root abs_symlink rel_symlink hardlink duplicate_member case_collide \
  pax_local_undeclared pax_global_undeclared gnu_longname_undeclared malformed_pax \
  unicode_nfc_collide normalized_manifest_mismatch \
  mixed_gnu_pax_path mixed_gnu_pax_linkpath
do
  expect_fail "archive $mode" \
    node "$ROOT/scripts/verify-artifact.mjs" \
      --tarball "$PACK_ROOT/$mode.tgz" \
      --manifest "$PACK_ROOT/$mode.manifest.json"
done

echo "$TAG nested manifest excess + equal duplicate JSON key"
NESTED_EXCESS="$OUT_A/nested-excess.manifest.json"
python3 - "$MANIFEST_A" "$NESTED_EXCESS" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
manifest["contract_schema"] = {
    **manifest["contract_schema"],
    "extra": True,
}
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "nested contract_schema excess" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$NESTED_EXCESS"

DUP_KEY="$OUT_A/dup-key.manifest.json"
python3 - "$MANIFEST_A" "$DUP_KEY" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src).read().strip()
# Inject an equal duplicate top-level key after opening brace.
if not text.startswith("{"):
    raise SystemExit("expected object")
injected = '{\n  "manifest_version": 1,\n  "manifest_version": 1,' + text[1:]
open(dst, "w").write(injected if injected.endswith("\n") else injected + "\n")
PY
expect_fail "equal duplicate JSON key" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$DUP_KEY"

echo "$TAG dirty source tree still packs but binds source_tree_sha256"
# Working tree is expected dirty during CR development; packing must succeed and
# record source_tree_sha256 so commit alone cannot claim clean identity.
DIRTY_OUT="$PACK_ROOT/epoch-dirty"
mkdir -p "$DIRTY_OUT"
DIRTY_JSON="$(node "$ROOT/scripts/pack-artifact.mjs" --out "$DIRTY_OUT" --source-commit "$SOURCE_COMMIT")"
echo "$DIRTY_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("source_tree_sha256"); print("ok: dirty pack bound", d["source_tree_sha256"][:12], "dirty=", d.get("dirty_source_tree"))'

echo "$TAG verify packed artifact"
node "$ROOT/scripts/verify-artifact.mjs" \
  --tarball "$TARBALL_A" \
  --manifest "$MANIFEST_A" \
  --expect-version "1.0.0" \
  --expect-major "1" \
  --expect-minor "0"

echo "$TAG tamper: artifact bytes"
TAMPER_TGZ="$OUT_A/tampered.tgz"
cp "$TARBALL_A" "$TAMPER_TGZ"
python3 - "$TAMPER_TGZ" <<'PY'
import sys
path = sys.argv[1]
data = bytearray(open(path, "rb").read())
data[-1] ^= 0xFF
open(path, "wb").write(data)
PY
expect_fail "tampered artifact" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TAMPER_TGZ" --manifest "$MANIFEST_A"

echo "$TAG tamper: fixture digest in manifest"
TAMPER_MANIFEST="$OUT_A/tampered.manifest.json"
python3 - "$MANIFEST_A" "$TAMPER_MANIFEST" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
key = next(iter(manifest["fixture_digests"]))
manifest["fixture_digests"][key] = "f" * 64
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "tampered fixture digest" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$TAMPER_MANIFEST"

echo "$TAG tamper: missing fixture digest entry"
MISSING_FIXTURE="$OUT_A/missing-fixture.manifest.json"
python3 - "$MANIFEST_A" "$MISSING_FIXTURE" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
key = next(iter(manifest["fixture_digests"]))
del manifest["fixture_digests"][key]
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "missing fixture entry" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$MISSING_FIXTURE"

echo "$TAG tamper: extra fixture digest entry"
EXTRA_FIXTURE="$OUT_A/extra-fixture.manifest.json"
python3 - "$MANIFEST_A" "$EXTRA_FIXTURE" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
manifest["fixture_digests"]["fixtures/__extra__.json"] = "a" * 64
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "extra fixture entry" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$EXTRA_FIXTURE"

echo "$TAG tamper: package_version 9.9.9 without expect pin"
TAMPER_VERSION="$OUT_A/version-999.manifest.json"
python3 - "$MANIFEST_A" "$TAMPER_VERSION" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
manifest["package_version"] = "9.9.9"
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "package_version 9.9.9" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$TAMPER_VERSION"

echo "$TAG tamper: contract schema 99/77 without expect pin"
TAMPER_SCHEMA="$OUT_A/schema-99-77.manifest.json"
python3 - "$MANIFEST_A" "$TAMPER_SCHEMA" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
manifest["contract_schema"] = {"major": 99, "minor": 77}
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "schema 99/77" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$TAMPER_SCHEMA"

echo "$TAG tamper: source_commit zero object without expect pin"
TAMPER_COMMIT="$OUT_A/zero-commit.manifest.json"
python3 - "$MANIFEST_A" "$TAMPER_COMMIT" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
manifest = json.load(open(src))
manifest["source_commit"] = "0" * 40
json.dump(manifest, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
PY
expect_fail "zero source_commit" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$TAMPER_COMMIT"

echo "$TAG expect-version 9.9.9 mismatch"
expect_fail "expect-version 9.9.9" \
  node "$ROOT/scripts/verify-artifact.mjs" \
    --tarball "$TARBALL_A" \
    --manifest "$MANIFEST_A" \
    --expect-version "9.9.9"

echo "$TAG pack rejects zero source commit"
expect_fail "pack zero commit" \
  node "$ROOT/scripts/pack-artifact.mjs" \
    --out "$PACK_ROOT/zero" \
    --source-commit "0000000000000000000000000000000000000000"

echo "$TAG pack rejects nonexistent source commit"
expect_fail "pack nonexistent commit" \
  node "$ROOT/scripts/pack-artifact.mjs" \
    --out "$PACK_ROOT/gone" \
    --source-commit "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

echo "$TAG fallback-mode (shared harness verifier) missing fixture still fails"
# CLI always loads the compiled harness verifyArtifact — prove missing fixture fails.
expect_fail "fallback-mode missing fixture" \
  node "$ROOT/scripts/verify-artifact.mjs" --tarball "$TARBALL_A" --manifest "$MISSING_FIXTURE"

echo "$TAG dependency direction (no consumer imports / no deps cycle)"
python3 - <<'PY'
from pathlib import Path
import re
root = Path(".")
pkg = __import__("json").loads((root / "package.json").read_text())
assert pkg.get("dependencies", {}) == {}, pkg.get("dependencies")
assert list(pkg.get("peerDependencies", {})) == ["effect"]
forbidden = (
    "freeside-dashboard",
    "sonar-api",
    "inventory-api",
    "@freeside/ordering",
    "@freeside/dashboard",
)
import_re = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")
scan_roots = [root / "src" / "harness", *(root / "src").glob("*.ts")]
for path in scan_roots:
    paths = [path] if path.is_file() else list(path.rglob("*.ts"))
    for file_path in paths:
        text = file_path.read_text()
        for module in import_re.findall(text):
            for token in forbidden:
                assert token not in module, f"{file_path} imports {module}"
print("ok: no consumer imports; peerDependencies=effect only")
PY

LEGACY_SHA="b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c"
if [[ -n "${COLLECTION_PROTOCOL_TARBALL:-}" ]]; then
  echo "$TAG legacy CR-003/CR-105 temporary pin still verifiable"
  node "$ROOT/scripts/verify-artifact.mjs" \
    --tarball "$COLLECTION_PROTOCOL_TARBALL" \
    --legacy-sha256 "${COLLECTION_PROTOCOL_LEGACY_SHA256:-$LEGACY_SHA}"
else
  echo "$TAG legacy pin record present (CR-003/CR-105)"
  python3 - <<'PY'
import json
from pathlib import Path
pin = json.loads(Path("pins/cr-003-temporary.pin.json").read_text())
assert pin["mode"] == "legacy-sha256"
assert pin["artifact_sha256"] == "b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c"
assert pin["package_version"] == "1.0.0"
print("ok: CR-003/CR-105 legacy pin intact")
PY
fi

echo "$TAG ================================"
echo "$TAG  collection-protocol compat OK"
echo "$TAG  artifact_sha256=$SHA_A"
echo "$TAG  source_commit=$SOURCE_COMMIT"
echo "$TAG ================================"
