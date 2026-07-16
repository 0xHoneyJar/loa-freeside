import { createHash } from "node:crypto";
import { Data, Effect, Schema } from "effect";
import { Sha256Hex } from "./scalars.js";

export const DigestDomain = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9.-]{0,127}$/),
).annotations({ identifier: "DigestDomain" });
export type DigestDomain = Schema.Schema.Type<typeof DigestDomain>;

export const VersionedDigest = Schema.Struct({
  algorithm: Schema.Literal("sha-256"),
  domain: DigestDomain,
  major_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  digest: Sha256Hex,
}).annotations({ identifier: "VersionedDigest" });
export interface VersionedDigest extends Schema.Schema.Type<typeof VersionedDigest> {}

export class CanonicalEncodingError extends Data.TaggedError("CanonicalEncodingError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class DuplicateCanonicalSetMemberError extends Data.TaggedError(
  "DuplicateCanonicalSetMemberError",
)<{
  readonly canonical_key: string;
}> {}

export class DigestComputationError extends Data.TaggedError("DigestComputationError")<{
  readonly domain: string;
  readonly cause: unknown;
}> {}

type CanonicalResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: CanonicalEncodingError };

const canonicalSuccess = (value: string): CanonicalResult => ({ ok: true, value });
const canonicalFailure = (path: string, reason: string): CanonicalResult => ({
  ok: false,
  error: new CanonicalEncodingError({ path, reason }),
});

const isReadonlyUnknownArray = (value: unknown): value is ReadonlyArray<unknown> =>
  Array.isArray(value);

const isReadonlyUnknownRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasLoneSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
};

const quoteString = (value: string, path: string): CanonicalResult => {
  if (hasLoneSurrogate(value)) {
    return canonicalFailure(path, "RFC 8785 forbids lone Unicode surrogates");
  }
  const normalized = value.normalize("NFC");
  const encoded = JSON.stringify(normalized);
  return encoded === undefined
    ? canonicalFailure(path, "string is not JSON representable")
    : canonicalSuccess(encoded);
};

const canonicalizeValue = (value: unknown, path: string): CanonicalResult => {
  if (value === null) return canonicalSuccess("null");

  if (typeof value === "string") return quoteString(value, path);
  if (typeof value === "boolean") return canonicalSuccess(value ? "true" : "false");

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return canonicalFailure(path, "RFC 8785 permits only finite JSON numbers");
    }
    const encoded = JSON.stringify(value);
    return encoded === undefined
      ? canonicalFailure(path, "number is not JSON representable")
      : canonicalSuccess(encoded);
  }

  if (isReadonlyUnknownArray(value)) {
    const encodedMembers: Array<string> = [];
    for (let index = 0; index < value.length; index += 1) {
      const encoded = canonicalizeValue(value[index], `${path}/${index}`);
      if (!encoded.ok) return encoded;
      encodedMembers.push(encoded.value);
    }
    return canonicalSuccess(`[${encodedMembers.join(",")}]`);
  }

  if (isReadonlyUnknownRecord(value)) {
    const normalizedEntries: Array<{
      readonly normalizedKey: string;
      readonly originalKey: string;
    }> = [];
    const normalizedKeys = new Set<string>();

    for (const originalKey of Object.keys(value)) {
      if (hasLoneSurrogate(originalKey)) {
        return canonicalFailure(`${path}/${originalKey}`, "RFC 8785 forbids lone Unicode surrogates");
      }
      const normalizedKey = originalKey.normalize("NFC");
      if (normalizedKeys.has(normalizedKey)) {
        return canonicalFailure(
          path,
          `object keys collide after NFC normalization: ${normalizedKey}`,
        );
      }
      normalizedKeys.add(normalizedKey);
      normalizedEntries.push({ normalizedKey, originalKey });
    }

    normalizedEntries.sort((left, right) => {
      if (left.normalizedKey < right.normalizedKey) return -1;
      if (left.normalizedKey > right.normalizedKey) return 1;
      return 0;
    });

    const encodedEntries: Array<string> = [];
    for (const entry of normalizedEntries) {
      const encodedKey = quoteString(entry.normalizedKey, `${path}/${entry.normalizedKey}`);
      if (!encodedKey.ok) return encodedKey;
      const encodedValue = canonicalizeValue(
        value[entry.originalKey],
        `${path}/${entry.normalizedKey}`,
      );
      if (!encodedValue.ok) return encodedValue;
      encodedEntries.push(`${encodedKey.value}:${encodedValue.value}`);
    }
    return canonicalSuccess(`{${encodedEntries.join(",")}}`);
  }

  return canonicalFailure(
    path,
    `unsupported JSON value type: ${typeof value}; absent properties must be omitted, not undefined`,
  );
};

export const canonicalize = (
  value: unknown,
): Effect.Effect<string, CanonicalEncodingError> => {
  const result = canonicalizeValue(value, "$");
  return result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
};

export const canonicalEncode = (
  value: unknown,
): Effect.Effect<Uint8Array, CanonicalEncodingError> =>
  canonicalize(value).pipe(Effect.map((json) => new TextEncoder().encode(json)));

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) return left.length - right.length;
    if (leftByte < rightByte) return -1;
    if (leftByte > rightByte) return 1;
  }
  return left.length - right.length;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  compareBytes(left, right) === 0;

export interface CanonicalSetMember<Value> {
  readonly canonical_key: unknown;
  readonly value: Value;
}

export const sortCanonicalSet = <Value>(
  members: ReadonlyArray<CanonicalSetMember<Value>>,
): Effect.Effect<
  ReadonlyArray<Value>,
  CanonicalEncodingError | DuplicateCanonicalSetMemberError
> =>
  Effect.forEach(members, (member) =>
    canonicalEncode(member.canonical_key).pipe(
      Effect.map((canonicalKeyBytes) => ({ member, canonicalKeyBytes })),
    ),
  ).pipe(
    Effect.flatMap((encodedMembers) => {
      const sorted = Array.from(encodedMembers);
      sorted.sort((left, right) =>
        compareBytes(left.canonicalKeyBytes, right.canonicalKeyBytes),
      );

      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          bytesEqual(previous.canonicalKeyBytes, current.canonicalKeyBytes)
        ) {
          return canonicalize(current.member.canonical_key).pipe(
            Effect.flatMap((canonicalKey) =>
              Effect.fail(
                new DuplicateCanonicalSetMemberError({ canonical_key: canonicalKey }),
              ),
            ),
          );
        }
      }

      return Effect.succeed(sorted.map((entry) => entry.member.value));
    }),
  );

export const digestVersioned = (
  domain: DigestDomain,
  majorVersion: number,
  value: unknown,
): Effect.Effect<
  VersionedDigest,
  CanonicalEncodingError | DigestComputationError
> =>
  canonicalEncode({ domain, major_version: majorVersion, value }).pipe(
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => createHash("sha256").update(bytes).digest("hex"),
        catch: (cause) => new DigestComputationError({ domain, cause }),
      }),
    ),
    Effect.map((digest) => {
      const result: VersionedDigest = {
        algorithm: "sha-256",
        domain,
        major_version: majorVersion,
        digest,
      };
      return result;
    }),
  );

export const CANONICAL_ENCODING_RULES = Object.freeze({
  object_keys: "RFC 8785 UTF-16 lexical order after NFC normalization",
  strings: "UTF-8 encoded after NFC normalization; lone surrogates rejected",
  ordered_arrays: "preserve declared order",
  sorted_sets: "sort bytewise by an explicit typed canonical key; duplicates rejected",
  absent: "omit the property",
  null: "encode null only where the boundary schema explicitly permits null",
  identifiers: "EVM lowercase comparison form; Solana case-sensitive comparison form",
  digest: "SHA-256 over a domain and major-version separated canonical envelope",
});
