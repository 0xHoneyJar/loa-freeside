import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { StreamEpochBaseline, TrustEnvelope } from "./contracts.js";
import { digestJcs, jcsCanonicalize, sha256Hex } from "./jcs.js";

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const buf = Buffer.from(b64u, "base64url");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export type SigningKeyId = string;

export interface TrustEnvelopeSigner {
  readonly keyId: SigningKeyId;
  sign(message: Uint8Array): string;
  publicKeyHex(): string;
}

export class LocalEd25519TrustSigner implements TrustEnvelopeSigner {
  readonly keyId: SigningKeyId;
  readonly #secretKey: Uint8Array;

  private constructor(keyId: SigningKeyId, secretKey: Uint8Array) {
    this.keyId = keyId;
    this.#secretKey = secretKey;
  }

  static fromSeedHex(seedHex: string, keyId: SigningKeyId): LocalEd25519TrustSigner {
    if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
      throw new Error("LocalEd25519TrustSigner.fromSeedHex: expected 64 hex chars");
    }
    return new LocalEd25519TrustSigner(keyId, hexToBytes(seedHex.toLowerCase()));
  }

  sign(message: Uint8Array): string {
    return bytesToBase64Url(ed25519.sign(message, this.#secretKey));
  }

  publicKeyHex(): string {
    return bytesToHex(ed25519.getPublicKey(this.#secretKey));
  }
}

export const computeBodyDigest = (body: unknown): string => digestJcs(body);

export const envelopeSigningBytes = (
  envelopeWithoutSignature: Omit<TrustEnvelope, "signature">,
): Uint8Array => {
  const tbs: TrustEnvelope = {
    ...envelopeWithoutSignature,
    signature: "",
  };
  const digestHex = sha256Hex(jcsCanonicalize(tbs));
  return new TextEncoder().encode(digestHex);
};

export const baselineSigningBytes = (
  baselineWithoutSignature: Omit<StreamEpochBaseline, "signature">,
): Uint8Array => {
  const tbs: StreamEpochBaseline = {
    ...baselineWithoutSignature,
    signature: "",
  };
  const digestHex = sha256Hex(jcsCanonicalize(tbs));
  return new TextEncoder().encode(digestHex);
};

export const verifyEd25519Signature = (
  publicKeyHex: string,
  message: Uint8Array,
  signatureBase64Url: string,
): boolean => {
  try {
    return ed25519.verify(
      base64UrlToBytes(signatureBase64Url),
      message,
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
};

export const signTrustEnvelope = (
  signer: TrustEnvelopeSigner,
  envelope: Omit<TrustEnvelope, "signature">,
): TrustEnvelope => ({
  ...envelope,
  header: {
    ...envelope.header,
    signing_key_id: signer.keyId,
    body_digest: computeBodyDigest(envelope.body),
  },
  signature: signer.sign(envelopeSigningBytes({
    ...envelope,
    header: {
      ...envelope.header,
      signing_key_id: signer.keyId,
      body_digest: computeBodyDigest(envelope.body),
    },
  })),
});

export const signStreamEpochBaseline = (
  signer: TrustEnvelopeSigner,
  baseline: Omit<StreamEpochBaseline, "signature" | "signing_key_id">,
): StreamEpochBaseline => {
  const material = {
    ...baseline,
    signing_key_id: signer.keyId,
  };
  return {
    ...material,
    signature: signer.sign(baselineSigningBytes(material)),
  };
};

export const digestEpochBaselineMaterial = (input: {
  stream_id: string;
  stream_epoch: number;
  highest_sequence: number;
  envelope_count: number;
  envelopes: ReadonlyArray<Pick<TrustEnvelope, "header">>;
}): string =>
  digestJcs({
    stream_id: input.stream_id,
    stream_epoch: input.stream_epoch,
    highest_sequence: input.highest_sequence,
    envelope_count: input.envelope_count,
    envelopes: input.envelopes.map((envelope) => ({
      event_id: envelope.header.event_id,
      sequence: envelope.header.sequence,
      body_digest: envelope.header.body_digest,
    })),
  });
