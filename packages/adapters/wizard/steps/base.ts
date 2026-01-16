/**
 * Base Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Abstract base class for wizard step handlers.
 * Provides common functionality for all steps.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type {
  IWizardStepHandler,
  StepContext,
  StepInput,
  StepResult,
} from '@arrakis/core/ports';
import type { WizardSession, WizardState } from '@arrakis/core/domain';
import { getStepNumber } from '@arrakis/core/domain';

// =============================================================================
// Base Step Handler
// =============================================================================

/**
 * Abstract base class for wizard step handlers.
 */
export abstract class BaseStepHandler implements IWizardStepHandler {
  abstract readonly step: WizardState;
  protected readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  /**
   * Execute the step with given input.
   */
  abstract execute(context: StepContext, input: StepInput): Promise<StepResult>;

  /**
   * Get display data for this step.
   */
  abstract getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }>;

  /**
   * Validate input for this step.
   */
  abstract validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Get step number (1-8).
   */
  protected getStepNumber(): number {
    return getStepNumber(this.step);
  }

  /**
   * Create a progress indicator string.
   */
  protected getProgressIndicator(current: number): string {
    const total = 8;
    const filled = '●';
    const empty = '○';
    return Array(total)
      .fill(empty)
      .map((_, i) => (i < current ? filled : empty))
      .join(' ');
  }

  /**
   * Create standard step header embed.
   */
  protected createStepEmbed(
    title: string,
    description: string,
    session: WizardSession
  ): Record<string, unknown> {
    const stepNum = this.getStepNumber();
    return {
      title: `Step ${stepNum}/8: ${title}`,
      description,
      color: 0x5865f2, // Discord blurple
      footer: {
        text: `${this.getProgressIndicator(stepNum)} | Session: ${session.id.slice(0, 8)}`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create an error result.
   */
  protected errorResult(error: string): StepResult {
    return {
      success: false,
      error,
      ephemeral: true,
    };
  }

  /**
   * Create a success result.
   */
  protected successResult(
    session?: WizardSession,
    message?: string
  ): StepResult {
    return {
      success: true,
      session,
      message,
      ephemeral: true,
    };
  }
}

// =============================================================================
// Component Builders
// =============================================================================

/**
 * Create a button component.
 */
export function createButton(
  customId: string,
  label: string,
  style: number = 1,
  disabled = false,
  emoji?: string
): Record<string, unknown> {
  const button: Record<string, unknown> = {
    type: 2, // Button
    style,
    label,
    custom_id: customId,
    disabled,
  };

  if (emoji) {
    button.emoji = { name: emoji };
  }

  return button;
}

/**
 * Create a select menu component.
 */
export function createSelectMenu(
  customId: string,
  placeholder: string,
  options: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: string;
    default?: boolean;
  }>,
  minValues = 1,
  maxValues = 1
): Record<string, unknown> {
  return {
    type: 3, // String select
    custom_id: customId,
    placeholder,
    options: options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
      emoji: opt.emoji ? { name: opt.emoji } : undefined,
      default: opt.default,
    })),
    min_values: minValues,
    max_values: maxValues,
  };
}

/**
 * Create an action row component.
 */
export function createActionRow(
  components: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    type: 1, // Action row
    components,
  };
}

/**
 * Create navigation buttons (Back, Continue, Cancel).
 */
export function createNavigationButtons(
  stepId: string,
  showBack = true,
  continueDisabled = false
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (showBack) {
    components.push(
      createButton(`wizard:${stepId}:back`, 'Back', 2, false, '◀️')
    );
  }

  components.push(
    createButton(
      `wizard:${stepId}:continue`,
      'Continue',
      1,
      continueDisabled,
      '▶️'
    )
  );

  components.push(
    createButton(`wizard:${stepId}:cancel`, 'Cancel', 4, false, '✖️')
  );

  return createActionRow(components);
}

// =============================================================================
// Button Styles
// =============================================================================

export const ButtonStyle = {
  Primary: 1, // Blurple
  Secondary: 2, // Grey
  Success: 3, // Green
  Danger: 4, // Red
  Link: 5, // Link button
} as const;
