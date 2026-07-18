import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import {
  FixtureKeyRegistry,
  StreamEpochBaseline,
  TrustEnvelope,
  decodeFixtureKeyRegistry,
} from "./contracts.js";
import { ServiceKeyRegistry } from "./registry.js";

const ScenarioEnvelope = Schema.Struct({
  id: Schema.String,
  envelope: TrustEnvelope,
  expect: Schema.Literal("accept", "reject"),
  reject_reason: Schema.optional(Schema.String),
  reject_stage: Schema.optional(Schema.Literal("verify", "ingest")),
});

const ScenarioBaseline = Schema.Struct({
  id: Schema.String,
  baseline: StreamEpochBaseline,
});

export const FixtureScenarioBundle = Schema.Struct({
  schema_version: Schema.Literal(1),
  registry: FixtureKeyRegistry,
  envelopes: Schema.Array(ScenarioEnvelope),
  baselines: Schema.optionalWith(Schema.Array(ScenarioBaseline), { exact: true }),
}).annotations({ identifier: "FixtureScenarioBundle" });
export type FixtureScenarioBundle = Schema.Schema.Type<typeof FixtureScenarioBundle>;

export const decodeFixtureScenarioBundle = Schema.decodeUnknownSync(FixtureScenarioBundle);

export const fixtureRegistryFromBundle = (bundle: FixtureScenarioBundle): ServiceKeyRegistry =>
  new ServiceKeyRegistry(bundle.registry.keys);

export const readFixtureScenarioBundle = (): FixtureScenarioBundle => {
  const fixturesDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/scenarios",
  );
  const parsed: unknown = JSON.parse(
    readFileSync(join(fixturesDirectory, "producer-consumer.shared.json"), "utf8"),
  );
  return decodeFixtureScenarioBundle(parsed);
};

export const decodeFixtureKeyRegistryFromFile = (relativePath: string): ServiceKeyRegistry => {
  const fixturesDirectory = join(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures",
  );
  const parsed: unknown = JSON.parse(readFileSync(join(fixturesDirectory, relativePath), "utf8"));
  return new ServiceKeyRegistry(decodeFixtureKeyRegistry(parsed).keys);
};
