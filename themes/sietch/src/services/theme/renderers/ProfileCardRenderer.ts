/**
 * Profile Card Component Renderer
 *
 * Server-side HTML renderer for user profile cards.
 * Sprint 6: Component System - Preview Engine
 */

import type { ProfileCardProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { escapeHtml, componentClass, cssVar, mockWalletAddress, mockTokenBalance } from './BaseRenderer.js';

/**
 * Profile Card Renderer
 */
export class ProfileCardRenderer implements ComponentRenderer<ProfileCardProps> {
  getType(): string {
    return 'profile-card';
  }

  render(props: ProfileCardProps, context: RenderContext): string {
    const className = componentClass('profile-card');
    const user = this.getUserData(props, context);

    return `
      <div class="${className}" data-component="profile-card">
        ${
          props.showAvatar !== false
            ? `
          <div class="theme-profile-card__avatar-wrapper">
            <img
              src="${escapeHtml(user.avatar)}"
              alt="${escapeHtml(user.name)}"
              class="theme-profile-card__avatar"
            />
          </div>
        `
            : ''
        }
        <div class="theme-profile-card__info">
          <h4 class="theme-profile-card__name">${escapeHtml(user.name)}</h4>
          ${
            props.showWallet !== false && user.wallet
              ? `<span class="theme-profile-card__wallet">${escapeHtml(user.wallet)}</span>`
              : ''
          }
        </div>
        ${
          props.showBalance && user.balance
            ? `
          <div class="theme-profile-card__balance">
            <span class="theme-profile-card__balance-label">Balance</span>
            <span class="theme-profile-card__balance-value">${escapeHtml(user.balance)}</span>
          </div>
        `
            : ''
        }
        ${
          props.showRoles !== false && user.roles && user.roles.length > 0
            ? `
          <div class="theme-profile-card__roles">
            ${user.roles.map((role) => `<span class="theme-profile-card__role">${escapeHtml(role)}</span>`).join('')}
          </div>
        `
            : ''
        }
        ${
          props.showStats && user.stats
            ? `
          <div class="theme-profile-card__stats">
            ${Object.entries(user.stats)
              .map(
                ([label, value]) => `
                <div class="theme-profile-card__stat">
                  <span class="theme-profile-card__stat-value">${escapeHtml(String(value))}</span>
                  <span class="theme-profile-card__stat-label">${escapeHtml(label)}</span>
                </div>
              `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  getStyles(_props: ProfileCardProps): string {
    return `
      .theme-profile-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 1.5rem;
        background: ${cssVar('surface', '#ffffff')};
        border: 1px solid ${cssVar('border-color', '#e5e7eb')};
        border-radius: ${cssVar('border-radius', '0.5rem')};
      }
      .theme-profile-card__avatar-wrapper {
        margin-bottom: 1rem;
      }
      .theme-profile-card__avatar {
        width: 5rem;
        height: 5rem;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid ${cssVar('primary', '#2563eb')};
      }
      .theme-profile-card__info {
        margin-bottom: 0.75rem;
      }
      .theme-profile-card__name {
        font-size: 1.125rem;
        font-weight: 700;
        color: ${cssVar('text-primary', '#111827')};
        margin: 0 0 0.25rem 0;
      }
      .theme-profile-card__wallet {
        font-size: 0.75rem;
        color: ${cssVar('text-muted', '#6b7280')};
        font-family: monospace;
      }
      .theme-profile-card__balance {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 0.75rem;
        padding: 0.75rem 1.5rem;
        background: ${cssVar('surface-muted', '#f9fafb')};
        border-radius: ${cssVar('border-radius', '0.375rem')};
      }
      .theme-profile-card__balance-label {
        font-size: 0.75rem;
        color: ${cssVar('text-muted', '#6b7280')};
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .theme-profile-card__balance-value {
        font-size: 1.25rem;
        font-weight: 700;
        color: ${cssVar('primary', '#2563eb')};
      }
      .theme-profile-card__roles {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: center;
        margin-bottom: 0.75rem;
      }
      .theme-profile-card__role {
        font-size: 0.75rem;
        padding: 0.25rem 0.75rem;
        background: ${cssVar('primary-light', '#dbeafe')};
        color: ${cssVar('primary-dark', '#1e40af')};
        border-radius: 9999px;
        font-weight: 500;
      }
      .theme-profile-card__stats {
        display: flex;
        gap: 1.5rem;
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid ${cssVar('border-color', '#e5e7eb')};
      }
      .theme-profile-card__stat {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .theme-profile-card__stat-value {
        font-size: 1.25rem;
        font-weight: 700;
        color: ${cssVar('text-primary', '#111827')};
      }
      .theme-profile-card__stat-label {
        font-size: 0.75rem;
        color: ${cssVar('text-muted', '#6b7280')};
      }
    `;
  }

  private getUserData(
    props: ProfileCardProps,
    context: RenderContext
  ): {
    name: string;
    avatar: string;
    wallet?: string;
    balance?: string;
    roles?: string[];
    stats?: Record<string, string | number>;
  } {
    if (context.mockMode) {
      return {
        name: 'CryptoUser',
        avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=preview',
        wallet: mockWalletAddress(),
        balance: mockTokenBalance(),
        roles: ['Member', 'Verified'],
        stats: {
          NFTs: 12,
          Points: '1,234',
          Rank: '#42',
        },
      };
    }

    // Real user data from context
    return {
      name: 'User',
      avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=user',
      wallet: context.user?.wallet,
      balance: props.contractId ? context.user?.balances?.[props.contractId] : undefined,
      roles: context.user?.roles,
    };
  }
}

export const profileCardRenderer = new ProfileCardRenderer();
