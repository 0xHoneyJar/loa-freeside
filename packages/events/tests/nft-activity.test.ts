import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema as S } from "@effect/schema";
import { NftActivitySchema } from "../src/schemas/nft-activity.js";
import { nftActivityTopic, NFT_ACTIVITY_WILDCARD } from "../src/topics.js";
import { NftActivityId, lookupSchema } from "../src/registry.js";

const decode = S.decodeUnknownSync(NftActivitySchema);

const evmMint = {
  verb: "mint", chain: "evm", collection_key: "mibera", asset_ref: "123",
  from: null, to: "0x000000000000000000000000000000000000dead", value: null, decimals: null,
  tx: "0x" + "a".repeat(64), timestamp: "2025-01-01T00:00:00Z",
  metadata: { chain: "evm", chain_id: 80094, contract: "0x" + "b".repeat(40), token_id: "123", log_index: 0, block_number: 100 },
};

const svmSale = {
  verb: "sale", chain: "svm", collection_key: "pythians", asset_ref: "JE8VKG6sUqQgz",
  from: "5xJewztrSeller", to: "2Y1uiDUpBuyer", value: "3087000000", decimals: 9,
  tx: "65SgkNWqSig", timestamp: "2025-02-02T19:47:00Z",
  metadata: { chain: "svm", collection_mint: "pyTh2UtBKfuDW6KCdT3swospYeoLmmKaGujWA91Moru", nft_mint: "JE8VKG6sUqQgz", instruction_index: 0, slot: 314801673, marketplace: "MAGIC_EDEN" },
};

describe("NftActivitySchema", () => {
  it("accepts a valid EVM mint activity", () => {
    const v = decode(evmMint);
    assert.equal(v.verb, "mint");
    assert.equal(v.from, null);
    assert.equal(v.metadata.chain, "evm");
  });

  it("accepts a valid SVM sale activity (resolved buyer/seller + decimal-string value)", () => {
    const v = decode(svmSale);
    assert.equal(v.verb, "sale");
    assert.equal(v.value, "3087000000"); // decimal string — no float precision loss
    assert.equal(v.decimals, 9);
    assert.equal(v.metadata.chain, "svm");
    if (v.metadata.chain === "svm") assert.equal(v.metadata.marketplace, "MAGIC_EDEN");
  });

  it("rejects a non-decimal value (float / scientific would lose precision)", () => {
    assert.throws(() => decode({ ...svmSale, value: "3.087" }));
  });

  it("rejects an unknown verb", () => {
    assert.throws(() => decode({ ...evmMint, verb: "stake" }));
  });

  it("rejects metadata whose chain discriminant doesn't match a union member", () => {
    assert.throws(() => decode({ ...evmMint, metadata: { chain: "aptos", foo: 1 } }));
  });

  it("rejects an empty asset_ref / tx", () => {
    assert.throws(() => decode({ ...evmMint, asset_ref: "" }));
    assert.throws(() => decode({ ...evmMint, tx: "" }));
  });

  // --- FAGAN-hardening invariants ---
  it("MED-2: rejects a collection_key that validates loosely but can't be a topic segment (underscore / leading digit)", () => {
    assert.throws(() => decode({ ...svmSale, collection_key: "genesis_stones" }));
    assert.throws(() => decode({ ...svmSale, collection_key: "7pixies" }));
  });
  it("LOW-1: rejects top-level chain diverging from metadata.chain", () => {
    assert.throws(() => decode({ ...evmMint, chain: "svm" })); // metadata still evm
  });
  it("LOW-5: rejects a value without decimals", () => {
    assert.throws(() => decode({ ...svmSale, decimals: null })); // value set, decimals null
  });
  it("LOW-2: rejects empty-string from/to (null is fine for mint/burn)", () => {
    assert.throws(() => decode({ ...svmSale, from: "" }));
    assert.doesNotThrow(() => decode({ ...evmMint })); // from:null on a mint is valid
  });
});

describe("nftActivityTopic", () => {
  it("builds the 3-segment versioned subject with a collection specifier", () => {
    assert.equal(nftActivityTopic({ collectionSlug: "pythians" }), "nft.activity.recorded.pythians.v1");
  });
  it("builds the base subject with no specifier", () => {
    assert.equal(nftActivityTopic(), "nft.activity.recorded.v1");
  });
  it("exposes the wildcard for subscribers", () => {
    assert.equal(NFT_ACTIVITY_WILDCARD, "nft.activity.recorded.>");
  });
});

describe("registry binding", () => {
  it("NftActivityId resolves to the schema + builds the subject", () => {
    const entry = lookupSchema(NftActivityId);
    assert.ok(entry, "NftActivityId must be registered");
    assert.equal(NftActivityId as unknown as string, "nft.activity.recorded.v1");
    assert.equal(entry!.buildSubject("pythians"), "nft.activity.recorded.pythians.v1");
  });
});
