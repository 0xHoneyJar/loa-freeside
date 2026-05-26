---
title: W2.5 Cluster-Substrate Threat Model
materializes: PRD §5a + D2.5-7 + D2.5-8 + D2.5-9 + D2.5-11 + D2.5-12
status: ratified-phase-0
cycle: w2.5-cluster-auth-custody-substrate
date: 2026-05-26
supersedes: prior verbatim PRD §5a where §0a anchor removed the iter-2 replay-store assets
---

# W2.5 Cluster-Substrate Threat Model

> **Materializes**: PRD §5a + D2.5-7 (ratification + governance extensions) + D2.5-8 (KMS-proxy threat row) + D2.5-9 (EMERGENCY_REVOKER recovery path) + D2.5-11 (denylist as revocation surface) + D2.5-12 (per-request svc-JWT — replay-store assets removed)

This runbook is the operator-facing threat model for the W2.5 cluster auth + key-custody substrate. PRD §5a is the requirement-truth source; this doc materializes §5a into the governance form Phase 0 D2.5-7 ratifies and extends. Where §5a still references iter-2 assets (`replay_api_keys`, `service_jwt_replay`) that pair-mode (D2.5-12) structurally removed, this runbook reflects the §0a-canonical shape.

Every Phase A–E acceptance criterion across W2.5 MUST map to a defense in this table.

## 1. Assets Being Defended

| Asset | Sensitivity | Compromise impact |
|---|---|---|
| Svc-JWT signing key (`svc-{rotation}` private JWK) | CRITICAL | Attacker can mint svc-JWTs as any cell with any role; full cluster auth bypass |
| User-JWT signing key (Privy-managed; out of W2.5 scope but coexisting) | CRITICAL | Out of scope; documented for coexistence |
| `operator_grants` table (Privy DID/wallet → role-tuple allow rules) | CRITICAL | Attacker who can append to ACL can issue svc-JWTs at will. Production grants require 2-of-3 operator approval per D2.5-7 (see §6.B). |
| `cell_api_keys.key_hash` rows (argon2id-hashed per-cell issuance credentials) | HIGH | Attacker who can forge a cell-key can request a svc-JWT for that cell's `sub`. Rate-limited 1000/min/cell; revocable via `revoked_at` set |
| `service_jwt_denylist` table | HIGH | Attacker who can write/delete deny rules can either unrevoke a compromised jti (delete rule) or DoS legitimate JWTs (write false-positive rule). Operator-managed; audit-logged. |
| FreesideACL `UPGRADER_ROLE` → cell timelock address | CRITICAL | Attacker who controls timelock can upgrade any FreesideACL-derived contract to arbitrary impl |
| FreesideACL `EMERGENCY_REVOKER_ROLE` → fast-acting Safe (1-of-3 EOA threshold) | HIGH | Attacker who controls Emergency Revoker can grief-revoke legitimate signers. Mitigated by 1-of-3 threshold + EOA-only (not shared with timelock) per D2.5-9. See §5 row "Emergency Revoker compromise". |
| FreesideACL `MINTER_ROLE` → cell mint authority (KMS-proxy-gated) | HIGH | Attacker can mint within per-block cap until detected, AND only if attacker also controls kms-proxy or compromises proxy host (see KMS-proxy row in §3) |
| FreesideACL `ADMIN_BURNER_ROLE` → cell burn/revoke authority | HIGH | Attacker can revoke legitimately-issued tokens; timelock-mediated (24h delay) provides monitoring window |
| FreesideACL `PAUSER_ROLE` → fast-acting EOA or 1-of-N Safe | MEDIUM | Attacker can grief-pause; PAUSER is held by a distinct party from EMERGENCY_REVOKER per the zero-overlap invariant (see D-1.2 §3) |
| AWS KMS key for warm-key signing (mint-api) | CRITICAL | KMS access = mint authority within IAM-scoped surface. Defense-in-depth: kms-proxy enforces signing policy BEFORE any KMS SignDigest (D-1.6 §3 + this doc §3 "Operational: KMS misuse" row) |
| **kms-proxy host process** (NEW per D2.5-8) | CRITICAL | Proxy holds IAM-KMS role; RCE on proxy host = "can ask AWS KMS to sign anything the policy allows". Defended by signing-policy enforcement + audit + future V2 grant-based policy upgrade. See §3 row "Operational: KMS-proxy host compromise". |
| HMAC keys (S4) per cell-pair | MEDIUM | Same-VPC adversary can forge requests within that envelope |
| Saga state (activities-api saga rows; W2.5 S5) | MEDIUM | State-divergence attacks (resolved by REQUIRES_MANUAL_INTERVENTION) |

> **Iter-2 assets removed per D2.5-12** — `replay_api_keys` and `service_jwt_replay` were assets in earlier flatline iterations. The per-request svc-JWT model eliminates both: there is no replay store to defend (cells mint fresh per call; no persistence read at verify time). The `service_jwt_issuance` audit table records issuance but is audit-only — its compromise gives observation, not authority.

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ Cluster trust boundary (mutual API-key/JWT auth required)        │
│  ┌────────────┐                ┌────────────┐                    │
│  │ Operator   │  /v1/auth/*    │ identity-  │                    │
│  │ (Privy DID)│ ───────────→   │ api        │                    │
│  │            │                │ (Postgres) │                    │
│  └────────────┘                └────────────┘                    │
│         │                            │                            │
│         │ ACL grant (2-of-3-op       │ svc-JWT issue (per-req)    │
│         │  approval per D2.5-7)      │                            │
│         ▼                            ▼                            │
│  ┌────────────┐                ┌────────────┐                    │
│  │ mint-api   │ ◀── svc-JWT ── │ activities-│                    │
│  │ (kms-proxy │   in Authz hdr │ api        │                    │
│  │  -gated)   │                │            │                    │
│  └────────────┘                └────────────┘                    │
│         │                                                         │
│ ┌───────┴───────────────────────┐                                 │
│ │ Mint-host trust boundary      │                                 │
│ │ (process isolation; D2.5-8)   │                                 │
│ │  ┌──────────┐  local socket   │                                 │
│ │  │ cell     │ ──────────────→ │  ┌──────────┐                  │
│ │  │ process  │   /sign req     │  │ kms-proxy │                  │
│ │  │ (no KMS  │                 │  │ (IAM-KMS  │                  │
│ │  │  IAM)    │                 │  │  role)    │                  │
│ │  └──────────┘                 │  └────┬─────┘                  │
│ └───────────────────────────────┘       │ SignDigest             │
│                                          ▼                        │
│  ┌────────────┐                ┌────────────┐                    │
│  │ Chain RPC  │ ◀── Defender ─ │ AWS KMS    │                    │
│  │            │   relayer (S3) │            │                    │
│  └────────────┘                └────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
        Cell-to-cell auth is svc-JWT + denylist hook (per-request).
        Operator-to-identity-api is Privy user-JWT + ACL (2-of-3-op for prod).
        Cell-to-kms-proxy is local-socket per-cell API-key (host-local; never network-exposed).
        kms-proxy-to-AWS-KMS is IAM-scoped role (no shared secret).
        Same-VPC same-trust-boundary CAN use S4 HMAC fallback.
```

> **Boundary additions vs PRD §5a.2**: The "Mint-host trust boundary" frame is new — D2.5-8 splits the previous monolithic mint-api process into two processes (cell + kms-proxy) within one host, with the kms-proxy holding the IAM-KMS role and the cell holding none. RCE on the cell process escalates to "can ask kms-proxy to sign approved things" — NOT "can call KMS directly".

## 3. Attacker Capabilities Considered

| Attacker class | Capability | Defense |
|---|---|---|
| **External: untrusted Internet** | Send arbitrary HTTPS requests to cell endpoints | All cell endpoints require valid svc-JWT (F-S1.3); structural + sig validation before any I/O (per D-1.1 §5 order-of-ops); no replay-store I/O at verify time |
| **External: stolen Privy user-JWT** (no `is_operator: true` claim) | Authenticate as a user, attempt svc-JWT issuance | `operator_grants` ACL deny-all default; non-operator → 403 (F-S1.5 conformance) |
| **External: stolen Privy user-JWT with `is_operator: true`** | Issue svc-JWTs | Rate limit per-operator; max TTL 3600s (per D-1.1 §3); audit-logged with IP; emergency `auth disable-issuance` switch flips global flag (see §5 row "Svc-JWT signing key suspected compromised") |
| **External: storage DoS via issuance flooding** | Send malformed cell-API-key auth attempts to consume Postgres rows | Issuance auth rejects before any DB write (per D-1.1 §4 error-code table); 1000/min/cell rate limit (per D-1.1 §3) |
| **Same-cluster compromised cell** | Hold valid svc-JWT for one cell; replay against another | Per-request issuance + strict `aud` matching at verify (per D-1.1 §5 step 5) prevents cross-audience reuse. Stolen short-TTL JWT remains usable only until exp (max 3600s) — replay-protection-by-design vs replay-store-by-mechanism. |
| **Same-cluster compromised cell** | Use S4 HMAC to forge requests | F-S4.7 adoption-gate config `boundary_type: same-vpc-same-trust` required; conformance test refuses cross-boundary use |
| **Insider: operator compromised (single signer)** | Issue svc-JWTs, grant ACL membership, rotate JWKS | Mitigated by ACL audit log + (D2.5-7) **2-of-3 operator approval required for ACL grants in production** (`operator_grants.granted_by_array` CHECK ≥2 approvers per D-1.5 §4). Read-only operator actions retain single-operator capability; write-ACL actions require 2-of-3. |
| **On-chain: contract upgrade** | Submit upgrade tx as timelock | Defense-in-depth: `_authorizeUpgrade` checks `msg.sender == timelock` AND `timelock has UPGRADER_ROLE`; minimum 24h timelock delay floor (D-1.4); multisig-as-timelock-proposer for mainnet (S3 / D-1.3 trigger matrix) |
| **On-chain: timelock compromise** | Compromised timelock signers propose malicious upgrade | 24h delay window for monitoring; PAUSER_ROLE held by faster-acting party can pause during window (zero-overlap invariant per D-1.2 §3 ensures PAUSER ≠ timelock signer set) |
| **On-chain: EMERGENCY_REVOKER compromise** (NEW per D2.5-9) | Compromised revoker grief-revokes legitimate signers | 1-of-3 EOA threshold means a single compromised key cannot revoke unilaterally (requires 1-of-3 approval per ceremony). PAUSER can pause to contain ongoing grief. Recovery: timelocked governance re-grants role to fresh signer set. See D-1.2 §6. |
| **Supply chain: malicious npm dependency** | Compromised `jose` / `@aws-sdk/client-kms` / `@0xhoneyjar/auth` consumer | Changesets-driven publish; npm 2FA required; SBOM generation in CI; Slither + Aderyn on contracts; LR pin via lockfile |
| **Supply chain: malicious Slither/Aderyn version** | False-negative audit pass | Tool versions pinned in CI; version-bump requires ADR-level review (SDD §9 [SDD-EXT]) |
| **Operational: AWS KMS misuse** | Operator with KMS-IAM-role signs arbitrary EVM payload | Two-layer defense: (1) **kms-proxy enforces signing policy** (chain ID + selector + calldata + nonce + low-s + provenance — see D-1.6 §3 8-step gate) BEFORE forwarding to KMS; (2) cell process **does NOT hold the IAM-KMS role** — cannot bypass proxy by calling KMS directly (D2.5-8 boundary). |
| **Operational: KMS-proxy host compromise** (NEW per D2.5-8) | RCE on the host where kms-proxy runs gives attacker the IAM-KMS role | Mitigations: IAM role is scoped to the specific KMS key + signing operation (no admin/decrypt scope); signing-policy enforcement is still in-process for the proxy (RCE bypasses policy by definition — this is the V1 residual risk); CloudTrail audits every SignDigest; **future V2 upgrade**: AWS KMS grant-based policy moves enforcement INTO KMS itself, eliminating the proxy-host-as-single-trust-point (per D-1.6 §5). V1 is appropriate for CultureTech-class stakes; FinTech-class custody MUST adopt V2 before mainnet. |
| **Operational: denylist Postgres outage** | Continued svc-JWT acceptance bypasses denylist check | MANDATORY fail-CLOSED → 503 (per D-1.1 §5 step 7); no cell opt-in for fail-open. Same posture as PRD §5a row on replay store. |
| **Operational: issuance Postgres outage** | identity-api cannot issue new svc-JWTs | Cells holding in-flight JWTs continue to operate until exp (≤3600s). New cross-cell calls fail at the cell-side mint attempt (cell receives 503 from issuance endpoint). Recovery: restore Postgres; resume issuance. No cell-side fallback (by design — per-request issuance IS the protection). |

## 4. Out of Scope for V1 Threat Model

- Compromise of Privy itself (out of W2.5; W2 dependency)
- Compromise of Railway secret injection (documented threat boundary per F-S1.8)
- Side-channel attacks on AWS KMS (vendor-managed)
- Quantum-computational attacks on ES256 (out of horizon)
- Insider-only attacks bypassing the audit trail entirely (cluster-baseline trust assumption)
- Physical-layer attacks on developer laptops (cluster-baseline trust assumption; mitigated by operator OPS-1 — laptop disk encryption + auto-lock)
- Adversarial governance via legitimate timelock + multisig threshold (this is a governance failure mode, not a substrate concern — addressed by ceremony selection in D-1.3 trigger matrix)

## 5. Emergency Response Procedures

| # | Scenario | Response | Owner |
|---|---|---|---|
| 5.1 | Svc-JWT signing key suspected compromised | (1) Rotate kid via `auth rotate-svc-key` (per D-1.1 §7); (2) **append wildcard `kid` deny rule to `service_jwt_denylist`** (per D-1.5 §2, D2.5-11) — any-match deny on the compromised kid invalidates all extant JWTs signed with it; (3) alert all cells via OPS channel; (4) emergency `auth disable-issuance` flag flip until rotation complete | identity-api maintainer + operator |
| 5.2 | Operator ACL compromise (rogue grant detected) | (1) `auth revoke-operator <privy-did>`; (2) audit ACL change log via `operator_grants.granted_by_array` history; (3) **append `sub` deny rule(s) to `service_jwt_denylist` for any cells the rogue operator grant authorized**; (4) rotate svc-JWT signing key if rogue issued any svc-JWTs (see 5.1) | operator |
| 5.3 | FreesideACL contract upgrade detected as malicious mid-timelock-delay | (1) PAUSER pauses the affected contract; (2) **EMERGENCY_REVOKER revokes UPGRADER_ROLE from the timelock multisig signer set** (per D-1.2 §6, D2.5-9) — fast-acting Safe (1-of-3 EOA threshold, no timelock) executes immediately; (3) governance via fresh timelocked multisig re-grants UPGRADER_ROLE to a restored signer set; (4) post-mortem | operator + cell maintainer |
| 5.4 | Compromised on-chain signer (MINTER / ADMIN_BURNER / etc.) | Same shape as 5.3: PAUSER pauses → EMERGENCY_REVOKER revokes compromised signer → governance re-grants. Per D-1.2 §6. The EMERGENCY_REVOKER path is THE primary on-chain incident-response surface added by D2.5-9. | operator + cell maintainer |
| 5.5 | AWS KMS access revoked / misused | (1) Rotate IAM role attached to kms-proxy host; (2) investigate via CloudTrail (every SignDigest is logged); (3) cross-reference with kms-proxy `auth.kms.signed` + `auth.kms.signing_policy_refused` events (per D-1.6 §4); (4) alert via PagerDuty | operator |
| 5.6 | KMS-proxy host suspected compromised (NEW per D2.5-8) | (1) Pause affected contract(s) via PAUSER; (2) revoke the kms-proxy host's IAM-KMS role at AWS; (3) spin up replacement kms-proxy on fresh host; (4) investigate compromised host via standard IR; (5) post-mortem includes review of `signing_policy_refused` events on the compromised host (any refusals attempted by attacker reveal probe attempts) | operator + mint-api maintainer |
| 5.7 | `service_jwt_denylist` Postgres outage | Substrate fails-CLOSED — all verify calls return 503 (per D-1.1 §5 step 7); operator investigates Postgres health; manual issuance-window grace via ADR-level exemption ONLY if outage > 1h (and only when ALL cells confirm they can drop in-flight requests safely) | operator |
| 5.8 | `service_jwt_issuance` Postgres outage | Existing in-flight JWTs continue to work until exp; new issuance returns 503; cell-side mint helper retries with bounded backoff (per D-1.1 §3 client pattern); restore Postgres → resume | operator |
| 5.9 | Saga in REQUIRES_MANUAL_INTERVENTION | Operator inspects chain state, supplies evidence via `saga resolve <id> committed\|failed --evidence <tx-hash-or-rpc-fail-receipt>` | operator |

## 6. Governance Rituals (D2.5-7 Extension)

PRD §5a is ratified as the W2.5 substrate threat model. D2.5-7 extends with the following governance rituals.

### A. Quarterly Tabletop Exercise

- **Cadence**: Quarterly. First exercise scheduled **Q3 2026** (post-W2.5 substrate ship).
- **Format**: Half-day workshop, operator + cell maintainers, one scenario from §5 plus one fresh adversarial scenario authored by an external participant if available.
- **Output**: A tabletop report appended to this runbook as `grimoires/loa/runbooks/tabletop/<date>-<scenario-slug>.md`. Tabletop reports use the template in §6.D.
- **Failure mode**: A scenario the team cannot resolve in-band surfaces a gap; gap MUST be filed as a Phase-X follow-up sprint within 2 weeks.

### B. 2-of-3 Operator Approval for ACL Grants in Production

- **Scope**: Production = main-net cell deploys. Testnet + internal-only cells operate under single-operator authority.
- **Mechanism**: `operator_grants.granted_by_array` jsonb column stores DIDs of approving operators (per D-1.5 §4). DB-level CHECK constraint requires `jsonb_array_length(granted_by_array) >= 2` for any row where `is_production = true`. Identity-api issuance endpoint refuses to issue against an `operator_grants` row that fails the CHECK.
- **Operator set**: Currently 3 operators (small-team posture; see §6.C). 2-of-3 = simple majority threshold; defends against single-operator compromise but does NOT defend against 2-coordinated-operator compromise (acknowledged residual risk; appropriate for CultureTech-stake).
- **Audit**: Every grant write emits `auth.acl.grant` event with full `granted_by_array`; the audit trail is the ratification surface.

### C. Small-Team Posture — No Formal On-Call

- **Premise**: W2.5 substrate is operated by a small team (currently ≤3 active operators). Formal pager-rotation on-call (PagerDuty + escalation tree + SLO) is **not yet justified**: traffic volume is low, business hours coverage is sufficient, and the substrate is internal-tooling-class.
- **Replacement**: Operator + designated backup. Backup is on-call only in the explicit sense that they have the credentials to respond; no scheduled rotation.
- **Re-evaluation trigger**: Adopt formal on-call rotation when EITHER (a) external CMs onboard (per D-1.3 trigger matrix shifts cells to YES-multisig + governance-multi-party) OR (b) any cell graduates to FinTech-class custody.

### D. Tabletop Exercise Template

Use this template for each quarterly tabletop. Fill in-band; commit to `grimoires/loa/runbooks/tabletop/<date>-<scenario-slug>.md`.

```markdown
# Tabletop: <Scenario Title>

**Date**: <YYYY-MM-DD>
**Participants**: <names + roles>
**Scenario class**: <existing §5 row N | adversarial fresh>
**Cycle**: w2.5-cluster-auth-custody-substrate
**Cadence**: Q<N> <YYYY>

## 1. Scenario Statement
<one paragraph describing the incident as it unfolds — what the attacker did, what the operator detected, what state the system is in at t=0>

## 2. In-Scope Assets
<which §1 assets are at risk in this scenario>

## 3. Attacker Capability Assumed
<which §3 row(s) the attacker has reached>

## 4. Expected Response Sequence
<numbered steps the operator should execute; cite §5 row numbers + ceremony scripts (D-1.3 §2 once authored)>

## 5. Actual Response (if exercised)
<what actually happened in the tabletop>

## 6. Gaps Surfaced
<list of gaps; each gap MUST be filed as a follow-up sprint within 2 weeks per §6.A failure-mode rule>

## 7. Post-Mortem Questions
- What detection signal would have been earliest?
- What would have happened if the operator was unavailable for 24h?
- What second-order effects on cells not directly involved?
- What ritual/script can be added to make this faster next time?
```

---

## Cross-References

| Topic | Source |
|---|---|
| Per-request svc-JWT design | D-1.1 svc-jwt-spec.md §3 + §5 |
| Denylist mechanism | D-1.1 §6 + D-1.5 §2 |
| 5-role taxonomy + EMERGENCY_REVOKER recovery flow | D-1.2 ROLES.md §1 + §6 |
| Timelock delays (UPGRADER 48h, REVOKER 0h) | D-1.4 TIMELOCKS.md |
| 2-of-3 operator approval mechanism | D-1.5 §4 |
| KMS-proxy 8-step signing policy | D-1.6 §3 |
| Multisig trigger matrix (cell-class × stage) | D-1.3 §1 |
| PRD-original threat model | PRD §5a |
| Architectural anchor | SDD §0a |
