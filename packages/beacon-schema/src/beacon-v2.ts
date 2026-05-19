import { Schema } from "effect";
import { Auth } from "./auth.js";

const McpShape = Schema.Literal("data", "tool", "proxy");
const McpCapability = Schema.Literal(
  "tools",
  "resources",
  "prompts",
  "sampling",
  "logging",
);
const TransportPath = Schema.Literal("stdio", "remote-http");

const RemoteTransport = Schema.Struct({
  transport: Schema.Literal("streamable-http", "sse"),
  endpoint: Schema.String.annotations({
    description:
      "Full URL OR template like ${MCP_REMOTE_ENDPOINT} (resolved at construct deploy time)",
  }),
});

const PricingModel = Schema.Literal(
  "free",
  "per-call",
  "subscription",
  "pay-per-call",
);

const Pricing = Schema.Struct({
  model: PricingModel,
  unitUsd: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  description: Schema.String.pipe(Schema.maxLength(200)),
}).annotations({
  identifier: "Pricing",
  description:
    "Pricing declaration · free is v1 default for first-party tenants",
});

const Tier = Schema.Array(Schema.String).pipe(Schema.maxItems(50));
const Tiers = Schema.Struct({
  hard: Schema.optional(Tier).annotations({
    description:
      "Substrate-truth fields · MUST match exactly (anti-hallucination)",
  }),
  soft: Schema.optional(Tier).annotations({
    description:
      "Substrate-truth context · paraphrase OK (LLM enrichment)",
  }),
  llm_owned: Schema.optional(Tier).annotations({
    description:
      "LLM-generated fields · no substrate truth (creative latitude)",
  }),
});

const SourceOfTruth = Schema.Struct({
  type: Schema.Literal("git_repo", "database", "api", "static_file"),
  files: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(50))),
  url: Schema.optional(Schema.String),
});

const McpBlockBase = Schema.Struct({
  shape: McpShape.annotations({
    description:
      "data = lookup-shaped · tool = action-shaped · proxy = forwarder",
  }),
  paths: Schema.Array(TransportPath).pipe(Schema.minItems(1)).annotations({
    description: "Which transports the construct supports",
  }),
  remote: Schema.optional(RemoteTransport).annotations({
    description: "Required if paths includes remote-http",
  }),
  auth: Auth.annotations({
    description:
      "Auth declaration · gateway uses this to resolve credentials and forward",
  }),
  capabilities: Schema.Array(McpCapability)
    .pipe(Schema.minItems(1))
    .annotations({
      description: "MCP capabilities exposed (per MCP spec)",
    }),
  tools: Schema.Array(Schema.String).pipe(Schema.maxItems(100)).annotations({
    description: "Tool names exposed via tools/list",
  }),
  source_of_truth: Schema.optional(SourceOfTruth).annotations({
    description:
      "Where the data backing the MCP comes from (substrate provenance)",
  }),
  tiers: Schema.optional(Tiers).annotations({
    description:
      "Anti-hallucination tier declaration (per micodex doctrine)",
  }),
  pricing: Pricing.annotations({
    description: "Pricing declaration · elevated from optional v1 to required v2",
  }),
  publisher: Schema.String.pipe(Schema.maxLength(80)).annotations({
    description:
      "Org/author publishing this MCP (was in tenants.ts only · now in beacon)",
  }),
  documentation: Schema.optional(Schema.String).annotations({
    description: "Soft-deprecated v1 alias · prefer docs.url (Cycle D extension)",
  }),
});

// Conditional refine: when paths includes remote-http, mcp.remote MUST be set.
// Mirrors the Auth filter pattern (auth.ts §80-92). Without this, a beacon
// declaring remote-http transport but omitting the remote block would pass
// schema validation and only fail at gateway boot with a less-clear error.
const McpBlock = McpBlockBase.pipe(
  Schema.filter((mcp) => {
    if (mcp.paths.includes("remote-http") && mcp.remote === undefined) {
      return "mcp.remote required when paths includes remote-http";
    }
    return true;
  }),
);

const CliBlock = Schema.optional(
  Schema.Struct({
    binary: Schema.String,
    entry: Schema.optional(Schema.String),
    install: Schema.optional(Schema.String),
    subcommands: Schema.optional(Schema.Array(Schema.String)),
    output: Schema.optional(Schema.String),
    exit_codes: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.String }),
    ),
  }),
);

/**
 * BeaconV2Schema · the canonical federation contract for MCP construct
 * self-declaration. Constructs author beacon.yaml; build step regenerates
 * /.well-known/beacon.json on deploy; gateway fetches + validates this
 * shape at boot + every 5min refresh.
 *
 * Cycle C ships base shape (mcp + cli + payment).
 * Cycle D extends additively with `docs:` block (additive PR · no breaking change).
 *
 * Schema versioning: schema_version field gates evolution.
 *   - "1" : v1 beacon (no auth field · pre-cycle-C · gateway falls back to tenants.ts auth)
 *   - "2" : v2 beacon (auth field required · v0.3 broadcast layer consumes this)
 *   - "3" : reserved for breaking change (not v0.3 scope)
 */
export const BeaconV2Schema = Schema.Struct({
  schema_version: Schema.Literal("2").annotations({
    description: "Beacon schema version · '2' for v0.3 federation broadcast",
  }),
  cli: CliBlock,
  mcp: McpBlock.annotations({
    description:
      "MCP transport + tool + auth + tier declaration (the federation core)",
  }),
  payment: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      description: Schema.optional(Schema.String),
    }),
  ).annotations({
    description: "Payment declaration · x402 wrapping deferred to v0.4",
  }),
  // Cycle D extension point · additive in v2 · do NOT remove
  // Per SDD §0.3 + §7.1 coordination contract: Cycle D files PR replacing
  // Schema.Unknown with concrete DocsBlockSchema; this placeholder accepts
  // any docs payload during the transition so beacons WITH docs blocks
  // don't fail validation while Cycle D ships.
  docs: Schema.optional(Schema.Unknown).annotations({
    description:
      "Cycle D docs metadata · see Cycle D PRD §3.4 for shape · optional in Cycle C",
  }),
}).annotations({
  identifier: "BeaconV2",
  description:
    "Beacon v2 · MCP federation construct self-declaration",
});

export type BeaconV2 = Schema.Schema.Type<typeof BeaconV2Schema>;

// Helpers · gateway consumes these
export const decodeBeacon = Schema.decodeUnknown(BeaconV2Schema);
export const encodeBeacon = Schema.encode(BeaconV2Schema);
