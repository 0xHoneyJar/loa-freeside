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
  Auth,
  AuthKind,
  CredentialsRef,
  CredentialsRefType,
} from "./auth.js";

// JSON Schema export for tooling (mirrors gateway's JSONSchema.make pattern at app.ts:208-210)
import { JSONSchema } from "effect";
import { BeaconV2Schema as _BeaconV2 } from "./beacon-v2.js";
export const BeaconV2JsonSchema = JSONSchema.make(_BeaconV2);
