/**
 * Token Gate Component Renderer
 *
 * Server-side HTML renderer for token gating.
 * Sprint 6: Component System - Preview Engine
 */

import type { TokenGateProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import {
  escapeHtml,
  markdownToHtml,
  componentClass,
  cssVar,
  mockTokenBalance,
} from './BaseRenderer.js';

/**
 * Token Gate Renderer
 */
export class TokenGateRenderer implements ComponentRenderer<TokenGateProps> {
  getType(): string {
    return 'token-gate';
  }

  render(props: TokenGateProps, context: RenderContext): string {
    const isUnlocked = this.checkGateAccess(props, context);
    const className = componentClass('token-gate', isUnlocked ? 'unlocked' : 'locked');

    if (isUnlocked) {
      // Show unlocked content
      const content = props.unlockedContent
        ? markdownToHtml(props.unlockedContent)
        : '<p>Welcome! You have access to this content.</p>';

      return `
        <div class="${className}" data-component="token-gate">
          <div class="theme-token-gate__content">
            ${content}
          </div>
          ${props.showBalance ? this.renderBalance(props, context) : ''}
        </div>
      `;
    }

    // Show locked content
    const lockedContent = props.lockedContent
      ? markdownToHtml(props.lockedContent)
      : '<p>This content is locked.</p>';

    return `
      <div class="${className}" data-component="token-gate">
        <div class="theme-token-gate__lock-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <div class="theme-token-gate__message">
          ${lockedContent}
        </div>
        ${props.showRequirements ? this.renderRequirements(props) : ''}
      </div>
    `;
  }

  getStyles(_props: TokenGateProps): string {
    return `
      .theme-token-gate {
        border: 1px solid ${cssVar('border-color', '#e5e7eb')};
        border-radius: ${cssVar('border-radius', '0.5rem')};
        padding: 1.5rem;
        text-align: center;
      }
      .theme-token-gate--locked {
        background: ${cssVar('surface-muted', '#f9fafb')};
      }
      .theme-token-gate--unlocked {
        background: ${cssVar('surface', '#ffffff')};
      }
      .theme-token-gate__lock-icon {
        color: ${cssVar('text-muted', '#6b7280')};
        margin-bottom: 1rem;
      }
      .theme-token-gate__message {
        color: ${cssVar('text-secondary', '#4b5563')};
        margin-bottom: 1rem;
      }
      .theme-token-gate__requirements {
        font-size: 0.875rem;
        color: ${cssVar('text-muted', '#6b7280')};
        border-top: 1px solid ${cssVar('border-color', '#e5e7eb')};
        padding-top: 1rem;
        margin-top: 1rem;
      }
      .theme-token-gate__balance {
        font-size: 0.875rem;
        color: ${cssVar('text-secondary', '#4b5563')};
        margin-top: 0.5rem;
      }
      .theme-token-gate__content {
        text-align: left;
      }
    `;
  }

  private checkGateAccess(props: TokenGateProps, context: RenderContext): boolean {
    // In mock mode, always show unlocked
    if (context.mockMode) return true;

    // Check user has wallet
    if (!context.user?.wallet) return false;

    // Get required balance
    const minBalance = BigInt(props.gateConfig.minBalance ?? '1');
    const contractId = props.gateConfig.contractId;

    if (!contractId) return false;

    // Check user balance
    const userBalanceStr = context.user.balances?.[contractId] ?? '0';
    const userBalance = BigInt(userBalanceStr);

    return userBalance >= minBalance;
  }

  private renderBalance(props: TokenGateProps, context: RenderContext): string {
    const balance = context.mockMode
      ? mockTokenBalance()
      : context.user?.balances?.[props.gateConfig.contractId ?? ''] ?? '0';

    return `
      <div class="theme-token-gate__balance">
        Your balance: <strong>${escapeHtml(balance)}</strong>
      </div>
    `;
  }

  private renderRequirements(props: TokenGateProps): string {
    const minBalance = props.gateConfig.minBalance ?? '1';
    return `
      <div class="theme-token-gate__requirements">
        <strong>Requirements:</strong> Hold at least ${escapeHtml(minBalance)} tokens
      </div>
    `;
  }
}

export const tokenGateRenderer = new TokenGateRenderer();
