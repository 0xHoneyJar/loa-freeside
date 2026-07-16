# Consumer guide — `@freeside/collection-protocol` (CR-005)

Primary package: loa-freeside `packages/protocol/collection`.
Consumers: `sonar-api`, `freeside-dashboard` (and later Inventory).

## Dependency direction

```
consumers ──► @freeside/collection-protocol ──► peer: effect
```

- Protocol never imports Dashboard / Sonar / Inventory / Ordering.
- Consumers decode with exported `decode*` / `make*` APIs only.
- Do not mirror schemas. Do not create a package cycle.

## Canonical pack / verify (replaces ad-hoc `pnpm pack`)

From the protocol package:

```bash
pnpm install --frozen-lockfile
pnpm run pack:artifact -- --out ./out
# writes:
#   out/freeside-collection-protocol-1.0.0.tgz
#   out/freeside-collection-protocol-1.0.0.manifest.json
```

Pack always:

1. Validates `source_commit` is a real commit reachable from HEAD (rejects
   zero / nonexistent SHAs).
2. Compiles and loads the packer from a fresh isolated staging build (never
   executes checkout `dist/`).
3. Builds the published package in a second clean isolated staging tree after
   wiping generated outputs.
4. Writes `protocol-identity.json` into the package before `pnpm pack`.
5. Emits a sidecar manifest whose identity fields must equal the identity file;
   `source_tree_sha256` binds the exact packed inventory (so a dirty working
   tree cannot claim commit-only cleanliness).

Verify before install or tests:

```bash
pnpm run verify:artifact -- \
  --tarball ./out/freeside-collection-protocol-1.0.0.tgz \
  --manifest ./out/freeside-collection-protocol-1.0.0.manifest.json \
  --expect-version 1.0.0 \
  --expect-major 1 \
  --expect-minor 0
```

Verification does not trust the manifest alone: it validates every archive
member before extract using the **effective** path/type/link target (PAX global
`g` and per-file `x` `path`/`linkpath` overrides, plus GNU longname/longlink
when present — not raw ustar names alone). Ordinary files under `package/` only;
rejects symlinks/hardlinks/linkpath overrides, malformed/duplicate/conflicting
extended headers (including mixed per-file PAX path/linkpath with GNU
longname/longlink, and global PAX path/linkpath combined with GNU longname/
longlink for the same member — extraction tools disagree on precedence), path
escapes (absolute/parent/backslash / outside `package/`), and NFC/case path
collisions (`café` vs `café` fail). Manifest inventory paths and archive
effective paths share the same per-segment Unicode NFC rule; the effective
member set must exactly equal the manifest inventory plus
`protocol-identity.json` / `package.json`. Manifest and identity JSON use
duplicate-key rejection and nested excess-property errors via the same compiled
harness verifier the library uses; then exact identity equality, recomputed
`source_tree_sha256`, and the complete fixture digest map (missing/extra/
renamed/digest-drift fail closed).

## Temporary CR-003 / CR-105 artifacts

Until consumer PRs migrate, existing vendored tarballs remain verifiable:

```bash
pnpm run verify:artifact -- \
  --tarball vendor/collection-protocol/freeside-collection-protocol-1.0.0.tgz \
  --legacy-sha256 b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c
```

Golden pin (shared CR-003/CR-105 temporary artifact):
`pins/cr-003-temporary.pin.json`.

## Shared CI entrypoint

Identical script for all three repositories:

```bash
# Producer (loa-freeside package):
./scripts/ci-compat.sh

# Consumer verify-only against a pin:
COLLECTION_PROTOCOL_TARBALL=/path/to/pkg.tgz \
COLLECTION_PROTOCOL_MANIFEST=/path/to/pkg.manifest.json \
COLLECTION_PROTOCOL_EXPECT_VERSION=1.0.0 \
COLLECTION_PROTOCOL_EXPECT_MAJOR=1 \
COLLECTION_PROTOCOL_EXPECT_MINOR=0 \
./scripts/ci-compat.sh --verify-only
```

Or legacy:

```bash
COLLECTION_PROTOCOL_TARBALL=/path/to/pkg.tgz \
COLLECTION_PROTOCOL_LEGACY_SHA256=b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c \
./scripts/ci-compat.sh --verify-only
```

## Consumer branch commands

```bash
# After pinning a CR-005 artifact into the consumer repo:
COLLECTION_PROTOCOL_TARBALL=vendor/collection-protocol/freeside-collection-protocol-1.0.0.tgz \
COLLECTION_PROTOCOL_MANIFEST=vendor/collection-protocol/freeside-collection-protocol-1.0.0.manifest.json \
COLLECTION_PROTOCOL_EXPECT_VERSION=1.0.0 \
COLLECTION_PROTOCOL_EXPECT_MAJOR=1 \
COLLECTION_PROTOCOL_EXPECT_MINOR=0 \
./scripts/ci-compat.sh --verify-only

# Until migration, CR-003/CR-105 temporary pin:
COLLECTION_PROTOCOL_TARBALL=vendor/collection-protocol/freeside-collection-protocol-1.0.0.tgz \
COLLECTION_PROTOCOL_LEGACY_SHA256=b0d0666867988bc67094d9189048f7bca0b89ea1140a7705d6953528f7d5298c \
./scripts/ci-compat.sh --verify-only
```

## In-process harness

```ts
import {
  checkContractCompatibility,
  verifyArtifact,
} from "@freeside/collection-protocol/harness";
```

- Unknown contract major → `UnsupportedContractMajor` (fail closed).
- Mixed minor outside consumer `min_minor..max_minor` → `UnsupportedContractMinor`.
- Supported mixed-minor inside the declared window → success.
