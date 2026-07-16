import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  COLLECTION_PROTOCOL_SCHEMA_MINOR,
  COLLECTION_PROTOCOL_VERSION,
} from "../index.js";
import {
  PROTOCOL_IDENTITY_PATH,
  packArtifact,
  verifyArtifact,
  verifyLegacyArtifactSha256,
  ArtifactChecksumMismatch,
  ArtifactVersionMismatch,
  ArtifactManifestMismatch,
  ArtifactFixtureDigestMismatch,
  ArtifactArchiveMismatch,
  DuplicateJsonKey,
  assertReachableSourceCommit,
  SourceCommitError,
  sha256Hex,
  artifactErrorClass,
  decodeArtifactManifestJson,
  parseJsonStrict,
  listTarGzipMembers,
  preflightArchiveMembers,
} from "../harness/index.js";
import { expectEffectFailure, expectEffectSuccess } from "./test-helpers.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const headCommit = (): string =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: packageRoot,
    encoding: "utf8",
  }).trim();

const readManifest = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as {
    artifact_sha256: string;
    package_name: string;
    package_version: string;
    contract_schema: { major: number; minor: number };
    source_commit: string;
    source_tree_sha256: string;
    fixture_digests: Record<string, string>;
    files: Array<{ path: string; sha256: string; size: number }>;
  };

describe("CR-005 artifact harness", () => {
  it(
    "packs reproducible artifacts across two isolated clean build epochs",
    () => {
    const outA = join(packageRoot, ".tmp/harness-a");
    const outB = join(packageRoot, ".tmp/harness-b");
    rmSync(outA, { recursive: true, force: true });
    rmSync(outB, { recursive: true, force: true });
    mkdirSync(outA, { recursive: true });
    mkdirSync(outB, { recursive: true });

    const sourceCommit = headCommit();
    const first = packArtifact({
      packageRoot,
      outputDirectory: outA,
      sourceCommit,
      isolatedBuild: true,
    });
    const second = packArtifact({
      packageRoot,
      outputDirectory: outB,
      sourceCommit,
      isolatedBuild: true,
    });

    expect(first.manifest.artifact_sha256).toBe(second.manifest.artifact_sha256);
    expect(readFileSync(first.tarballPath)).toEqual(readFileSync(second.tarballPath));
    expect(readFileSync(first.manifestPath, "utf8")).toBe(
      readFileSync(second.manifestPath, "utf8"),
    );
    expect(sha256Hex(readFileSync(first.tarballPath))).toBe(
      first.manifest.artifact_sha256,
    );
    expect(first.manifest.package_name).toBe("@freeside/collection-protocol");
    expect(first.manifest.package_version).toBe(COLLECTION_PROTOCOL_VERSION);
    expect(first.manifest.contract_schema).toEqual({
      major: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
      minor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
    });
    expect(first.manifest.source_commit).toBe(sourceCommit);
    expect(first.manifest.source_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      Object.keys(first.manifest.fixture_digests).some((path) =>
        path.startsWith("fixtures/compatibility/"),
      ),
    ).toBe(true);
    expect(
      first.manifest.files.some((entry) => entry.path === PROTOCOL_IDENTITY_PATH),
    ).toBe(true);

    const extractRoot = join(packageRoot, ".tmp/harness-extract");
    rmSync(extractRoot, { recursive: true, force: true });
    mkdirSync(extractRoot, { recursive: true });
    execFileSync("tar", ["-xzf", first.tarballPath, "-C", extractRoot], {
      stdio: "pipe",
    });
    const identity = JSON.parse(
      readFileSync(join(extractRoot, "package", PROTOCOL_IDENTITY_PATH), "utf8"),
    );
    expect(identity).toEqual({
      package_name: "@freeside/collection-protocol",
      package_version: COLLECTION_PROTOCOL_VERSION,
      contract_schema: {
        major: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
        minor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
      },
      source_commit: sourceCommit,
    });

    expectEffectSuccess(
      verifyArtifact({
        tarballPath: first.tarballPath,
        manifest: JSON.parse(readFileSync(first.manifestPath, "utf8")),
        expectedPackageVersion: COLLECTION_PROTOCOL_VERSION,
        expectedContractMajor: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
        expectedContractMinor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
      }),
    );
  },
    120_000,
  );

  it(
    "excludes seeded stale dist from an isolated pack and matches a clean pack",
    () => {
    const cleanOut = join(packageRoot, ".tmp/harness-clean");
    const staleOut = join(packageRoot, ".tmp/harness-stale");
    rmSync(cleanOut, { recursive: true, force: true });
    rmSync(staleOut, { recursive: true, force: true });
    mkdirSync(cleanOut, { recursive: true });
    mkdirSync(staleOut, { recursive: true });

    const sourceCommit = headCommit();
    const clean = packArtifact({
      packageRoot,
      outputDirectory: cleanOut,
      sourceCommit,
      isolatedBuild: true,
    });

    // Seed stale generated outputs into the checkout dist — must not leak.
    mkdirSync(join(packageRoot, "dist/stale-seed"), { recursive: true });
    writeFileSync(
      join(packageRoot, "dist/stale-seed/extra-declaration.json"),
      '{"stale":true}\n',
      "utf8",
    );
    writeFileSync(
      join(packageRoot, "dist/__stale_decl.js"),
      "export const stale = true;\n",
      "utf8",
    );

    const seeded = packArtifact({
      packageRoot,
      outputDirectory: staleOut,
      sourceCommit,
      isolatedBuild: true,
    });

    expect(seeded.manifest.artifact_sha256).toBe(clean.manifest.artifact_sha256);
    expect(readFileSync(seeded.tarballPath)).toEqual(readFileSync(clean.tarballPath));
    const listing = execFileSync("tar", ["-tzf", seeded.tarballPath], {
      encoding: "utf8",
    });
    expect(listing).not.toContain("stale-seed");
    expect(listing).not.toContain("__stale_decl");
  },
    120_000,
  );

  it(
    "fails closed on identity, fixture, version, and checksum tampers without caller expectations",
    () => {
    const out = join(packageRoot, ".tmp/harness-tamper");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const packed = packArtifact({
      packageRoot,
      outputDirectory: out,
      sourceCommit: headCommit(),
      isolatedBuild: true,
    });
    const manifest = readManifest(packed.manifestPath);

    const tamperedTarball = join(out, "tampered.tgz");
    const originalBytes = readFileSync(packed.tarballPath);
    const mutated = Buffer.from(originalBytes);
    const lastIndex = mutated.length - 1;
    const lastByte = mutated[lastIndex];
    if (lastByte === undefined) {
      throw new Error("expected non-empty tarball");
    }
    mutated[lastIndex] = lastByte ^ 0xff;
    writeFileSync(tamperedTarball, mutated);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: tamperedTarball,
          manifest,
        }),
      ),
    ).toBeInstanceOf(ArtifactChecksumMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: { ...manifest, package_version: "9.9.9" },
        }),
      ),
    ).toBeInstanceOf(ArtifactManifestMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: {
            ...manifest,
            contract_schema: { major: 99, minor: 77 },
          },
        }),
      ),
    ).toBeInstanceOf(ArtifactManifestMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: { ...manifest, source_commit: "0".repeat(40) },
        }),
      ),
    ).toBeInstanceOf(ArtifactManifestMismatch);

    const missingFixture = {
      ...manifest,
      fixture_digests: { ...manifest.fixture_digests },
    };
    const fixtureKey = Object.keys(missingFixture.fixture_digests)[0];
    if (fixtureKey === undefined) {
      throw new Error("expected fixture digests");
    }
    delete missingFixture.fixture_digests[fixtureKey];
    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: missingFixture,
        }),
      ),
    ).toBeInstanceOf(ArtifactFixtureDigestMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: {
            ...manifest,
            fixture_digests: {
              ...manifest.fixture_digests,
              "fixtures/__extra__.json": "a".repeat(64),
            },
          },
        }),
      ),
    ).toBeInstanceOf(ArtifactFixtureDigestMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: {
            ...manifest,
            fixture_digests: {
              ...manifest.fixture_digests,
              [fixtureKey]: "f".repeat(64),
            },
          },
        }),
      ),
    ).toBeInstanceOf(ArtifactFixtureDigestMismatch);

    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest,
          expectedPackageVersion: "9.9.9",
        }),
      ),
    ).toBeInstanceOf(ArtifactVersionMismatch);

    expectEffectSuccess(
      verifyLegacyArtifactSha256(
        packed.tarballPath,
        sha256Hex(readFileSync(packed.tarballPath)),
      ),
    );
    expect(
      expectEffectFailure(
        verifyLegacyArtifactSha256(
          packed.tarballPath,
          "0000000000000000000000000000000000000000000000000000000000000000",
        ),
      ),
    ).toBeInstanceOf(ArtifactChecksumMismatch);
  });

  it("rejects zero and nonexistent source commits at pack time", () => {
    const out = join(packageRoot, ".tmp/harness-bad-commit");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    expect(() =>
      assertReachableSourceCommit(packageRoot, "0".repeat(40)),
    ).toThrow(SourceCommitError);

    expect(() =>
      assertReachableSourceCommit(
        packageRoot,
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    ).toThrow(SourceCommitError);

    expect(() =>
      packArtifact({
        packageRoot,
        outputDirectory: out,
        sourceCommit: "0".repeat(40),
        isolatedBuild: true,
      }),
    ).toThrow(SourceCommitError);

    expect(() =>
      packArtifact({
        packageRoot,
        outputDirectory: out,
        sourceCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        isolatedBuild: true,
      }),
    ).toThrow(SourceCommitError);
  });

  it("CLI strict-verify rejects missing fixture digests (no weaker fallback)", async () => {
    const out = join(packageRoot, ".tmp/harness-cli-strict");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const packed = packArtifact({
      packageRoot,
      outputDirectory: out,
      sourceCommit: headCommit(),
      isolatedBuild: true,
    });
    const manifest = readManifest(packed.manifestPath);
    const fixtureKey = Object.keys(manifest.fixture_digests)[0];
    if (fixtureKey === undefined) {
      throw new Error("expected fixture digests");
    }
    const missingPath = join(out, "missing-fixture.manifest.json");
    const missing = {
      ...manifest,
      fixture_digests: { ...manifest.fixture_digests },
    };
    delete missing.fixture_digests[fixtureKey];
    writeFileSync(missingPath, `${JSON.stringify(missing, null, 2)}\n`, "utf8");

    let failed = false;
    try {
      execFileSync(
        "node",
        [
          join(packageRoot, "scripts/verify-artifact.mjs"),
          "--tarball",
          packed.tarballPath,
          "--manifest",
          missingPath,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      failed = true;
      const stderr =
        error !== null &&
        typeof error === "object" &&
        "stderr" in error &&
        typeof (error as { stderr: unknown }).stderr === "string"
          ? (error as { stderr: string }).stderr
          : "";
      expect(stderr).toContain("ArtifactFixtureDigestMismatch");
    }
    expect(failed).toBe(true);

    // Parity: library path also fails the same class of error.
    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: packed.tarballPath,
          manifest: missing,
        }),
      ),
    ).toBeInstanceOf(ArtifactFixtureDigestMismatch);
  });

  it("does not create a package cycle: harness depends only on protocol locals", async () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies ?? {}).toEqual({});
    expect(Object.keys(packageJson.peerDependencies ?? {})).toEqual(["effect"]);

    const harnessSource = [
      "archive.ts",
      "compatibility.ts",
      "digests.ts",
      "identity.ts",
      "index.ts",
      "json-strict.ts",
      "manifest.ts",
      "pack.ts",
      "source.ts",
      "strict.ts",
      "verify.ts",
    ]
      .map((name) =>
        readFileSync(join(packageRoot, "src/harness", name), "utf8"),
      )
      .join("\n");
    expect(harnessSource).not.toMatch(
      /freeside-dashboard|sonar-api|inventory-api|@freeside\/(?:ordering|dashboard|sonar)/,
    );
  });

  it(
    "pack:artifact ignores behavior-changing checkout dist/harness/pack.js",
    () => {
      const cleanOut = join(packageRoot, ".tmp/harness-dist-poison-clean");
      const poisonOut = join(packageRoot, ".tmp/harness-dist-poison");
      rmSync(cleanOut, { recursive: true, force: true });
      rmSync(poisonOut, { recursive: true, force: true });
      mkdirSync(cleanOut, { recursive: true });
      mkdirSync(poisonOut, { recursive: true });

      const sourceCommit = headCommit();
      // Valid build into checkout dist, then capture a clean public pack.
      execFileSync("pnpm", ["run", "build"], {
        cwd: packageRoot,
        stdio: "pipe",
      });
      const cleanJson = execFileSync(
        "pnpm",
        [
          "run",
          "pack:artifact",
          "--",
          "--out",
          cleanOut,
          "--source-commit",
          sourceCommit,
        ],
        { cwd: packageRoot, encoding: "utf8" },
      );
      const cleanLine = cleanJson
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .join("\n");
      // pnpm run may wrap JSON; locate the artifact report object.
      const cleanReport = JSON.parse(
        cleanJson.includes('"artifact_sha256"')
          ? cleanJson.slice(cleanJson.indexOf("{"))
          : cleanLine,
      ) as { artifact_sha256: string; tarball: string };

      const packJs = join(packageRoot, "dist/harness/pack.js");
      const originalPackJs = readFileSync(packJs, "utf8");
      writeFileSync(
        packJs,
        `${originalPackJs}\nexport const packArtifact = () => { throw new Error("CHECKOUT_DIST_EXECUTED"); };\n`,
        "utf8",
      );

      try {
        const poisonJson = execFileSync(
          "pnpm",
          [
            "run",
            "pack:artifact",
            "--",
            "--out",
            poisonOut,
            "--source-commit",
            sourceCommit,
          ],
          { cwd: packageRoot, encoding: "utf8" },
        );
        const poisonReport = JSON.parse(
          poisonJson.slice(poisonJson.indexOf("{")),
        ) as { artifact_sha256: string; tarball: string };
        expect(poisonReport.artifact_sha256).toBe(cleanReport.artifact_sha256);
        expect(readFileSync(poisonReport.tarball)).toEqual(
          readFileSync(cleanReport.tarball),
        );
      } finally {
        writeFileSync(packJs, originalPackJs, "utf8");
      }
    },
    180_000,
  );

  it("rejects undeclared root file, symlinks, hardlink, duplicate members, case/NFC collisions, and extended-path overrides before extract", () => {
    const out = join(packageRoot, ".tmp/harness-archive-negatives");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const packed = packArtifact({
      packageRoot,
      outputDirectory: out,
      sourceCommit: headCommit(),
      isolatedBuild: true,
    });
    const manifest = readManifest(packed.manifestPath);
    const manifestText = readFileSync(packed.manifestPath, "utf8");

    const buildEvil = (mode: string): string => {
      const dest = join(out, `${mode}.tgz`);
      execFileSync(
        "python3",
        [
          "-",
          packed.tarballPath,
          dest,
          mode,
        ],
        {
          encoding: "utf8",
          input: `
import io, os, sys, tarfile, tempfile, shutil, struct

src, dest, mode = sys.argv[1], sys.argv[2], sys.argv[3]
work = tempfile.mkdtemp(prefix="cp-evil-")
try:
    with tarfile.open(src, "r:gz") as tf:
        tf.extractall(work)
    pkg = os.path.join(work, "package")

    def iter_files():
        for root, _dirs, files in os.walk(pkg):
            for name in files:
                path = os.path.join(root, name)
                yield path, os.path.relpath(path, work)

    def add_tree(out_tf, skip=None, rename=None):
        for path, arc in iter_files():
            if skip is not None and arc == skip:
                continue
            out_name = rename(arc) if rename else arc
            out_tf.add(path, arcname=out_name)

    def write_pax_record(key, value):
        body = f"{key}={value}\\n".encode("utf-8")
        # length includes the length digits, the space, and the trailing newline
        length = len(body)
        while True:
            prefix = f"{length} ".encode("utf-8")
            total = len(prefix) + len(body)
            if total == length:
                return prefix + body
            length = total

    def add_pax_header(out_tf, records, global_header=False):
        payload = b"".join(write_pax_record(k, v) for k, v in records.items())
        info = tarfile.TarInfo(name="././@PaxHeader")
        info.type = tarfile.XGLTYPE if global_header else tarfile.XHDTYPE
        info.size = len(payload)
        info.uid = 0
        info.gid = 0
        info.uname = "root"
        info.gname = "root"
        info.mtime = 0
        out_tf.addfile(info, io.BytesIO(payload))

    def add_regular(out_tf, arcname, data, pax=None, global_pax=None):
        if global_pax:
            add_pax_header(out_tf, global_pax, global_header=True)
        if pax:
            add_pax_header(out_tf, pax, global_header=False)
        info = tarfile.TarInfo(name=arcname)
        info.type = tarfile.REGTYPE
        info.size = len(data)
        info.uid = 0
        info.gid = 0
        info.uname = "root"
        info.gname = "root"
        info.mtime = 0
        out_tf.addfile(info, io.BytesIO(data))

    nfc_cafe = "caf\\u00e9"  # café NFC
    nfd_cafe = "cafe\\u0301"  # cafe + combining acute (NFD)

    with tarfile.open(dest, "w:gz", format=tarfile.USTAR_FORMAT) as out_tf:
        if mode == "undeclared_root":
            add_tree(out_tf)
            evil = os.path.join(work, "EVIL.txt")
            open(evil, "w").write("x\\n")
            out_tf.add(evil, arcname="EVIL.txt")
        elif mode == "abs_symlink":
            add_tree(out_tf)
            link = tarfile.TarInfo(name="package/abs-link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/tmp/evil"
            out_tf.addfile(link)
        elif mode == "rel_symlink":
            add_tree(out_tf)
            link = tarfile.TarInfo(name="package/rel-link")
            link.type = tarfile.SYMTYPE
            link.linkname = "package.json"
            out_tf.addfile(link)
        elif mode == "hardlink":
            first = None
            for path, arc in iter_files():
                out_tf.add(path, arcname=arc)
                if first is None:
                    first = arc
            link = tarfile.TarInfo(name="package/hard-link-extra")
            link.type = tarfile.LNKTYPE
            link.linkname = first
            out_tf.addfile(link)
        elif mode == "duplicate_member":
            first_path = first_arc = None
            for path, arc in iter_files():
                out_tf.add(path, arcname=arc)
                if first_path is None:
                    first_path, first_arc = path, arc
            out_tf.add(first_path, arcname=first_arc)
        elif mode == "case_collide":
            add_tree(out_tf)
            collide = os.path.join(work, "collide-bytes")
            open(collide, "w").write("x\\n")
            out_tf.add(collide, arcname="package/Package.json")
        elif mode == "pax_local_undeclared":
            # Exact probe: ustar name package/package.json, PAX path -> UNDECLARED.json
            for path, arc in iter_files():
                data = open(path, "rb").read()
                if arc == "package/package.json":
                    add_regular(
                        out_tf,
                        "package/package.json",
                        data,
                        pax={"path": "package/UNDECLARED.json"},
                    )
                else:
                    add_regular(out_tf, arc, data)
        elif mode == "pax_global_undeclared":
            first = True
            for path, arc in iter_files():
                data = open(path, "rb").read()
                if first:
                    add_regular(
                        out_tf,
                        arc,
                        data,
                        global_pax={"path": "package/UNDECLARED.json"},
                    )
                    first = False
                else:
                    # Subsequent members also inherit global path -> collision / undeclared
                    add_regular(out_tf, arc, data)
        elif mode == "malformed_pax":
            for path, arc in iter_files():
                data = open(path, "rb").read()
                if arc == "package/package.json":
                    # Length prefix claims more bytes than remain
                    payload = b"999 path=package/package.json\\n"
                    info = tarfile.TarInfo(name="././@PaxHeader")
                    info.type = tarfile.XHDTYPE
                    info.size = len(payload)
                    info.mtime = 0
                    out_tf.addfile(info, io.BytesIO(payload))
                    add_regular(out_tf, arc, data)
                else:
                    add_regular(out_tf, arc, data)
        elif mode == "unicode_nfc_collide":
            add_tree(out_tf)
            a = os.path.join(work, "nfc-bytes")
            b = os.path.join(work, "nfd-bytes")
            open(a, "wb").write(b"a\\n")
            open(b, "wb").write(b"b\\n")
            out_tf.add(a, arcname=f"package/{nfc_cafe}.json")
            out_tf.add(b, arcname=f"package/{nfd_cafe}.json")
        elif mode == "normalized_manifest_mismatch":
            # Archive effective path NFC-normalizes to a name absent from the manifest
            for path, arc in iter_files():
                data = open(path, "rb").read()
                if arc == "package/package.json":
                    add_regular(
                        out_tf,
                        "package/package.json",
                        data,
                        pax={"path": f"package/{nfd_cafe}-missing.json"},
                    )
                else:
                    add_regular(out_tf, arc, data)
        else:
            raise SystemExit(f"unknown mode {mode}")
finally:
    shutil.rmtree(work, ignore_errors=True)
`,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return dest;
    };

    // GNU longname needs GNU_FORMAT; craft separately so USTAR modes stay simple.
    const buildGnuLongname = (): string => {
      const dest = join(out, "gnu_longname_undeclared.tgz");
      execFileSync(
        "python3",
        ["-", packed.tarballPath, dest],
        {
          encoding: "utf8",
          input: `
import io, os, sys, tarfile, tempfile, shutil

src, dest = sys.argv[1], sys.argv[2]
work = tempfile.mkdtemp(prefix="cp-gnu-")
try:
    with tarfile.open(src, "r:gz") as tf:
        tf.extractall(work)
    pkg = os.path.join(work, "package")
    long_name = "package/" + ("u" * 120) + "-UNDECLARED.json"
    with tarfile.open(dest, "w:gz", format=tarfile.GNU_FORMAT) as out_tf:
        for root, _dirs, files in os.walk(pkg):
            for name in files:
                path = os.path.join(root, name)
                arc = os.path.relpath(path, work)
                data = open(path, "rb").read()
                info = tarfile.TarInfo(name=long_name if arc == "package/package.json" else arc)
                info.type = tarfile.REGTYPE
                info.size = len(data)
                info.mtime = 0
                out_tf.addfile(info, io.BytesIO(data))
finally:
    shutil.rmtree(work, ignore_errors=True)
`,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return dest;
    };

    const cases = [
      "undeclared_root",
      "abs_symlink",
      "rel_symlink",
      "hardlink",
      "duplicate_member",
      "case_collide",
      "pax_local_undeclared",
      "pax_global_undeclared",
      "malformed_pax",
      "unicode_nfc_collide",
      "normalized_manifest_mismatch",
    ] as const;

    for (const label of cases) {
      const evil = buildEvil(label);
      const libraryFailure = expectEffectFailure(
        verifyArtifact({
          tarballPath: evil,
          manifest: {
            ...manifest,
            artifact_sha256: sha256Hex(readFileSync(evil)),
          },
        }),
      );
      expect(libraryFailure).toBeInstanceOf(ArtifactArchiveMismatch);
      expect(
        expectEffectFailure(preflightArchiveMembers(evil, manifest.files)),
      ).toBeInstanceOf(ArtifactArchiveMismatch);
    }

    const gnuEvil = buildGnuLongname();
    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: gnuEvil,
          manifest: {
            ...manifest,
            artifact_sha256: sha256Hex(readFileSync(gnuEvil)),
          },
        }),
      ),
    ).toBeInstanceOf(ArtifactArchiveMismatch);
    expect(
      expectEffectFailure(preflightArchiveMembers(gnuEvil, manifest.files)),
    ).toBeInstanceOf(ArtifactArchiveMismatch);

    // Exact PAX path-override probe: raw ustar package/package.json -> UNDECLARED.
    const paxMembers = listTarGzipMembers(buildEvil("pax_local_undeclared"));
    expect(
      paxMembers.some((member) => member.name === "package/UNDECLARED.json"),
    ).toBe(true);
    expect(
      paxMembers.some((member) => member.name === "package/package.json"),
    ).toBe(false);

    // Exact mixed-metadata regression: L then x then ordinary member.
    // bsdtar uses the GNU longname; a naive PAX-wins merge would report pax-safe.
    // Harness must reject before extraction — never guess precedence.
    const buildMixedPath = (): string => {
      const dest = join(out, "mixed_gnu_pax_path.tgz");
      execFileSync("python3", ["-", dest], {
        encoding: "utf8",
        input: `
import gzip, sys

dest = sys.argv[1]

def ustar_header(name, size, typeflag, linkname=""):
    def enc(s, n):
        b = s.encode("utf-8") if isinstance(s, str) else s
        return b + b"\\x00" * (n - len(b))
    def octal(v, n):
        s = oct(v)[2:]
        body = s.encode("ascii").rjust(n - 1, b"0") + b"\\x00"
        if len(body) != n:
            body = (s + " ").encode("ascii").rjust(n, b"0")[:n]
        return body
    hdr = bytearray(512)
    hdr[0:100] = enc(name, 100)
    hdr[100:108] = octal(0o644, 8)
    hdr[108:116] = octal(0, 8)
    hdr[116:124] = octal(0, 8)
    hdr[124:136] = octal(size, 12)
    hdr[136:148] = octal(0, 12)
    hdr[148:156] = b"        "
    hdr[156] = ord(typeflag)
    hdr[157:257] = enc(linkname, 100)
    hdr[257:263] = b"ustar\\x00"
    hdr[263:265] = b"00"
    hdr[265:297] = enc("root", 32)
    hdr[297:329] = enc("root", 32)
    hdr[329:337] = octal(0, 8)
    hdr[337:345] = octal(0, 8)
    chksum = sum(hdr) & 0o777777
    hdr[148:156] = octal(chksum, 8)
    return bytes(hdr)

def pad(data):
    rem = (512 - (len(data) % 512)) % 512
    return data + b"\\x00" * rem

def pax_payload(records):
    out = b""
    for k, v in records.items():
        body = f"{k}={v}\\n".encode()
        length = len(body)
        while True:
            prefix = f"{length} ".encode()
            total = len(prefix) + len(body)
            if total == length:
                out += prefix + body
                break
            length = total
    return out

content = b"payload\\n"
parts = []
lp = b"package/gnu-evil.txt\\x00"
parts += [ustar_header("././@LongLink", len(lp), "L"), pad(lp)]
pp = pax_payload({"path": "package/pax-safe.txt"})
parts += [ustar_header("././@PaxHeader", len(pp), "x"), pad(pp)]
parts += [ustar_header("package/short.txt", len(content), "0"), pad(content)]
parts += [b"\\x00" * 1024]
with gzip.open(dest, "wb") as f:
    f.write(b"".join(parts))
`,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return dest;
    };

    const buildMixedLink = (): string => {
      const dest = join(out, "mixed_gnu_pax_linkpath.tgz");
      execFileSync("python3", ["-", dest], {
        encoding: "utf8",
        input: `
import gzip, sys

dest = sys.argv[1]

def ustar_header(name, size, typeflag, linkname=""):
    def enc(s, n):
        b = s.encode("utf-8") if isinstance(s, str) else s
        return b + b"\\x00" * (n - len(b))
    def octal(v, n):
        s = oct(v)[2:]
        body = s.encode("ascii").rjust(n - 1, b"0") + b"\\x00"
        if len(body) != n:
            body = (s + " ").encode("ascii").rjust(n, b"0")[:n]
        return body
    hdr = bytearray(512)
    hdr[0:100] = enc(name, 100)
    hdr[100:108] = octal(0o644, 8)
    hdr[108:116] = octal(0, 8)
    hdr[116:124] = octal(0, 8)
    hdr[124:136] = octal(size, 12)
    hdr[136:148] = octal(0, 12)
    hdr[148:156] = b"        "
    hdr[156] = ord(typeflag)
    hdr[157:257] = enc(linkname, 100)
    hdr[257:263] = b"ustar\\x00"
    hdr[263:265] = b"00"
    hdr[265:297] = enc("root", 32)
    hdr[297:329] = enc("root", 32)
    hdr[329:337] = octal(0, 8)
    hdr[337:345] = octal(0, 8)
    chksum = sum(hdr) & 0o777777
    hdr[148:156] = octal(chksum, 8)
    return bytes(hdr)

def pad(data):
    rem = (512 - (len(data) % 512)) % 512
    return data + b"\\x00" * rem

def pax_payload(records):
    out = b""
    for k, v in records.items():
        body = f"{k}={v}\\n".encode()
        length = len(body)
        while True:
            prefix = f"{length} ".encode()
            total = len(prefix) + len(body)
            if total == length:
                out += prefix + body
                break
            length = total
    return out

parts = []
kp = b"package/gnu-target\\x00"
parts += [ustar_header("././@LongLink", len(kp), "K"), pad(kp)]
pp = pax_payload({"linkpath": "package/pax-target"})
parts += [ustar_header("././@PaxHeader", len(pp), "x"), pad(pp)]
parts += [ustar_header("package/link", 0, "2", linkname="short"), pad(b"")]
parts += [b"\\x00" * 1024]
with gzip.open(dest, "wb") as f:
    f.write(b"".join(parts))
`,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return dest;
    };

    const mixedPath = buildMixedPath();
    const mixedLink = buildMixedLink();
    // bsdtar still extracts via GNU precedence — prove the tool/parser split exists.
    const listedByTar = execFileSync("tar", ["-tzf", mixedPath], {
      encoding: "utf8",
    }).trim();
    expect(listedByTar).toBe("package/gnu-evil.txt");
    expect(() => listTarGzipMembers(mixedPath)).toThrow(ArtifactArchiveMismatch);
    expect(() => listTarGzipMembers(mixedLink)).toThrow(ArtifactArchiveMismatch);
    expect(
      expectEffectFailure(preflightArchiveMembers(mixedPath, manifest.files)),
    ).toBeInstanceOf(ArtifactArchiveMismatch);
    expect(
      expectEffectFailure(preflightArchiveMembers(mixedLink, manifest.files)),
    ).toBeInstanceOf(ArtifactArchiveMismatch);
    expect(
      expectEffectFailure(
        verifyArtifact({
          tarballPath: mixedPath,
          manifest: {
            ...manifest,
            artifact_sha256: sha256Hex(readFileSync(mixedPath)),
          },
        }),
      ),
    ).toBeInstanceOf(ArtifactArchiveMismatch);

    for (const member of listTarGzipMembers(packed.tarballPath)) {
      expect(member.kind).toBe("file");
      expect(member.name.startsWith("package/")).toBe(true);
    }
    expectEffectSuccess(
      verifyArtifact({
        tarballPath: packed.tarballPath,
        manifest: manifestText,
      }),
    );
  }, 180_000);

  it("CLI and library share one verdict for nested excess and duplicate JSON keys", () => {
    const out = join(packageRoot, ".tmp/harness-manifest-equivalence");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const packed = packArtifact({
      packageRoot,
      outputDirectory: out,
      sourceCommit: headCommit(),
      isolatedBuild: true,
    });
    const base = readManifest(packed.manifestPath);

    const vectors: Array<{
      name: string;
      text: string;
      expectedTag: string;
    }> = [
      {
        name: "nested-contract-schema-excess",
        text: `${JSON.stringify(
          {
            ...base,
            contract_schema: {
              major: base.contract_schema.major,
              minor: base.contract_schema.minor,
              extra: true,
            },
          },
          null,
          2,
        )}\n`,
        expectedTag: "ParseError",
      },
      {
        name: "nested-files-entry-excess",
        text: `${JSON.stringify(
          {
            ...base,
            files: base.files.map((entry, index) =>
              index === 0 ? { ...entry, extra: true } : entry,
            ),
          },
          null,
          2,
        )}\n`,
        expectedTag: "ParseError",
      },
      {
        name: "top-level-excess",
        text: `${JSON.stringify({ ...base, unexpected: 1 }, null, 2)}\n`,
        expectedTag: "ParseError",
      },
      {
        name: "equal-duplicate-json-key",
        text: `{\n  "manifest_version": 1,\n  "manifest_version": 1,\n  "package_name": ${JSON.stringify(base.package_name)}\n}\n`,
        expectedTag: "DuplicateJsonKey",
      },
      {
        name: "valid",
        text: readFileSync(packed.manifestPath, "utf8"),
        expectedTag: "ok",
      },
    ];

    const runCli = (manifestPath: string): { ok: boolean; tag: string } => {
      try {
        execFileSync(
          "node",
          [
            join(packageRoot, "scripts/verify-artifact.mjs"),
            "--tarball",
            packed.tarballPath,
            "--manifest",
            manifestPath,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return { ok: true, tag: "ok" };
      } catch (error) {
        const stderr =
          error !== null &&
          typeof error === "object" &&
          "stderr" in error &&
          typeof (error as { stderr: unknown }).stderr === "string"
            ? (error as { stderr: string }).stderr
            : "";
        try {
          const parsed = JSON.parse(stderr) as { tag?: string };
          return { ok: false, tag: parsed.tag ?? "ArtifactVerifyFailure" };
        } catch {
          return { ok: false, tag: "ArtifactVerifyFailure" };
        }
      }
    };

    for (const vector of vectors) {
      const manifestPath = join(out, `${vector.name}.manifest.json`);
      writeFileSync(manifestPath, vector.text, "utf8");

      if (vector.expectedTag === "ok") {
        expectEffectSuccess(
          verifyArtifact({
            tarballPath: packed.tarballPath,
            manifest: vector.text,
          }),
        );
        expect(runCli(manifestPath)).toEqual({ ok: true, tag: "ok" });
        continue;
      }

      if (vector.expectedTag === "DuplicateJsonKey") {
        expect(() => parseJsonStrict(vector.text)).toThrow(DuplicateJsonKey);
        const libraryFailure = expectEffectFailure(
          decodeArtifactManifestJson(vector.text),
        );
        expect(artifactErrorClass(libraryFailure)).toBe("DuplicateJsonKey");
      } else {
        const libraryFailure = expectEffectFailure(
          verifyArtifact({
            tarballPath: packed.tarballPath,
            manifest: vector.text,
          }),
        );
        expect(artifactErrorClass(libraryFailure)).toBe(vector.expectedTag);
      }

      const cli = runCli(manifestPath);
      expect(cli.ok).toBe(false);
      expect(cli.tag).toBe(vector.expectedTag);
    }
  }, 180_000);
});
