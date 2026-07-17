import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  decodeNetworkRef,
  decodeCollectionDeploymentRef,
  makeCollectionDeploymentRef,
  decodeCollectionCandidate,
} from "../index.js";
import {
  UnsupportedContractMajor,
  UnsupportedContractMinor,
  checkContractCompatibility,
  decodeConsumerSupport,
} from "../harness/index.js";
import {
  expectEffectFailure,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const CompatibilityCase = Schema.Struct({
  produced_contract_schema: Schema.Struct({
    major: Schema.Number,
    minor: Schema.Number,
  }),
  consumer_support: Schema.Struct({
    major: Schema.Number,
    min_minor: Schema.Number,
    max_minor: Schema.Number,
  }),
  expect: Schema.Literal(
    "compatible",
    "unsupported_major",
    "unsupported_minor",
  ),
});
const decodeCompatibilityCase = Schema.decodeUnknown(CompatibilityCase, {
  errors: "all",
  onExcessProperty: "error",
});

describe("CR-005 compatibility fixtures", () => {
  it("accepts EVM and Solana deployment inputs and full refs", () => {
    const evmInput = expectEffectSuccess(
      makeCollectionDeploymentRef(
        readFixture("compatibility/deployment-input.evm.valid.json"),
      ),
    );
    const evmFull = expectEffectSuccess(
      decodeCollectionDeploymentRef(
        readFixture("compatibility/deployment-ref.evm.full.valid.json"),
      ),
    );
    expect(evmInput.deployment_id).toEqual(evmFull.deployment_id);

    const solInput = expectEffectSuccess(
      makeCollectionDeploymentRef(
        readFixture("compatibility/deployment-input.solana.valid.json"),
      ),
    );
    const solFull = expectEffectSuccess(
      decodeCollectionDeploymentRef(
        readFixture("compatibility/deployment-ref.solana.full.valid.json"),
      ),
    );
    expect(solInput.deployment_id).toEqual(solFull.deployment_id);
  });

  it("publishes explicit equivalence via the multi-deployment candidate fixture", () => {
    const candidate = expectEffectSuccess(
      decodeCollectionCandidate(
        readFixture("multiple-deployments-unknown-standard.valid.json"),
      ),
    );
    expect(candidate.identity.equivalence_basis.kind).toBe("registry");
    expect(candidate.identity.deployments).toHaveLength(2);
  });

  it("rejects unknown wire major, excess properties, grafted and malformed digests", () => {
    expectEffectFailure(
      decodeNetworkRef(readFixture("compatibility/unknown-major.invalid.json")),
    );
    expectEffectFailure(
      decodeCollectionDeploymentRef(
        readFixture("compatibility/excess-property.invalid.json"),
      ),
    );
    expectEffectFailure(
      decodeCollectionDeploymentRef(
        readFixture("compatibility/grafted-digest.invalid.json"),
      ),
    );
    expectEffectFailure(
      decodeCollectionDeploymentRef(
        readFixture("compatibility/malformed-digest-domain.invalid.json"),
      ),
    );
  });

  it("defines clear mixed-minor and unknown-major compatibility outcomes", () => {
    for (const name of [
      "compatibility/mixed-minor.supported.json",
      "compatibility/mixed-minor.unsupported.json",
      "compatibility/unknown-major.compat.invalid.json",
    ] as const) {
      const fixture = expectEffectSuccess(
        decodeCompatibilityCase(readFixture(name)),
      );
      const support = expectEffectSuccess(
        decodeConsumerSupport(fixture.consumer_support),
      );
      const result = checkContractCompatibility(
        fixture.produced_contract_schema,
        support,
      );
      if (fixture.expect === "compatible") {
        expectEffectSuccess(result);
        continue;
      }
      const error = expectEffectFailure(result);
      if (fixture.expect === "unsupported_major") {
        expect(error).toBeInstanceOf(UnsupportedContractMajor);
      } else {
        expect(error).toBeInstanceOf(UnsupportedContractMinor);
      }
    }
  });
});
