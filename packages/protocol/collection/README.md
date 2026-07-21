# `@freeside/collection-protocol`

CR-001's versioned, shared cross-VM collection wire contract.

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

The fixtures are protocol publication artifacts. `Dashboard` and `Sonar`
consumer-shaped tests intentionally decode the same committed files; actual
cross-repository adoption remains CR-005.
