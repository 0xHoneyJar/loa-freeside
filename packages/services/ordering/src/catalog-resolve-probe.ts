/**
 * Local/dev Sonar stub when SONAR_RESOLVE_PROBE_URL is unset.
 * Mirrors Kitchen catalog mode so Ordering can be proven without a live Kitchen.
 */

import { Effect } from "effect";
import {
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
  type CapabilityRegistryVersion,
  type CollectionCandidate,
} from "@freeside/collection-protocol";
import { COLLECTION_RESOLUTION_SCHEMA_VERSION } from "@freeside/collection-resolution-protocol";
import type { SonarResolveProbePort } from "./resolution-service.js";

const REGISTRY: CapabilityRegistryVersion = {
  registry_epoch: "11111111-1111-4111-8111-111111111111",
  registry_sequence: "10",
};

const CATALOG = new Map([
  ["0xabcdef0123456789abcdef0123456789abcdef01", { key: "mibera", name: "Mibera", symbol: "MIB" }],
  ["0xed5af388653567af2f388e6224dc7c4b3241c544", { key: "azuki", name: "Azuki", symbol: "AZUKI" }],
  [
    "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d",
    { key: "bayc", name: "Bored Ape Yacht Club", symbol: "BAYC" },
  ],
  [
    "0x60e4d786628fea6478f785a6d7e704777c86a7c6",
    { key: "mayc", name: "Mutant Ape Yacht Club", symbol: "MAYC" },
  ],
  [
    "0xbd3531da5cf5857e7cfaa92426877b022e612b85",
    { key: "pudgy", name: "Pudgy Penguins", symbol: "PPG" },
  ],
  [
    "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e",
    { key: "doodles", name: "Doodles", symbol: "DOODLE" },
  ],
  [
    "0x23581767a106ae21c074b2276d25e5c3e785d2d7",
    { key: "moonbirds", name: "Moonbirds", symbol: "MOONBIRD" },
  ],
  ["0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b", { key: "clonex", name: "CloneX", symbol: "CLONEX" }],
  [
    "0x34d85c9cdeb23fa97cb08333b511ac86e1c4e258",
    { key: "otherdeed", name: "Otherdeed", symbol: "OTHR" },
  ],
  [
    "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb",
    { key: "cryptopunks", name: "CryptoPunks", symbol: "PUNK" },
  ],
  [
    "0x5af0d9827e0c53e4799bb226655a1de152a425a5",
    { key: "milady", name: "Milady Maker", symbol: "MILADY" },
  ],
  ["0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03", { key: "nouns", name: "Nouns", symbol: "NOUN" }],
  [
    "0x1a92f7381b9f0394d0a18cddfc72ccaf3b5c3f2e",
    { key: "coolcats", name: "Cool Cats", symbol: "COOL" },
  ],
]);

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

export function createCatalogResolveProbePort(): SonarResolveProbePort {
  return {
    async resolveProbe(input) {
      const normalized = normalizeAddress(input.identifier);
      const meta =
        CATALOG.get(normalized) ??
        ({ key: "unknown", name: "Unrecognized collection", symbol: "NFT" } as const);
      const address =
        normalized.startsWith("0x") && normalized.length === 42
          ? normalized
          : "0xabcdef0123456789abcdef0123456789abcdef01";

      const deployment = Effect.runSync(
        makeCollectionDeploymentRef({
          schema_version: 1,
          network: {
            schema_version: 1,
            network_namespace: "eip155",
            network_reference: "1",
          },
          address,
        }),
      );

      const identity = Effect.runSync(
        makeCollectionIdentity({
          schema_version: 1,
          collection_key: meta.key,
          name: meta.name,
          symbol: meta.symbol,
          image: `https://images.example.test/${meta.key}.png`,
          deployments: [deployment],
          equivalence_basis: {
            schema_version: 1,
            kind: "single_deployment",
          },
        }),
      );

      const candidate = {
        schema_version: 1 as const,
        identity,
        token_standard: { schema_version: 1 as const, value: "erc721" as const },
        recognition: "recognized" as const,
        index_status: "indexed" as const,
        report_readiness: "ready" as const,
        metadata_quality: "onchain" as const,
        provenance: [
          {
            schema_version: 1 as const,
            source: "onchain" as const,
            observed_at: "2026-07-16T08:00:00Z",
            evidence_digest: {
              algorithm: "sha-256" as const,
              domain: "collection.provenance",
              major_version: 1,
              digest: "036dc29e13e14f593ba26edb66eda1ad3fa0918dd42eeb6c190455693d3c3cfc",
            },
          },
        ],
        finality_policies: [
          {
            schema_version: 1 as const,
            network: {
              schema_version: 1 as const,
              network_namespace: "eip155" as const,
              network_reference: "1",
            },
            finality_policy_version: "ethereum-finalized.v1",
          },
        ],
        ranking_reasons: ["exact_inventory_match", "supported_standard", "indexed"] as const,
      } satisfies CollectionCandidate;

      return {
        capability_snapshot_version: REGISTRY,
        candidates: [candidate],
        diagnostics: {
          schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
          searched: [
            {
              schema_version: 1,
              network_namespace: "eip155",
              network_reference: "1",
            },
          ],
          timed_out: [],
          unavailable: [],
        },
      };
    },
  };
}
