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
} from "./registry.js";

export {
  loadBeacon,
  resolveFixturePath,
  classifyBeacon,
  type BeaconResolution,
} from "./beacon-loader.js";
