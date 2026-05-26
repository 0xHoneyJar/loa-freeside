import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTopic, nftMintDetectedTopic, NFT_MINT_DETECTED_WILDCARD } from "../src/topics.js";

describe("buildTopic", () => {
  it("builds a 3-segment versioned topic", () => {
    const topic = buildTopic({ aggregate: "nft", noun: "mint", verb: "detected", version: 1 });
    assert.equal(topic, "nft.mint.detected.v1");
  });

  it("builds a 4-segment (with specifier) versioned topic", () => {
    const topic = buildTopic({
      aggregate: "nft",
      noun: "mint",
      verb: "detected",
      specifier: "mibera-shadow",
      version: 1,
    });
    assert.equal(topic, "nft.mint.detected.mibera-shadow.v1");
  });

  it("rejects uppercase segments", () => {
    assert.throws(() =>
      buildTopic({ aggregate: "NFT", noun: "mint", verb: "detected", version: 1 }),
    );
  });

  it("rejects underscores in segments", () => {
    assert.throws(() =>
      buildTopic({ aggregate: "nft", noun: "mint_event", verb: "detected", version: 1 }),
    );
  });

  it("rejects version 0 and negative versions", () => {
    assert.throws(() => buildTopic({ aggregate: "a", noun: "b", verb: "c", version: 0 }));
    assert.throws(() => buildTopic({ aggregate: "a", noun: "b", verb: "c", version: -1 }));
  });

  it("rejects non-integer versions", () => {
    assert.throws(() => buildTopic({ aggregate: "a", noun: "b", verb: "c", version: 1.5 }));
  });
});

describe("nftMintDetectedTopic", () => {
  it("defaults to catch-all v1 when no slug given", () => {
    assert.equal(nftMintDetectedTopic(), "nft.mint.detected.v1");
  });

  it("includes the slug when given", () => {
    assert.equal(
      nftMintDetectedTopic({ collectionSlug: "purupuru-apiculture" }),
      "nft.mint.detected.purupuru-apiculture.v1",
    );
  });

  it("supports an explicit version override", () => {
    assert.equal(
      nftMintDetectedTopic({ collectionSlug: "mibera-shadow", version: 2 }),
      "nft.mint.detected.mibera-shadow.v2",
    );
  });
});

describe("wildcard constant", () => {
  it("is the NATS catch-all under the nft-mint-detected hierarchy", () => {
    assert.equal(NFT_MINT_DETECTED_WILDCARD, "nft.mint.detected.>");
  });
});
