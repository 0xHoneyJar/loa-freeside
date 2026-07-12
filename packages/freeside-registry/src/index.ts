/**
 * @freeside/freeside-registry · public API
 */

export {
  loadRegistry,
  buildCompactManifest,
  type Registry,
  type ModuleEntry,
  type VisibilityLevel,
  type CompactModuleEntry,
  type FederationManifest,
  // ── ADR-012 Phase 0 (cadence-ledger): contract types for Phase 1–3 consumers
  // and the next-cycle loa-cli probe_kind dispatch — import, never re-declare.
  type ServiceBlock,
  type Expectation,
  type HttpExpectation,
  type GraphqlLagExpectation,
  type EventMaxAgeExpectation,
} from "./registry.js";

export {
  loadBeacon,
  loadBeaconFromText,
  resolveFixturePath,
  classifyBeacon,
  type BeaconResolution,
} from "./beacon-loader.js";
