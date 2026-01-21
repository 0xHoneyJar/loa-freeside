/**
 * Leaderboard Component Renderer
 *
 * Server-side HTML renderer for community leaderboards.
 * Sprint 6: Component System - Preview Engine
 */

import type { LeaderboardProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { escapeHtml, componentClass, cssVar, mockLeaderboardData } from './BaseRenderer.js';

/**
 * Leaderboard Renderer
 */
export class LeaderboardRenderer implements ComponentRenderer<LeaderboardProps> {
  getType(): string {
    return 'leaderboard';
  }

  render(props: LeaderboardProps, context: RenderContext): string {
    const className = componentClass('leaderboard');
    const entries = this.getLeaderboardData(props, context);
    const showRank = props.showRank ?? true;
    const showAvatar = props.showAvatar ?? true;

    return `
      <div class="${className}" data-component="leaderboard">
        ${props.title ? `<h3 class="theme-leaderboard__title">${escapeHtml(props.title)}</h3>` : ''}
        <div class="theme-leaderboard__list">
          ${entries
            .map(
              (entry, index) => `
            <div class="theme-leaderboard__entry ${index < 3 ? 'theme-leaderboard__entry--top' : ''}" data-rank="${entry.rank}">
              ${showRank ? `<span class="theme-leaderboard__rank">${entry.rank}</span>` : ''}
              ${
                showAvatar
                  ? `<img
                  src="${escapeHtml(entry.avatar)}"
                  alt="${escapeHtml(entry.name)}"
                  class="theme-leaderboard__avatar"
                />`
                  : ''
              }
              <span class="theme-leaderboard__name">${escapeHtml(entry.name)}</span>
              <span class="theme-leaderboard__value">${escapeHtml(entry.value)}</span>
              ${
                props.showChange
                  ? `<span class="theme-leaderboard__change">${this.renderChangeIndicator(0)}</span>`
                  : ''
              }
            </div>
          `
            )
            .join('')}
        </div>
        ${entries.length === 0 ? '<p class="theme-leaderboard__empty">No entries yet</p>' : ''}
      </div>
    `;
  }

  getStyles(_props: LeaderboardProps): string {
    return `
      .theme-leaderboard {
        width: 100%;
      }
      .theme-leaderboard__title {
        font-size: 1.25rem;
        font-weight: 700;
        color: ${cssVar('text-primary', '#111827')};
        margin-bottom: 1rem;
      }
      .theme-leaderboard__list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .theme-leaderboard__entry {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: ${cssVar('surface', '#ffffff')};
        border: 1px solid ${cssVar('border-color', '#e5e7eb')};
        border-radius: ${cssVar('border-radius', '0.5rem')};
        transition: background 0.2s;
      }
      .theme-leaderboard__entry:hover {
        background: ${cssVar('surface-hover', '#f9fafb')};
      }
      .theme-leaderboard__entry--top[data-rank="1"] {
        background: linear-gradient(90deg, #fef3c7 0%, ${cssVar('surface', '#ffffff')} 100%);
        border-color: #fbbf24;
      }
      .theme-leaderboard__entry--top[data-rank="2"] {
        background: linear-gradient(90deg, #e5e7eb 0%, ${cssVar('surface', '#ffffff')} 100%);
        border-color: #9ca3af;
      }
      .theme-leaderboard__entry--top[data-rank="3"] {
        background: linear-gradient(90deg, #fed7aa 0%, ${cssVar('surface', '#ffffff')} 100%);
        border-color: #f97316;
      }
      .theme-leaderboard__rank {
        min-width: 2rem;
        font-weight: 700;
        color: ${cssVar('text-muted', '#6b7280')};
        text-align: center;
      }
      .theme-leaderboard__entry--top .theme-leaderboard__rank {
        color: ${cssVar('primary', '#2563eb')};
      }
      .theme-leaderboard__avatar {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        object-fit: cover;
      }
      .theme-leaderboard__name {
        flex: 1;
        font-weight: 500;
        color: ${cssVar('text-primary', '#111827')};
      }
      .theme-leaderboard__value {
        font-weight: 600;
        color: ${cssVar('primary', '#2563eb')};
      }
      .theme-leaderboard__change {
        font-size: 0.875rem;
        min-width: 1.5rem;
        text-align: center;
      }
      .theme-leaderboard__change--up {
        color: #10b981;
      }
      .theme-leaderboard__change--down {
        color: #ef4444;
      }
      .theme-leaderboard__empty {
        text-align: center;
        color: ${cssVar('text-muted', '#6b7280')};
        padding: 2rem;
      }
    `;
  }

  private getLeaderboardData(
    props: LeaderboardProps,
    context: RenderContext
  ): Array<{ rank: number; name: string; avatar: string; value: string }> {
    if (context.mockMode) {
      return mockLeaderboardData(props.maxEntries ?? 10);
    }

    // Real implementation would fetch from data source
    return [];
  }

  private renderChangeIndicator(change: number): string {
    if (change > 0) {
      return `<span class="theme-leaderboard__change--up">↑${change}</span>`;
    }
    if (change < 0) {
      return `<span class="theme-leaderboard__change--down">↓${Math.abs(change)}</span>`;
    }
    return '—';
  }
}

export const leaderboardRenderer = new LeaderboardRenderer();
