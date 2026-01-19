# Sprint S-23: WizardEngine Implementation

## Summary

Implemented the 8-step self-service onboarding wizard (WizardEngine) for community setup. This sprint delivers the complete Discord-based wizard flow allowing community admins to configure chain selection, asset configuration, eligibility rules, role mappings, and channel structures through an interactive guided experience.

## Changes

### New Files

#### packages/adapters/wizard/steps/

| File | Purpose | Lines |
|------|---------|-------|
| `base.ts` | Abstract base class with shared Discord component builders | ~120 |
| `init-step.ts` | INIT step - community name input | ~100 |
| `chain-select-step.ts` | CHAIN_SELECT step - multi-chain selection | ~130 |
| `asset-config-step.ts` | ASSET_CONFIG step - NFT/token configuration | ~200 |
| `eligibility-rules-step.ts` | ELIGIBILITY_RULES step - rule builder | ~180 |
| `role-mapping-step.ts` | ROLE_MAPPING step - tier-to-role assignments | ~170 |
| `channel-structure-step.ts` | CHANNEL_STRUCTURE step - template selection | ~150 |
| `review-step.ts` | REVIEW step - manifest summary and validation | ~220 |
| `deploy-step.ts` | DEPLOY step - deployment initiation | ~160 |
| `index.ts` | Barrel exports and `createAllStepHandlers` factory | ~80 |

#### apps/worker/src/handlers/commands/

| File | Purpose | Lines |
|------|---------|-------|
| `setup.ts` | `/setup` command + button/select handlers | ~340 |
| `resume.ts` | `/resume`, `/cancel-setup`, `/setup-status` commands | ~340 |

#### packages/adapters/wizard/__tests__/

| File | Purpose | Tests |
|------|---------|-------|
| `wizard-engine.test.ts` | WizardEngine comprehensive tests | 24 |
| `step-handlers.test.ts` | Step handler validation/execution tests | 29 |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/ports/index.ts` | Added `wizard-engine.js` export (line 44-45) |
| `packages/core/ports/wizard-engine.ts` | Removed unused `WizardSessionData` import |
| `packages/adapters/wizard/index.ts` | Added exports for engine, metrics, steps |
| `apps/worker/src/handlers/commands/index.ts` | Added wizard command exports (lines 41-51) |

## Implementation Details

### Step Handler Architecture

Each step handler implements `IWizardStepHandler`:

```typescript
interface IWizardStepHandler {
  readonly step: WizardState;
  execute(context: StepContext, input: StepInput): Promise<StepResult>;
  getDisplay(session: WizardSession): Promise<{ embeds: unknown[]; components: unknown[] }>;
  validate(input: StepInput, session: WizardSession): Promise<{ valid: boolean; errors: string[] }>;
}
```

The `BaseStepHandler` provides shared utilities:
- `createButton()` - Discord button component builder
- `createSelectMenu()` - Discord select menu builder
- `createActionRow()` - Component row wrapper
- `createNavigationButtons()` - Back/Continue/Cancel navigation

### Wizard Flow State Machine

```
INIT → CHAIN_SELECT → ASSET_CONFIG → ELIGIBILITY_RULES
  ↓          ↓              ↓               ↓
ROLE_MAPPING → CHANNEL_STRUCTURE → REVIEW → DEPLOY → COMPLETE
```

Navigation supports:
- Forward transitions (validation-gated)
- Back navigation (all non-terminal states)
- Cancel (returns to INIT or deletes session)
- Failure states (error recovery)

### Discord Commands

| Command | Handler | Permission | Description |
|---------|---------|------------|-------------|
| `/setup` | `createSetupHandler` | Administrator | Start new wizard session |
| `/resume` | `createResumeHandler` | Administrator | Resume existing session |
| `/cancel-setup` | `createCancelSetupHandler` | Administrator | Cancel active session |
| `/setup-status` | `createSetupStatusHandler` | Administrator | Check session status |

Button/select handlers use `wizard:` prefix for custom IDs:
- `wizard:{step}:back` - Navigate back
- `wizard:{step}:continue` - Advance to next step
- `wizard:{step}:cancel` - Cancel wizard
- `wizard:{step}:{field}` - Select menu values

### Analytics Tracking

Events tracked to Redis:
- `wizard.session.started`
- `wizard.session.resumed`
- `wizard.session.cancelled`
- `wizard.step.entered`
- `wizard.step.completed`
- `wizard.step.error`
- `wizard.step.back`
- `wizard.deployment.started`
- `wizard.deployment.completed`
- `wizard.deployment.failed`

Funnel metrics available via `IWizardEngine.getFunnelStats()`.

### Security Considerations

- Administrator permission required for all wizard commands
- IP address binding on session creation/resume
- Session isolation by guild (one active session per server)
- 15-minute TTL with auto-expiration
- Ephemeral responses (only visible to admin)
- Validation at each step transition

## Test Results

```
Test Files  7 passed (7)
Tests       200 passed (200)
Duration    448ms
```

Test coverage includes:
- Session lifecycle (create, resume, cancel, expire)
- Step validation (all 8 steps)
- State transitions (forward, back, failure)
- Manifest generation and validation
- Deployment orchestration
- Analytics tracking
- Error handling

## Dependencies

This sprint builds on:
- **S-20**: WizardSessionStore (Redis session persistence)
- **S-21**: SynthesisEngine (Discord role/channel operations)
- **S-22**: VaultClient (secrets management - deployment config)

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| S-23.1: `/setup` starts new wizard session | PASS |
| S-23.2: `/resume` resumes existing session | PASS |
| S-23.3-8: All step handlers implemented | PASS |
| S-23.9: REVIEW step validates manifest | PASS |
| S-23.10: DEPLOY step triggers synthesis | PASS |
| S-23.11: Analytics tracking functional | PASS |
| S-23.12: Integration tests passing | PASS |

## Notes for Reviewer

1. **Button/Select Patterns**: The wizard uses Discord's component interaction pattern. Button clicks trigger immediate actions (back/continue/cancel), while select menus update session data that gets committed on "Continue".

2. **Step Handler Registration**: Step handlers are registered via `createAllStepHandlers()` factory, making it easy to add/remove steps or override handlers for testing.

3. **Manifest Structure**: The `CommunityManifest` type defines the complete configuration generated by the wizard. This is passed to SynthesisEngine for deployment.

4. **Error Boundaries**: Each command handler catches errors and returns user-friendly messages. Session state is preserved on validation failures.

5. **Chain Validation**: Supported chains are validated against a predefined list (ethereum, polygon, arbitrum, base, berachain). Invalid chains are rejected at the CHAIN_SELECT step.
