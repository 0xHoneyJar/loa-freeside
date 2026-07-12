import { Schema } from "effect";

/**
 * What kind of auth the upstream MCP requires.
 *
 *   - none     : open access (codex)
 *   - api-key  : single shared bearer per upstream (score)
 *   - jwt      : reserved for future · per-caller tokens
 *   - oauth    : reserved for future · OAuth 2.0 flow
 */
export const AuthKind = Schema.Literal("none", "api-key", "jwt", "oauth");
export type AuthKind = Schema.Schema.Type<typeof AuthKind>;

/**
 * Where the gateway resolves the credential value from.
 *
 *   - railway-secret : process.env[key] at request time (v0.3 default)
 *   - env-var        : alias for railway-secret · explicit non-Railway envs
 *   - sops           : encrypted file in repo (v0.4 candidate)
 *   - doppler        : Doppler API resolution (v0.4 candidate)
 *
 * v0.3 implementation: only `railway-secret` and `env-var` resolve to
 * concrete values. Other kinds throw `CredentialResolverNotImplemented`
 * at gateway boot (fail-fast · forces explicit upgrade path).
 */
export const CredentialsRefType = Schema.Literal(
  "railway-secret",
  "env-var",
  "sops",
  "doppler",
);
export type CredentialsRefType = Schema.Schema.Type<typeof CredentialsRefType>;

export const CredentialsRef = Schema.Struct({
  type: CredentialsRefType.annotations({
    description: "Which secrets store holds the upstream credential",
  }),
  key: Schema.String.pipe(
    Schema.pattern(/^[A-Z][A-Z0-9_]*$/, {
      message: () =>
        "credential key must be SCREAMING_SNAKE_CASE (Railway env-var convention)",
    }),
    Schema.maxLength(128),
  ).annotations({
    description:
      "Name to look up in the secrets store (e.g. MCP_SCORE_UPSTREAM_KEY)",
  }),
}).annotations({
  identifier: "CredentialsRef",
  description:
    "Where the gateway resolves the upstream auth credential from at request time",
});
export type CredentialsRef = Schema.Schema.Type<typeof CredentialsRef>;

/**
 * Auth declaration · what the upstream wants from the caller.
 *
 *   - kind: none           → no auth required · header + credentials_ref omitted
 *   - kind: api-key        → header REQUIRED · credentials_ref REQUIRED
 *   - kind: jwt | oauth    → reserved · v0.3 schema accepts but gateway
 *                            CredentialResolverNotImplemented at boot
 *
 * Validation rule: kind:none MUST omit header + credentials_ref;
 * kind:api-key MUST include both. Enforced via Schema.filter at the
 * Auth struct level (not pure-struct · uses Schema.filter).
 */
const AuthBase = Schema.Struct({
  kind: AuthKind,
  header: Schema.optional(Schema.String.pipe(Schema.maxLength(64))).annotations(
    {
      description:
        "Wire-level header name the upstream expects (e.g. X-MCP-Key, Authorization)",
    },
  ),
  credentials_ref: Schema.optional(CredentialsRef).annotations({
    description: "Where the gateway resolves the credential value from",
  }),
});

export const Auth = AuthBase.pipe(
  Schema.filter((auth) => {
    if (auth.kind === "none") {
      if (auth.header !== undefined || auth.credentials_ref !== undefined) {
        return "kind:none must omit header and credentials_ref";
      }
    } else if (auth.kind === "api-key") {
      if (auth.header === undefined || auth.credentials_ref === undefined) {
        return "kind:api-key requires both header and credentials_ref";
      }
    }
    return true;
  }),
).annotations({
  identifier: "Auth",
  description:
    "Upstream auth declaration · gateway resolves credential and forwards to upstream",
});
export type Auth = Schema.Schema.Type<typeof Auth>;
