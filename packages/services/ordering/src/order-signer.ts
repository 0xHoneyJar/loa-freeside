import { sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { jcsCanonicalize } from '@freeside/shadow-audit-protocol';

/**
 * S4-T1 / H-5 — the canonical signed order.
 *
 * Signs the FULL canonical order (validated inputs + schema version + preset version + the ACL'd
 * AuditRequest digest), not just an `inputs_digest` — the money/ops path (R-1) needs the whole payload
 * signed so verification fails on ANY field tamper. ed25519 over the RFC-8785 JCS canonicalization
 * (`jcsCanonicalize`, the cluster's canonicalizer) so the signed bytes are deterministic across impls.
 *
 * Keys are `node:crypto` ed25519 KeyObjects — the composition root supplies them from the cluster's
 * key management (Legba/gaib) at deploy; this module is key-source-agnostic.
 */
export interface CanonicalOrder {
  order_id: string;
  product: string;
  /** The VALIDATED inputs (post preset-schema), not the raw request body. */
  inputs: Record<string, unknown>;
  /** ordering-protocol schema version the order was validated under. */
  schema_version: string;
  /** the preset (recipe) version/id the order was placed against. */
  preset_version: string;
  /** digest of the ACL-mapped AuditRequest (binds the order to exactly what the audit will run). */
  audit_request_digest: string;
}

export interface SignedOrder {
  order: CanonicalOrder;
  /** base64 ed25519 signature over jcsCanonicalize(order). */
  signature: string;
}

export function signOrder(order: CanonicalOrder, privateKey: KeyObject): SignedOrder {
  const bytes = Buffer.from(jcsCanonicalize(order), 'utf8');
  return { order, signature: edSign(null, bytes, privateKey).toString('base64') };
}

/** True iff `signed.signature` is a valid ed25519 signature over the canonical order. Tamper → false. */
export function verifyOrder(signed: SignedOrder, publicKey: KeyObject): boolean {
  const bytes = Buffer.from(jcsCanonicalize(signed.order), 'utf8');
  try {
    return edVerify(null, bytes, publicKey, Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}
