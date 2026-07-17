import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema as S } from "@effect/schema";
import {
  lookupSchema,
  schemaId,
  NftMintDetectedId,
  REGISTRY_ENTRIES,
  REVIEWED_TRANSFORMS,
} from "../src/registry.js";
import { jcsCanonicalize } from "../src/jcs.js";

const VALID_MINT = {
  chain_id: 80094,
  contract: "0x" + "a".repeat(40),
  token_id: "1",
  minter: "0x" + "b".repeat(40),
  block_number: 100,
  transaction_hash: "0x" + "c".repeat(64),
  timestamp: "2026-05-31T00:00:00Z",
};

describe("registry (FR-1, FR-2)", () => {
  it("FR-2: no two entries share a SchemaId (collision = build-time error)", () => {
    const ids = REGISTRY_ENTRIES.map((e) => e.id as string);
    assert.equal(new Set(ids).size, ids.length, "duplicate SchemaId in REGISTRY_ENTRIES");
  });

  it("SKP-004: every transform:true entry is on the reviewed-transforms list", () => {
    const transforming = REGISTRY_ENTRIES.filter((e) => e.transform).map((e) => e.id as string);
    for (const id of transforming) {
      assert.ok(
        REVIEWED_TRANSFORMS.includes(id),
        `transform:true entry "${id}" must be in REVIEWED_TRANSFORMS`,
      );
    }
  });

  it("SKP-004: non-transform schemas round-trip under JCS (signed bytes == submitted)", () => {
    for (const e of REGISTRY_ENTRIES.filter((x) => !x.transform)) {
      if (e.id === (NftMintDetectedId as string)) {
        const validated = S.validateSync(e.schema)(VALID_MINT);
        assert.equal(
          jcsCanonicalize(validated),
          jcsCanonicalize(VALID_MINT),
          `validate() must not mutate payload for "${e.id as string}"`,
        );
      }
    }
  });

  it("FR-1: lookupSchema resolves a known id and its buildSubject", () => {
    const entry = lookupSchema(NftMintDetectedId);
    assert.ok(entry, "NftMintDetectedId must resolve");
    assert.equal(entry!.id, NftMintDetectedId);
    assert.equal(entry!.buildSubject("mibera-shadow"), "nft.mint.detected.mibera-shadow.v1");
  });

  it("SKP-001: lookupSchema returns undefined (NOT throw) for an unknown id", () => {
    const bogus = schemaId("does.not.exist.v1", S.Unknown);
    assert.equal(lookupSchema(bogus), undefined);
  });
});
