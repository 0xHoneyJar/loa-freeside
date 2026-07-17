/**
 * @0xhoneyjar/beacon-schema · Cycle C v0.3 federation broadcast
 *
 * Sealed Effect Schema for the MCP federation beacon contract.
 * Authority for `beacon.yaml` v2 shape. Consumed by:
 *   - freeside-mcp-gateway (boot-time validation + cache)
 *   - per-construct build steps (YAML→JSON adapter via build-beacon-json CLI)
 *   - Cycle D docs/DX (additive PR extending docs.* block)
 */

export {
  BeaconV2Schema,
  decodeBeacon,
  encodeBeacon,
  type BeaconV2,
} from "./beacon-v2.js";

export {
  BeaconV3Schema,
  decodeBeaconV3,
  encodeBeaconV3,
  validateBeaconV3,
  type BeaconV3,
} from "./beacon-v3.js";

export {
  Auth,
  AuthKind,
  CredentialsRef,
  CredentialsRefType,
} from "./auth.js";

export {
  validateAcvpBindings,
  ACVP_L1_SCHEMA_VERSION,
  type AcvpBindingType,
  type AcvpSeverity,
  type AcvpProofReceipt,
  type AcvpAllowlistEntry,
  type AcvpBindingFinding,
  type AcvpBindingReport,
  type ValidateAcvpBindingsInput,
} from "./acvp-bindings.js";

// JSON Schema exports for tooling (mirrors gateway's JSONSchema.make pattern at app.ts:208-210)
import { JSONSchema } from "effect";
import { BeaconV2Schema as _BeaconV2 } from "./beacon-v2.js";
import { BeaconV3Schema as _BeaconV3 } from "./beacon-v3.js";
export const BeaconV2JsonSchema = JSONSchema.make(_BeaconV2);
export const BeaconV3JsonSchema = JSONSchema.make(_BeaconV3);

export {
  type OrientationPacket,
  type OrientationVerdict,
  type BeaconClassification,
  type VerdictDetail,
  type OrientationRegistryInput,
  type OrientationBeaconInput,
  type OrientationProbeInput,
  buildOrientationPacket,
  BEACON_EXIT,
} from "./orientation-packet.js";
