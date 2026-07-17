import { Schema } from "effect";

export const COLLECTION_PROTOCOL_VERSION = "1.0.0";
/** Wire `schema_version` field — integer major only (CR-001). */
export const COLLECTION_PROTOCOL_SCHEMA_VERSION = 1;
/** Contract major published in the CR-005 artifact manifest. */
export const COLLECTION_PROTOCOL_SCHEMA_MAJOR = 1;
/**
 * Contract minor for additive, forward-compatible wire changes.
 * Unknown major fails closed; mixed-minor within a consumer's declared range is
 * accepted (see `@freeside/collection-protocol/harness`).
 */
export const COLLECTION_PROTOCOL_SCHEMA_MINOR = 0;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EVM_NORMALIZED_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const SOLANA_CLUSTER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const TOKEN_STANDARD_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const isSolanaPublicKey = (value: string): boolean => {
  if (value.length < 32 || value.length > 44) return false;

  let magnitude = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return false;
    magnitude = magnitude * 58n + BigInt(digit);
  }

  let magnitudeBytes = 0;
  let remaining = magnitude;
  while (remaining > 0n) {
    magnitudeBytes += 1;
    remaining >>= 8n;
  }

  let leadingZeroBytes = 0;
  for (const character of value) {
    if (character !== "1") break;
    leadingZeroBytes += 1;
  }

  return magnitudeBytes + leadingZeroBytes === 32;
};

export const EvmAddress = Schema.String.pipe(
  Schema.pattern(EVM_ADDRESS_PATTERN),
).annotations({ identifier: "EvmAddress" });
export type EvmAddress = Schema.Schema.Type<typeof EvmAddress>;

export const EvmNormalizedAddress = Schema.String.pipe(
  Schema.pattern(EVM_NORMALIZED_ADDRESS_PATTERN),
).annotations({ identifier: "EvmNormalizedAddress" });
export type EvmNormalizedAddress = Schema.Schema.Type<typeof EvmNormalizedAddress>;

export const SolanaPublicKey = Schema.String.pipe(
  Schema.filter((value) => isSolanaPublicKey(value) || "expected a base58-encoded 32-byte Solana public key"),
).annotations({ identifier: "SolanaPublicKey" });
export type SolanaPublicKey = Schema.Schema.Type<typeof SolanaPublicKey>;

export const Eip155NetworkReference = Schema.String.pipe(
  Schema.pattern(DECIMAL_PATTERN),
  Schema.filter((value) => value !== "0" || "EIP-155 network reference must be positive"),
).annotations({ identifier: "Eip155NetworkReference" });
export type Eip155NetworkReference = Schema.Schema.Type<typeof Eip155NetworkReference>;

export const SolanaNetworkReference = Schema.String.pipe(
  Schema.pattern(SOLANA_CLUSTER_PATTERN),
).annotations({ identifier: "SolanaNetworkReference" });
export type SolanaNetworkReference = Schema.Schema.Type<typeof SolanaNetworkReference>;

export const VersionIdentifier = Schema.String.pipe(
  Schema.pattern(VERSION_IDENTIFIER_PATTERN),
).annotations({ identifier: "VersionIdentifier" });
export type VersionIdentifier = Schema.Schema.Type<typeof VersionIdentifier>;

export const TokenStandardValue = Schema.String.pipe(
  Schema.pattern(TOKEN_STANDARD_PATTERN),
).annotations({ identifier: "TokenStandardValue" });
export type TokenStandardValue = Schema.Schema.Type<typeof TokenStandardValue>;

export const Sha256Hex = Schema.String.pipe(
  Schema.pattern(SHA256_PATTERN),
).annotations({ identifier: "Sha256Hex" });
export type Sha256Hex = Schema.Schema.Type<typeof Sha256Hex>;

export const RegistryEpoch = Schema.String.pipe(
  Schema.pattern(UUID_PATTERN),
).annotations({ identifier: "RegistryEpoch" });
export type RegistryEpoch = Schema.Schema.Type<typeof RegistryEpoch>;

export const RegistrySequence = Schema.String.pipe(
  Schema.pattern(DECIMAL_PATTERN),
  Schema.filter(
    (value) =>
      BigInt(value) <= 18_446_744_073_709_551_615n ||
      "registry sequence exceeds unsigned 64-bit range",
  ),
).annotations({ identifier: "RegistrySequence" });
export type RegistrySequence = Schema.Schema.Type<typeof RegistrySequence>;

export const normalizeEvmAddress = (address: EvmAddress): string => address.toLowerCase();
export const normalizeSolanaAddress = (address: SolanaPublicKey): string => address;
