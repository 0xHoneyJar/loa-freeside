import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Data, Effect } from "effect";
import { PROTOCOL_IDENTITY_PATH } from "./identity.js";

/** Canonical npm-pack prefix for every published member. */
export const ARTIFACT_PACKAGE_PREFIX = "package/" as const;

/** Explicit protocol identity / package metadata files required in every artifact. */
export const ARTIFACT_REQUIRED_META_FILES = [
  PROTOCOL_IDENTITY_PATH,
  "package.json",
] as const;

export class ArtifactArchiveMismatch extends Data.TaggedError(
  "ArtifactArchiveMismatch",
)<{
  readonly field?: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly reason: string;
}> {}

export type TarMemberKind =
  | "file"
  | "hardlink"
  | "symlink"
  | "directory"
  | "character_device"
  | "block_device"
  | "fifo"
  | "contiguous"
  | "pax"
  | "gnu"
  | "unknown";

export type TarMember = {
  /** Effective member path after PAX/GNU extended-header overrides. */
  readonly name: string;
  readonly typeflag: string;
  readonly kind: TarMemberKind;
  readonly size: number;
  /** Effective link target after PAX/GNU extended-header overrides. */
  readonly linkname: string;
};

const kindFromTypeflag = (typeflag: string): TarMemberKind => {
  switch (typeflag) {
    case "0":
    case "\0":
      return "file";
    case "1":
      return "hardlink";
    case "2":
      return "symlink";
    case "3":
      return "character_device";
    case "4":
      return "block_device";
    case "5":
      return "directory";
    case "6":
      return "fifo";
    case "7":
      return "contiguous";
    case "x":
    case "g":
      return "pax";
    case "L":
    case "K":
      return "gnu";
    default:
      return "unknown";
  }
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const decodeUtf8Strict = (buf: Buffer, label: string): string => {
  try {
    return utf8Decoder.decode(buf);
  } catch {
    throw new ArtifactArchiveMismatch({
      path: label,
      reason: `invalid UTF-8 in ${label}`,
    });
  }
};

const parseOctal = (buf: Buffer): number => {
  const raw = decodeUtf8Strict(buf, "tar octal field")
    .replace(/\0.*$/u, "")
    .trim();
  if (raw.length === 0) {
    return 0;
  }
  if (!/^[0-7]+$/u.test(raw)) {
    throw new ArtifactArchiveMismatch({
      reason: `malformed tar: non-octal size/field value ${JSON.stringify(raw)}`,
    });
  }
  return Number.parseInt(raw, 8);
};

const readCString = (buf: Buffer, label: string): string => {
  const nul = buf.indexOf(0);
  return decodeUtf8Strict(nul === -1 ? buf : buf.subarray(0, nul), label);
};

const hasLoneSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

/**
 * Parse a PAX extended-header payload into key/value records.
 * Rejects malformed length prefixes, truncated records, and duplicate keys.
 */
export const parsePaxExtendedHeader = (
  payload: Buffer,
): ReadonlyMap<string, string> => {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < payload.byteLength) {
    // Skip trailing NULs used to pad the final block; any other leftover is
    // malformed.
    if (payload[offset] === 0) {
      const rest = payload.subarray(offset);
      if (rest.every((byte) => byte === 0)) {
        break;
      }
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: non-NUL trailing bytes",
      });
    }

    let lengthEnd = offset;
    while (lengthEnd < payload.byteLength && payload[lengthEnd] !== 0x20) {
      const digit = payload[lengthEnd]!;
      if (digit < 0x30 || digit > 0x39) {
        throw new ArtifactArchiveMismatch({
          reason: "malformed PAX extended header: length prefix is not decimal",
        });
      }
      lengthEnd += 1;
    }
    if (lengthEnd === offset || lengthEnd >= payload.byteLength) {
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: missing length/space",
      });
    }

    const lengthText = decodeUtf8Strict(
      payload.subarray(offset, lengthEnd),
      "pax length",
    );
    const recordLength = Number.parseInt(lengthText, 10);
    if (
      !Number.isSafeInteger(recordLength) ||
      recordLength <= lengthText.length ||
      offset + recordLength > payload.byteLength
    ) {
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: invalid record length",
      });
    }

    const recordBytes = payload.subarray(offset, offset + recordLength);
    if (recordBytes[recordBytes.byteLength - 1] !== 0x0a) {
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: record does not end with newline",
      });
    }

    const recordBody = recordBytes.subarray(lengthText.length + 1, recordBytes.byteLength - 1);
    const eq = recordBody.indexOf(0x3d);
    if (eq <= 0) {
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: missing key=",
      });
    }
    const key = decodeUtf8Strict(recordBody.subarray(0, eq), "pax key");
    const value = decodeUtf8Strict(recordBody.subarray(eq + 1), "pax value");
    if (key.length === 0) {
      throw new ArtifactArchiveMismatch({
        reason: "malformed PAX extended header: empty key",
      });
    }
    if (records.has(key)) {
      throw new ArtifactArchiveMismatch({
        field: key,
        reason: `malformed PAX extended header: duplicate key ${key}`,
      });
    }
    records.set(key, value);
    offset += recordLength;
  }
  return records;
};

type PaxOverrides = {
  path?: string;
  linkpath?: string;
};

const overridesFromPax = (records: ReadonlyMap<string, string>): PaxOverrides => {
  const overrides: PaxOverrides = {};
  if (records.has("path")) {
    overrides.path = records.get("path");
  }
  if (records.has("linkpath")) {
    overrides.linkpath = records.get("linkpath");
  }
  return overrides;
};

const mergePaxOverrides = (
  base: PaxOverrides,
  next: PaxOverrides,
): PaxOverrides => ({
  path: next.path ?? base.path,
  linkpath: next.linkpath ?? base.linkpath,
});

/**
 * List members of a gzip-compressed ustar/pax tarball without extracting.
 *
 * Effective `name` / `linkname` bind PAX global (`g`) and per-file (`x`)
 * `path`/`linkpath` overrides — and GNU longname/longlink (`L`/`K`) when
 * present — to the following ordinary member the way extraction tools do.
 * Mixed per-file PAX path/linkpath with GNU longname/longlink (any order), or
 * global PAX path/linkpath combined with GNU longname/longlink for the same
 * member, is rejected: extraction tools disagree on precedence, so the harness
 * does not guess.
 */
export const listTarGzipMembers = (
  tarballPath: string,
): ReadonlyArray<TarMember> => {
  const bytes = gunzipSync(readFileSync(tarballPath));
  const members: Array<TarMember> = [];
  let offset = 0;
  let globalOverrides: PaxOverrides = {};
  let pendingLocalOverrides: PaxOverrides | undefined;
  let pendingGnuLongName: string | undefined;
  let pendingGnuLongLink: string | undefined;

  const assertNoDanglingExtended = (context: string): void => {
    if (
      pendingLocalOverrides !== undefined ||
      pendingGnuLongName !== undefined ||
      pendingGnuLongLink !== undefined
    ) {
      throw new ArtifactArchiveMismatch({
        reason: `malformed tar: dangling extended header before ${context}`,
      });
    }
  };

  const assertNoMixedPathMetadata = (
    paxPath: string | undefined,
    gnuName: string | undefined,
  ): void => {
    if (paxPath !== undefined && gnuName !== undefined) {
      throw new ArtifactArchiveMismatch({
        reason:
          "malformed tar: conflicting PAX path and GNU longname metadata for the same member",
      });
    }
  };

  const assertNoMixedLinkMetadata = (
    paxLinkpath: string | undefined,
    gnuLink: string | undefined,
  ): void => {
    if (paxLinkpath !== undefined && gnuLink !== undefined) {
      throw new ArtifactArchiveMismatch({
        reason:
          "malformed tar: conflicting PAX linkpath and GNU longlink metadata for the same member",
      });
    }
  };

  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const nameField = readCString(header.subarray(0, 100), "tar name");
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const linknameField = readCString(header.subarray(157, 257), "tar linkname");
    const magic = readCString(header.subarray(257, 263), "tar magic");
    const prefix = magic.startsWith("ustar")
      ? readCString(header.subarray(345, 500), "tar prefix")
      : "";

    const padded = Math.ceil(size / 512) * 512;
    if (offset + padded > bytes.byteLength) {
      throw new ArtifactArchiveMismatch({
        path: nameField,
        reason: `malformed tar: truncated member payload for ${nameField}`,
      });
    }
    const payload = bytes.subarray(offset, offset + size);
    offset += padded;

    if (typeflag === "g") {
      // Global extended header applies to all subsequent members.
      assertNoDanglingExtended("global PAX header");
      const records = parsePaxExtendedHeader(payload);
      globalOverrides = mergePaxOverrides(
        globalOverrides,
        overridesFromPax(records),
      );
      continue;
    }
    if (typeflag === "x") {
      // Per-file extended header binds only to the immediately following member.
      if (pendingLocalOverrides !== undefined) {
        throw new ArtifactArchiveMismatch({
          reason:
            "malformed tar: conflicting consecutive per-file PAX extended headers",
        });
      }
      const local = overridesFromPax(parsePaxExtendedHeader(payload));
      assertNoMixedPathMetadata(local.path, pendingGnuLongName);
      assertNoMixedLinkMetadata(local.linkpath, pendingGnuLongLink);
      pendingLocalOverrides = local;
      continue;
    }
    if (typeflag === "L") {
      if (pendingGnuLongName !== undefined) {
        throw new ArtifactArchiveMismatch({
          reason: "malformed tar: duplicate GNU longname headers",
        });
      }
      const longName = readCString(payload, "gnu longname");
      // x-then-L: per-file PAX path already pending — do not guess precedence.
      assertNoMixedPathMetadata(pendingLocalOverrides?.path, longName);
      pendingGnuLongName = longName;
      continue;
    }
    if (typeflag === "K") {
      if (pendingGnuLongLink !== undefined) {
        throw new ArtifactArchiveMismatch({
          reason: "malformed tar: duplicate GNU longlink headers",
        });
      }
      const longLink = readCString(payload, "gnu longlink");
      // x-then-K: per-file PAX linkpath already pending — do not guess precedence.
      assertNoMixedLinkMetadata(pendingLocalOverrides?.linkpath, longLink);
      pendingGnuLongLink = longLink;
      continue;
    }

    const ustarName =
      prefix.length > 0 ? `${prefix}/${nameField}` : nameField;
    const gnuName = pendingGnuLongName;
    const gnuLink = pendingGnuLongLink;
    pendingGnuLongName = undefined;
    pendingGnuLongLink = undefined;

    const effective = mergePaxOverrides(
      globalOverrides,
      pendingLocalOverrides ?? {},
    );
    pendingLocalOverrides = undefined;

    // Reject any PAX (global or local) + GNU claim on the same field: bsdtar and
    // this parser disagree on precedence for several orderings (e.g. L then x).
    assertNoMixedPathMetadata(effective.path, gnuName);
    assertNoMixedLinkMetadata(effective.linkpath, gnuLink);

    const name = effective.path ?? gnuName ?? ustarName;
    const linkname = effective.linkpath ?? gnuLink ?? linknameField;

    members.push({
      name,
      typeflag,
      kind: kindFromTypeflag(typeflag),
      size,
      linkname,
    });
  }

  if (
    pendingLocalOverrides !== undefined ||
    pendingGnuLongName !== undefined ||
    pendingGnuLongLink !== undefined
  ) {
    throw new ArtifactArchiveMismatch({
      reason: "malformed tar: trailing extended header without a following member",
    });
  }

  return members;
};

const isAbsoluteMemberName = (name: string): boolean => {
  if (name.startsWith("/") || name.startsWith("\\")) {
    return true;
  }
  // Windows drive / UNC style
  if (/^[a-zA-Z]:[\\/]/u.test(name)) {
    return true;
  }
  if (name.startsWith("//") || name.startsWith("\\\\")) {
    return true;
  }
  return false;
};

/**
 * NFC-normalize one path segment and reject lone surrogates / empty segments.
 */
export const normalizePathSegment = (
  segment: string,
  pathForError: string,
): Effect.Effect<string, ArtifactArchiveMismatch> => {
  if (segment.length === 0 || segment === "." || segment === "..") {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: pathForError,
        reason:
          "archive member path must not contain empty, dot, or parent segments",
      }),
    );
  }
  if (hasLoneSurrogate(segment)) {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: pathForError,
        reason: "path segment contains a lone Unicode surrogate",
      }),
    );
  }
  return Effect.succeed(segment.normalize("NFC"));
};

/**
 * Normalize an inventory-relative path (no `package/` prefix) with per-segment NFC.
 */
export const normalizeInventoryPath = (
  relativePath: string,
): Effect.Effect<string, ArtifactArchiveMismatch> =>
  Effect.gen(function* () {
    if (relativePath.includes("\\")) {
      return yield* Effect.fail(
        new ArtifactArchiveMismatch({
          path: relativePath,
          reason: "inventory path must not contain backslashes",
        }),
      );
    }
    if (isAbsoluteMemberName(relativePath)) {
      return yield* Effect.fail(
        new ArtifactArchiveMismatch({
          path: relativePath,
          reason: "inventory path must not be absolute",
        }),
      );
    }
    if (relativePath.startsWith(ARTIFACT_PACKAGE_PREFIX)) {
      return yield* Effect.fail(
        new ArtifactArchiveMismatch({
          path: relativePath,
          reason: "inventory path must be relative to package/, not prefixed",
        }),
      );
    }
    const segments = relativePath.split("/");
    const normalized: Array<string> = [];
    for (const segment of segments) {
      normalized.push(yield* normalizePathSegment(segment, relativePath));
    }
    return normalized.join("/");
  });

/**
 * Collision key: NFC-normalized path plus filesystem-safe case fold.
 * `café` (NFC) and `café` (NFD) share one key and must fail as duplicates.
 */
export const archivePathCollisionKey = (normalizedRelativePath: string): string =>
  normalizedRelativePath.normalize("NFC").toLowerCase();

/**
 * Validate a single archive member path under the canonical package/ prefix.
 * Returns the NFC-normalized inventory-relative path (no package/ prefix).
 */
export const normalizeArchiveMemberPath = (
  memberName: string,
): Effect.Effect<string, ArtifactArchiveMismatch> => {
  if (memberName.includes("\\")) {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: memberName,
        reason: "archive member path must not contain backslashes",
      }),
    );
  }
  if (isAbsoluteMemberName(memberName)) {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: memberName,
        reason: "archive member path must not be absolute",
      }),
    );
  }
  if (!memberName.startsWith(ARTIFACT_PACKAGE_PREFIX)) {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: memberName,
        reason: `archive member must live under ${ARTIFACT_PACKAGE_PREFIX}`,
      }),
    );
  }
  const relative = memberName.slice(ARTIFACT_PACKAGE_PREFIX.length);
  if (relative.length === 0) {
    return Effect.fail(
      new ArtifactArchiveMismatch({
        path: memberName,
        reason: "archive member must be a file under package/, not the prefix alone",
      }),
    );
  }
  return normalizeInventoryPath(relative);
};

export type ArchivePreflightResult = {
  readonly relativePaths: ReadonlyArray<string>;
};

/**
 * Validate every tar member is a unique ordinary file under package/.
 * Does not yet compare against a manifest inventory.
 */
export const assertArchiveMembersWellFormed = (
  members: ReadonlyArray<TarMember>,
): Effect.Effect<ArchivePreflightResult, ArtifactArchiveMismatch> =>
  Effect.gen(function* () {
    const relativePaths: Array<string> = [];
    const seenExact = new Set<string>();
    const seenCollision = new Map<string, string>();

    for (const member of members) {
      if (member.kind !== "file") {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path: member.name,
            field: "type",
            actual: member.kind,
            expected: "file",
            reason: `archive member must be an ordinary regular file (rejected ${member.kind})`,
          }),
        );
      }
      if (member.linkname.length > 0) {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path: member.name,
            reason:
              "ordinary file members must not carry a link target (including PAX/GNU linkpath overrides)",
          }),
        );
      }

      const relative = yield* normalizeArchiveMemberPath(member.name);
      if (seenExact.has(relative)) {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path: relative,
            reason: "duplicate archive member path",
          }),
        );
      }
      const collisionKey = archivePathCollisionKey(relative);
      const prior = seenCollision.get(collisionKey);
      if (prior !== undefined) {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path: relative,
            expected: prior,
            actual: relative,
            reason:
              prior === relative
                ? "duplicate archive member path"
                : "duplicate normalized/case-colliding archive member path",
          }),
        );
      }
      seenExact.add(relative);
      seenCollision.set(collisionKey, relative);
      relativePaths.push(relative);
    }

    relativePaths.sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return { relativePaths };
  });

/**
 * Preflight: validate every tar member before extraction/read.
 * Exact member set must equal manifest file inventory ∪ required meta files.
 * Manifest paths and archive effective paths share the same NFC normalization.
 */
export const assertArchiveMembersMatchManifest = (
  members: ReadonlyArray<TarMember>,
  manifestFiles: ReadonlyArray<{ path: string }>,
): Effect.Effect<ArchivePreflightResult, ArtifactArchiveMismatch> =>
  Effect.gen(function* () {
    const wellFormed = yield* assertArchiveMembersWellFormed(members);
    const relativePaths = [...wellFormed.relativePaths];

    const expected = new Set<string>();
    for (const meta of ARTIFACT_REQUIRED_META_FILES) {
      expected.add(yield* normalizeInventoryPath(meta));
    }
    for (const file of manifestFiles) {
      expected.add(yield* normalizeInventoryPath(file.path));
    }
    const actual = new Set(relativePaths);

    for (const path of expected) {
      if (!actual.has(path)) {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path,
            expected: path,
            actual: "<missing>",
            reason:
              "archive member set missing a manifest or required metadata file",
          }),
        );
      }
    }
    for (const path of actual) {
      if (!expected.has(path)) {
        return yield* Effect.fail(
          new ArtifactArchiveMismatch({
            path,
            expected: "<absent>",
            actual: path,
            reason:
              "archive contains a member outside the manifest inventory and required metadata set",
          }),
        );
      }
    }

    return { relativePaths };
  });

export const preflightArchiveMembers = (
  tarballPath: string,
  manifestFiles: ReadonlyArray<{ path: string }>,
): Effect.Effect<ArchivePreflightResult, ArtifactArchiveMismatch> =>
  Effect.gen(function* () {
    const members = yield* Effect.try({
      try: () => listTarGzipMembers(tarballPath),
      catch: (error) =>
        error instanceof ArtifactArchiveMismatch
          ? error
          : new ArtifactArchiveMismatch({
              reason: `unable to list archive members: ${String(error)}`,
            }),
    });
    return yield* assertArchiveMembersMatchManifest(members, manifestFiles);
  });
