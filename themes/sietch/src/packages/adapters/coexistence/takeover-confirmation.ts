/**
 * takeover-confirmation.ts — the pure decision for the multi-step confirmation gate that
 * guards an IRREVERSIBLE primary→exclusive takeover (which renames roles and grants real,
 * one-way community control).
 *
 * Extracted from MigrationEngine (that file is `// @ts-nocheck`) so this safety gate is
 * TYPE-CHECKED and unit-testable in isolation: pure logic (Construct plane), no I/O. The
 * MigrationEngine class methods delegate here; it re-exports the types so callers are
 * unchanged.
 *
 * Carries the fix for arrakis-25r6: the `community_name` step must FAIL CLOSED when the
 * expected name is missing/empty. The original guard `if (expectedValue && input !== expectedValue)`
 * short-circuited to valid:true for ANY input whenever `expectedValue` was falsy — and the
 * caller passes `interaction.guild?.name ?? ''`, so an unavailable guild name silently SKIPPED
 * the "type your server name" check, lowering the barrier to an accidental irreversible takeover.
 */

/** Takeover confirmation step. */
export type TakeoverStep = 'community_name' | 'acknowledge_risks' | 'rollback_plan';

/** Takeover confirmation state. */
export interface TakeoverConfirmationState {
  /** Community ID */
  communityId: string;
  /** Admin initiating takeover */
  adminId: string;
  /** Steps completed */
  completedSteps: TakeoverStep[];
  /** Community name confirmation */
  communityNameConfirmed?: boolean;
  /** Risk acknowledgment */
  risksAcknowledged?: boolean;
  /** Rollback plan acknowledged */
  rollbackPlanAcknowledged?: boolean;
  /** When confirmation started */
  startedAt: Date;
  /** Confirmation expires after 5 minutes */
  expiresAt: Date;
}

/** Result of validating one confirmation step. */
export interface TakeoverStepResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly updatedConfirmation: TakeoverConfirmationState;
}

/**
 * Validate one confirmation step and (on success) advance the confirmation state. Pure: no
 * I/O, no clock other than `confirmation.expiresAt` vs `now`. Each step FAILS CLOSED — an
 * unrecognised step, an expired confirmation, or (for `community_name`) a missing/empty
 * expected value all return `valid:false`.
 */
export function validateTakeoverStep(
  confirmation: TakeoverConfirmationState,
  step: TakeoverStep,
  input: string,
  expectedValue?: string,
  now: Date = new Date(),
): TakeoverStepResult {
  // Check if expired
  if (now > confirmation.expiresAt) {
    return {
      valid: false,
      error: 'Confirmation expired - please start again',
      updatedConfirmation: confirmation,
    };
  }

  // Validate based on step
  switch (step) {
    case 'community_name':
      // FAIL-CLOSED (arrakis-25r6): a missing/empty expected name must NOT pass. The original
      // `expectedValue && ...` guard let ANY input through when the caller's `guild?.name ?? ''`
      // resolved to '', silently skipping this gate on an irreversible takeover.
      if (!expectedValue) {
        return {
          valid: false,
          error: 'Cannot verify community name (server name unavailable) - aborting takeover for safety',
          updatedConfirmation: confirmation,
        };
      }
      if (input.toLowerCase() !== expectedValue.toLowerCase()) {
        return {
          valid: false,
          error: 'Community name does not match',
          updatedConfirmation: confirmation,
        };
      }
      return {
        valid: true,
        updatedConfirmation: {
          ...confirmation,
          completedSteps: [...confirmation.completedSteps, step],
          communityNameConfirmed: true,
        },
      };

    case 'acknowledge_risks':
      if (input.toLowerCase() !== 'i understand') {
        return {
          valid: false,
          error: 'Please type "I understand" to acknowledge risks',
          updatedConfirmation: confirmation,
        };
      }
      return {
        valid: true,
        updatedConfirmation: {
          ...confirmation,
          completedSteps: [...confirmation.completedSteps, step],
          risksAcknowledged: true,
        },
      };

    case 'rollback_plan':
      if (input.toLowerCase() !== 'confirmed') {
        return {
          valid: false,
          error: 'Please type "confirmed" to acknowledge rollback plan',
          updatedConfirmation: confirmation,
        };
      }
      return {
        valid: true,
        updatedConfirmation: {
          ...confirmation,
          completedSteps: [...confirmation.completedSteps, step],
          rollbackPlanAcknowledged: true,
        },
      };

    default:
      return {
        valid: false,
        error: `Unknown confirmation step: ${step}`,
        updatedConfirmation: confirmation,
      };
  }
}

/** True iff every required confirmation step has been completed. */
export function isTakeoverConfirmationComplete(confirmation: TakeoverConfirmationState): boolean {
  const requiredSteps: TakeoverStep[] = ['community_name', 'acknowledge_risks', 'rollback_plan'];
  return requiredSteps.every((step) => confirmation.completedSteps.includes(step));
}
