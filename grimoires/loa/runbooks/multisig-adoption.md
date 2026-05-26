---
title: Multisig Adoption Runbook
materializes: F-S3.1 + D2.5-3
status: §1 ratified-phase-0; §2+ pending Sprint 6 Phase C
cycle: w2.5-cluster-auth-custody-substrate
date: 2026-05-26
---

# Multisig Adoption Runbook

> The cluster-substrate's multisig-adoption guidance. Defines WHEN a cell MUST adopt multisig governance for its privileged roles (UPGRADER, ADMIN_BURNER, EMERGENCY_REVOKER, PAUSER) vs MAY operate with single-signer EOA. The trigger logic is binary by design — operator decisions on cell deploys yield a clean YES/NO outcome from cell-class + stage alone, with no per-deploy negotiation overhead.

> **Sprint 1 scope (this revision)**: §1 trigger matrix scaffold only. The full runbook — ceremony scripts (Safe + Squads V4 + Defender Relayer), recovery procedures (lost-signer, compromised-signer), testnet conformance suite, and audit-trail integration — lands in Sprint 6 Phase C per the cycle sequencing in `grimoires/loa/cycles/cycle-w2.5-cluster-auth-custody-substrate/sprint.md`. Sprint 1 ratifies the trigger logic so that Phase A onward can author the substrate against a fixed adoption contract.

## 1. Trigger Matrix (cell-class × stage → multisig YES/NO)

The matrix is the operator-binding decision for every new cell deploy. Cell-class taxonomy is defined per D2.5-3 (`{CultureTech, FinTech, internal-only}`); stage taxonomy per F-S3.1 (`{testnet, mainnet, external-CM-onboarded}`).

| Cell class       | testnet | mainnet | external-CM-onboarded |
|------------------|---------|---------|-----------------------|
| **CultureTech**  | NO — no public stake; dev velocity wins | YES — real on-chain artifact, vandalism-protected | YES — multi-party governance structural |
| **FinTech**      | YES — exercise ceremony before real custody | YES — custody = $ | YES — custody = $ + multi-party governance structural |
| **internal-only**| NO — sandbox, no public commitment | NO — sandbox, no public commitment | NO — internal-only excludes external-CM stage |

**Risk-class doctrine applied (per project memory `feedback_culturetech_vs_defi_gating`)**:

- **CultureTech cells** (badges, achievements, no real economic value): the on-chain artifact has cultural value but no fungible economic value. Testnet stays single-signer to preserve dev velocity; mainnet flips to multisig because the artifact is now publicly committed and worth protecting from vandalism even absent $; external-CM onboarding adds multi-party governance as a structural requirement (no single party owns the role).
- **FinTech cells** (tokens, payments, custody, anything redeemable): multisig YES on ALL stages including testnet. Rationale: the procedures themselves must be exercised before they wrap real custody; muscle built on testnet pays back on mainnet. There is no "low-stakes FinTech" stage.
- **internal-only cells** (test-net play, sandbox experiments): multisig NO on all stages. No external commitment exists at any stage. If an internal-only cell would graduate to external use, it must be re-classified before deploy — at which point the matrix re-applies under its new class.

### How to read this matrix

This matrix is the operator-binding decision for every new cell deploy under the cluster substrate. Before any mainnet deploy, the operator MUST classify the cell against the cell-class taxonomy and consult this matrix. Cells that resolve to **YES** MUST complete the §2 multisig adoption ceremony BEFORE the mainnet deploy transaction is broadcast. Cells that resolve to **NO** MAY operate with single-signer EOA but inherit all other substrate invariants (5-role taxonomy per `freeside-mint/contracts/substrate/ROLES.md`, timelock minimum-floor enforcement per `freeside-mint/contracts/substrate/TIMELOCKS.md`, ACL zero-overlap on init).

Cell-class classification is a one-time operator decision recorded at deploy-config time and ratified via the operator review gate. Re-classification of a deployed cell (e.g., CultureTech → FinTech because the cell starts handling redemption) requires a governance-level role re-grant ceremony (Sprint 6 Phase C §3.3).

## 2. Ceremony Scripts (Sprint 6 scope)

> Section stub. Authored in Sprint 6 Phase C (D-6.X tasks). Covers: Safe setup (Berachain target; F-S3.2), Squads V4 (Solana target; F-S3.3), OZ Defender Relayer onboarding (F-S3.6). Will materialize the deploy-multisig → grant-roles → revoke-EOA-owner → verify → archive-ceremony-artifacts flow with per-target scripts at `mint-api/scripts/multisig/{safe-adopt,squads-adopt,defender-relayer}.ts`.

## 3. Recovery Procedures (Sprint 6 scope)

> Section stub. Authored in Sprint 6 Phase C. Covers: lost-signer recovery via timelock (F-S3.4), compromised-signer revocation via `EMERGENCY_REVOKER_ROLE` per D2.5-9 (F-S3.5), and governance-level role re-grant. The compromised-signer flow follows the D2.5-9 sequence: PAUSER pauses → EMERGENCY_REVOKER revokes compromised signer → governance (timelock-mediated multisig) re-grants to restored signer.

## 4. Testnet Conformance (Sprint 6 scope)

> Section stub. Authored in Sprint 6 Phase C. Validates: trigger-matrix YES cells actually use multisig in CI (no single-signer leakage past the matrix gate); staged mainnet promotion gates require passing testnet conformance; happy-path adoption + recovery scenarios pass on testnet fork per F-S3.7.

## 5. Audit Trail (Sprint 6 scope)

> Section stub. Authored in Sprint 6 Phase C. References §2 ceremony events (multisig deployment address, role-grant txs, EOA-revoke tx, archival manifest) into the L4-graduated-trust ledger so that subsequent role-modification operations can validate against the ratified adoption baseline. Integrates with `grimoires/loa/runbooks/threat-model.md` §5 emergency response procedures.
