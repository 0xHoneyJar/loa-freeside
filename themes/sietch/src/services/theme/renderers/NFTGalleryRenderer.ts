/**
 * NFT Gallery Component Renderer
 *
 * Server-side HTML renderer for NFT galleries.
 * Sprint 6: Component System - Preview Engine
 */

import type { NFTGalleryProps } from '../../../types/theme-component.types.js';
import type { ComponentRenderer, RenderContext } from './BaseRenderer.js';
import { escapeHtml, componentClass, cssVar, mockNftData } from './BaseRenderer.js';

/**
 * NFT Gallery Renderer
 */
export class NFTGalleryRenderer implements ComponentRenderer<NFTGalleryProps> {
  getType(): string {
    return 'nft-gallery';
  }

  render(props: NFTGalleryProps, context: RenderContext): string {
    const className = componentClass('nft-gallery', props.layout);
    const nfts = this.getNftData(props, context);
    const columns = props.columns ?? 4;

    return `
      <div class="${className}" data-component="nft-gallery" style="--columns: ${columns}">
        <div class="theme-nft-gallery__grid">
          ${nfts
            .map(
              (nft) => `
            <div class="theme-nft-gallery__item">
              <div class="theme-nft-gallery__image-wrapper">
                <img
                  src="${escapeHtml(nft.image)}"
                  alt="${escapeHtml(nft.name)}"
                  class="theme-nft-gallery__image"
                  loading="lazy"
                />
              </div>
              ${
                props.showMetadata
                  ? `
                <div class="theme-nft-gallery__metadata">
                  <span class="theme-nft-gallery__name">${escapeHtml(nft.name)}</span>
                  ${props.showOwner && nft.owner ? `<span class="theme-nft-gallery__owner">${escapeHtml(nft.owner)}</span>` : ''}
                </div>
              `
                  : ''
              }
            </div>
          `
            )
            .join('')}
        </div>
        ${nfts.length === 0 ? '<p class="theme-nft-gallery__empty">No NFTs to display</p>' : ''}
      </div>
    `;
  }

  getStyles(props: NFTGalleryProps): string {
    const columns = props.columns ?? 4;

    return `
      .theme-nft-gallery {
        width: 100%;
      }
      .theme-nft-gallery__grid {
        display: grid;
        grid-template-columns: repeat(var(--columns, ${columns}), 1fr);
        gap: 1rem;
      }
      @media (max-width: 768px) {
        .theme-nft-gallery__grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @media (max-width: 480px) {
        .theme-nft-gallery__grid {
          grid-template-columns: 1fr;
        }
      }
      .theme-nft-gallery__item {
        border-radius: ${cssVar('border-radius', '0.5rem')};
        overflow: hidden;
        background: ${cssVar('surface', '#ffffff')};
        border: 1px solid ${cssVar('border-color', '#e5e7eb')};
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .theme-nft-gallery__item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
      .theme-nft-gallery__image-wrapper {
        aspect-ratio: 1;
        overflow: hidden;
      }
      .theme-nft-gallery__image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .theme-nft-gallery__metadata {
        padding: 0.75rem;
      }
      .theme-nft-gallery__name {
        display: block;
        font-weight: 600;
        color: ${cssVar('text-primary', '#111827')};
        font-size: 0.875rem;
      }
      .theme-nft-gallery__owner {
        display: block;
        font-size: 0.75rem;
        color: ${cssVar('text-muted', '#6b7280')};
        margin-top: 0.25rem;
      }
      .theme-nft-gallery__empty {
        grid-column: 1 / -1;
        text-align: center;
        color: ${cssVar('text-muted', '#6b7280')};
        padding: 2rem;
      }
      .theme-nft-gallery--carousel .theme-nft-gallery__grid {
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        gap: 1rem;
      }
      .theme-nft-gallery--carousel .theme-nft-gallery__item {
        flex: 0 0 calc(100% / ${columns});
        scroll-snap-align: start;
      }
    `;
  }

  private getNftData(
    props: NFTGalleryProps,
    context: RenderContext
  ): Array<{ id: string; image: string; name: string; owner?: string }> {
    // In mock mode, return mock data
    if (context.mockMode) {
      return mockNftData(props.maxItems ?? 20);
    }

    // Real implementation would fetch from contract
    // For now return empty in non-mock mode
    return [];
  }
}

export const nftGalleryRenderer = new NFTGalleryRenderer();
