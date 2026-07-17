# `@freeside/signing-key-custody-protocol`

CR-013 production KMS/HSM signing-key custody for collection-report Ordering
signed dependency intake. Distinct from CR-009 wire semantics — this package
defines registry distribution, key-class separation, rotation/revocation policy,
remote signing backend interfaces, and database time-health gates.

## Scope

- **Pinned registry contract** — versioned `SigningKeyRegistryDocument` with
  observable freshness; stale or unknown keys fail closed at intake.
- **Fixture vs production separation** — fixture keys require `-fixture-` in
  `signing_key_id` and `local-fixture` backend; production keys require KMS/HSM
  backends. Fixture proof cannot satisfy production release gates.
- **Rotation/revocation/compromise** — event schemas and in-memory coordinators
  for overlap validation and emergency quarantine.
- **Time-health** — Ordering database clock compared against ≥2 independent
  sources; measured offset, uncertainty, regional divergence, and last-good time
  are observable; skew >2s or unknown time blocks signed intake.
- **No private keys in repo** — production custody is KMS/HSM-backed via
  `RemoteSigningBackend`; local signing is fixture-only.

## Adoption

Ordering and producers should:

1. Pin a distributed registry snapshot (object storage / config service), not
   embed keys in application repos.
2. Construct `PinnedKeyRegistry` at startup and refresh on a cadence shorter
   than `max_staleness_ms`.
3. Call `gateSignedIntake()` (or `assertSignedIntakeAllowed()`) before trust
   envelope verification so time-health and registry freshness fail closed first.
4. Map `CustodySigningKey` → `ServiceSigningKey` via `toTrustEnvelopeServiceKey()`
   for `@freeside/trust-envelope-protocol` verification.

## Game-day verification

See `docs/runbook-game-day.md` for rotation, compromise, clock-jump, regional
divergence, time-source loss, and recovery drills (EV-G1B4-key-custody-game-day).

## Related

- `@freeside/trust-envelope-protocol` — CR-009 envelope wire contract
- `grimoires/loa/coordination/collection-report/owner-acceptance.md` — platform custody gaps
