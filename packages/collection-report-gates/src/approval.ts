import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import type {
  GateManifestT,
  ManifestApprovalT,
  RepositoryAcceptanceReceiptT,
} from "./schema.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("approval scope contains a non-canonical value");
};

/**
 * Digest of the exact manifest being approved. Approval receipts are excluded
 * to avoid a circular digest; every other field, including status and
 * evaluated_at, remains bound.
 */
export const computeApprovalManifestDigest = (
  manifest: GateManifestT,
): string => {
  const { approvals: _approvals, ...approvalScope } = manifest;
  return `sha256:${createHash("sha256")
    .update(canonicalJson(approvalScope), "utf8")
    .digest("hex")}`;
};

export const approvalSigningPayload = (
  approval: Pick<
    ManifestApprovalT,
    "owner" | "manifest_digest" | "signed_at"
  >,
): Uint8Array =>
  new TextEncoder().encode(
    [
      "collection-report-gate-approval/v1",
      approval.owner,
      approval.manifest_digest,
      approval.signed_at,
      "",
    ].join("\n"),
  );

export const expectedApprovalKeyId = (publicKey: string): string =>
  `ed25519:${createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("hex")}`;

export const verifyManifestApproval = (
  approval: ManifestApprovalT,
  publicKeyValue: string,
): boolean => {
  try {
    const rawPublicKey = Buffer.from(publicKeyValue, "base64url");
    const publicKey = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: rawPublicKey.toString("base64url"),
      },
      format: "jwk",
    });
    return verifySignature(
      null,
      approvalSigningPayload(approval),
      publicKey,
      Buffer.from(approval.signature, "base64url"),
    );
  } catch {
    return false;
  }
};

/**
 * Repository acceptance is a separate authority domain from manifest approval.
 * A gate owner signature can never be replayed as repository-owner acceptance.
 */
export const repositoryAcceptanceSigningPayload = (
  receipt: Omit<RepositoryAcceptanceReceiptT, "signature">,
): Uint8Array =>
  new TextEncoder().encode(
    [
      "collection-report-repository-acceptance/v1",
      receipt.task_id,
      receipt.repository,
      receipt.owner,
      receipt.reviewed_commit,
      receipt.artifact_uri,
      receipt.artifact_digest,
      receipt.state,
      receipt.valid_from,
      receipt.valid_until,
      receipt.key_id,
      "",
    ].join("\n"),
  );

export const verifyRepositoryAcceptance = (
  receipt: RepositoryAcceptanceReceiptT,
  publicKeyValue: string,
): boolean => {
  try {
    const rawPublicKey = Buffer.from(publicKeyValue, "base64url");
    const publicKey = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: rawPublicKey.toString("base64url"),
      },
      format: "jwk",
    });
    const { signature, ...signedFields } = receipt;
    return verifySignature(
      null,
      repositoryAcceptanceSigningPayload(signedFields),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
};
