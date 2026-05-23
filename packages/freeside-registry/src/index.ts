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
  buildCatalog,
  type BuildingBeaconSummary,
  type CatalogBuilding,
  type BuildingCatalog,
} from "./catalog.js";
