/**
 * @freeside/freeside-registry · public API
 */

export {
  loadRegistry,
  buildFreesideManifest,
  type Registry,
  type ModuleEntry,
  type VisibilityLevel,
  type FreesideModuleEntry,
  type FreesideManifest,
} from "./registry.js";

export {
  loadBeacon,
  type BeaconLoadResult,
  type BeaconLoader,
} from "./beacon-loader.js";
