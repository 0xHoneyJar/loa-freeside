/**
 * Virtual List Component
 *
 * Sprint 132: Performance & Accessibility
 *
 * Renders large lists efficiently using virtual scrolling.
 * Only renders visible items plus overscan buffer.
 *
 * @module components/shared/VirtualList
 */

import React, { useRef, forwardRef, useImperativeHandle } from 'react';
import { useVirtualScroll } from '../../hooks/useVirtualScroll';

// =============================================================================
// Types
// =============================================================================

export interface VirtualListProps<T> {
  /** Items to render */
  items: T[];
  /** Height of each item in pixels */
  itemHeight: number;
  /** Height of the container in pixels */
  containerHeight: number;
  /** Render function for each item */
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  /** Optional class for the container */
  className?: string;
  /** Overscan count (items to render beyond visible area) */
  overscan?: number;
  /** ARIA label for accessibility */
  ariaLabel?: string;
  /** ARIA role (default: list) */
  role?: string;
  /** Key extractor function */
  getKey?: (item: T, index: number) => string | number;
  /** Empty state content */
  emptyContent?: React.ReactNode;
  /** Loading state */
  isLoading?: boolean;
  /** Loading content */
  loadingContent?: React.ReactNode;
}

export interface VirtualListHandle {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  scrollToTop: (behavior?: ScrollBehavior) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

// =============================================================================
// Component
// =============================================================================

function VirtualListInner<T>(
  {
    items,
    itemHeight,
    containerHeight,
    renderItem,
    className = '',
    overscan = 3,
    ariaLabel,
    role = 'list',
    getKey,
    emptyContent,
    isLoading,
    loadingContent,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    visibleItems,
    totalHeight,
    offsetTop,
    handleScroll,
    scrollToIndex,
  } = useVirtualScroll({
    itemCount: items.length,
    itemHeight,
    containerHeight,
    overscan,
  });

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number, behavior?: ScrollBehavior) => {
      scrollToIndex(index, behavior);
    },
    scrollToTop: (behavior?: ScrollBehavior) => {
      containerRef.current?.scrollTo({ top: 0, behavior });
    },
    scrollToBottom: (behavior?: ScrollBehavior) => {
      containerRef.current?.scrollTo({ top: totalHeight, behavior });
    },
  }), [scrollToIndex, totalHeight]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={`overflow-auto ${className}`}
        style={{ height: containerHeight }}
        role={role}
        aria-label={ariaLabel}
        aria-busy="true"
      >
        {loadingContent || (
          <div className="flex items-center justify-center h-full">
            <svg
              className="animate-spin h-8 w-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        )}
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div
        className={`overflow-auto ${className}`}
        style={{ height: containerHeight }}
        role={role}
        aria-label={ariaLabel}
      >
        {emptyContent || (
          <div className="flex items-center justify-center h-full text-gray-500">
            No items to display
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
      role={role}
      aria-label={ariaLabel}
      aria-rowcount={items.length}
    >
      {/* Spacer for total height */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Positioned items */}
        <div
          style={{
            position: 'absolute',
            top: offsetTop,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((index) => {
            const item = items[index];
            const key = getKey ? getKey(item, index) : index;
            const style: React.CSSProperties = {
              height: itemHeight,
              boxSizing: 'border-box',
            };
            return (
              <div key={key} role="listitem" aria-rowindex={index + 1}>
                {renderItem(item, index, style)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Create the forwarded ref component with proper typing
export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<VirtualListHandle> }
) => React.ReactElement;

export default VirtualList;
