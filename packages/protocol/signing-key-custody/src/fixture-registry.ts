import { createHash } from "node:crypto";
import { jcsCanonicalize } from "@freeside/trust-envelope-protocol";
import type { CustodySigningKey, KeyCustodyClass, SigningKeyRegistryDocument } from "./contracts.js";
import {
  FIXTURE_CAPABILITY,
  FIXTURE_SIGNING_KEY_IDS,
  FIXTURE_TENANT_SCOPE_DIGEST,
  fixturePublicKeys,
} from "@freeside/trust-envelope-protocol";
import { DEFAULT_REGISTRY_MAX_STALENESS_MS, SIGNING_KEY_CUSTODY_SCHEMA_VERSION } from "./version.js";

const digestRegistryMaterial = (material: unknown): string =>
  createHash("sha256").update(jcsCanonicalize(material)).digest("hex");

export const buildFixtureCustodyKey = (
  signingKeyId: string,
  options?: {
    activatedAt?: string;
    revokedAt?: string;
    compromise?: boolean;
    registryGeneration?: number;
  },
): CustodySigningKey => ({
  signing_key_id: signingKeyId,
  public_key_hex: fixturePublicKeys()[signingKeyId]!,
  producer: "sonar-api",
  capabilities: [FIXTURE_CAPABILITY],
  tenant_scope_digests: [FIXTURE_TENANT_SCOPE_DIGEST],
  activated_at: options?.activatedAt ?? "2026-07-01T00:00:00.000Z",
  ...(options?.revokedAt !== undefined ? { revoked_at: options.revokedAt } : {}),
  ...(options?.compromise !== undefined ? { compromise: options.compromise } : {}),
  key_class: "fixture",
  custody_backend: "local-fixture",
  registry_generation: options?.registryGeneration ?? 1,
});

export const defaultFixtureCustodyKeys = (): CustodySigningKey[] => [
  buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarPrimary),
  buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarRotated, {
    activatedAt: "2026-07-10T00:00:00.000Z",
  }),
  buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarRevoked, {
    activatedAt: "2026-07-01T00:00:00.000Z",
    revokedAt: "2026-07-15T00:00:00.000Z",
  }),
];

export interface BuildRegistryDocumentInput {
  readonly registryId: string;
  readonly registryGeneration: number;
  readonly publishedAt: string;
  readonly keyClassScope: KeyCustodyClass;
  readonly keys: readonly CustodySigningKey[];
  readonly maxStalenessMs?: number;
}

export const buildSigningKeyRegistryDocument = ({
  registryId,
  registryGeneration,
  publishedAt,
  keyClassScope,
  keys,
  maxStalenessMs = DEFAULT_REGISTRY_MAX_STALENESS_MS,
}: BuildRegistryDocumentInput): SigningKeyRegistryDocument => {
  const body = {
    schema_version: SIGNING_KEY_CUSTODY_SCHEMA_VERSION,
    registry_id: registryId,
    registry_generation: registryGeneration,
    published_at: publishedAt,
    max_staleness_ms: maxStalenessMs,
    key_class_scope: keyClassScope,
    keys,
  } as const;

  return {
    ...body,
    distribution_digest: digestRegistryMaterial(body),
  };
};

export const buildDefaultFixtureRegistryDocument = (
  publishedAt = "2026-07-17T21:00:00.000Z",
): SigningKeyRegistryDocument =>
  buildSigningKeyRegistryDocument({
    registryId: "collection-report.fixture-registry.v1",
    registryGeneration: 1,
    publishedAt,
    keyClassScope: "fixture",
    keys: defaultFixtureCustodyKeys(),
  });

/** Example production registry shape — public metadata only; private keys live in KMS/HSM. */
export const exampleProductionRegistryTemplate = (): SigningKeyRegistryDocument =>
  buildSigningKeyRegistryDocument({
    registryId: "collection-report.production-registry.v1",
    registryGeneration: 1,
    publishedAt: "2026-07-17T21:00:00.000Z",
    keyClassScope: "production",
    keys: [
      {
        signing_key_id: "sonar-production-primary",
        public_key_hex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        producer: "sonar-api",
        capabilities: [FIXTURE_CAPABILITY],
        activated_at: "2026-07-01T00:00:00.000Z",
        key_class: "production",
        custody_backend: "aws-kms",
        custody_key_ref: "alias/collection-report/sonar-primary",
        registry_generation: 1,
      },
    ],
  });
