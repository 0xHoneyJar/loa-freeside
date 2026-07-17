# `@freeside/collection-protocol`

CR-001's versioned, shared cross-VM collection wire contract, plus the CR-005
cross-repository distribution and compatibility harness.

The package owns `CollectionIdentifier`, `NetworkRef`, deployment and logical
collection identity, candidates, provenance, orthogonal readiness states,
extensible token standards, explicit equivalence evidence, capability-registry
wire versions, finality-policy bindings, and domain-separated canonical
digests.

External input must enter through the exported `decode*` functions. They decode
`unknown` with excess-property errors enabled and validate digest integrity for
deployment, identity, and candidate contracts.

Canonical rules:

- objects follow RFC 8785/JCS ordering;
- strings and keys are NFC-normalized before UTF-8 encoding;
- lone Unicode surrogates and non-JSON values fail with typed errors;
- arrays are ordered unless their schema declares a sorted-set rule;
- sorted sets use an explicit typed canonical key and bytewise ordering;
- absent fields are omitted; `null` is accepted only by schemas that declare it;
- EVM identity uses lowercase comparison form while preserving display address;
- Solana identity is case-sensitive;
- logical `collection_id` excludes mutable name, symbol, image, and alias data;
- registry epoch UUIDs use one lowercase canonical wire form;
- digest preimages are separated by domain and contract major version.

## Contract version

| Constant | Meaning |
|---|---|
| `COLLECTION_PROTOCOL_VERSION` | npm package semver (`1.0.0`) |
| `COLLECTION_PROTOCOL_SCHEMA_VERSION` / `_MAJOR` | wire `schema_version` major |
| `COLLECTION_PROTOCOL_SCHEMA_MINOR` | additive minor for compatibility windows |

Unknown major fails closed. Mixed-minor acceptance is consumer-declared via
`@freeside/collection-protocol/harness`.

## Fixtures

Committed fixtures under `fixtures/` (including `fixtures/compatibility/`) are
protocol publication artifacts. Dashboard and Sonar consumer-shaped tests decode
the same files in-repo. Cross-repository adoption uses the CR-005 pack/verify
flow documented in [`CONSUMER.md`](./CONSUMER.md).

## Pack / verify (CR-005)

Every pack compiles and executes the packer from a fresh isolated staging build
(never checkout `dist/`), then builds the published package in a second clean
staging tree so warmed generated outputs cannot enter the tarball. The tarball
embeds `protocol-identity.json` (package name/version, contract schema
major/minor, source commit). The sidecar manifest must match that identity,
`package.json`, recomputed `source_tree_sha256`, and the complete fixture digest
key set. Verification lists and validates every tar member before extraction,
binding PAX/GNU extended-path overrides to the following member and rejecting
ambiguous mixed PAX+GNU path/linkpath metadata (no precedence guessing) plus
NFC/case path collisions against the NFC-normalized manifest inventory.

```bash
pnpm install --frozen-lockfile
pnpm run ci:compat          # install, test, isolated pack×2, stale-dist, tampers
pnpm run pack:artifact -- --out ./out
pnpm run verify:artifact -- --tarball ./out/*.tgz --manifest ./out/*.manifest.json
```

Do not use ad-hoc `pnpm pack` as the consumer pin path. Temporary CR-003/CR-105
tarballs remain checksum-verifiable via `--legacy-sha256` until those repos
migrate.
