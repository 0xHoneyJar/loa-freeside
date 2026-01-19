/**
 * Virtual Scroll Hook
 *
 * Sprint 132: Performance & Accessibility
 *
 * Provides virtual scrolling for long lists to improve performance.
 *
 * @module hooks/useVirtualScroll
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface VirtualScrollOptions {
  /** Total number of items */
  itemCount: number;
  /** Height of each item in pixels */
  itemHeight: number;
  /** Height of the container/viewport in pixels */
  containerHeight: number;
  /** Number of items to render beyond visible area (default: 3) */
  overscan?: number;
}

export interface VirtualScrollResult {
  /** Start index of visible items */
  startIndex: number;
  /** End index of visible items (exclusive) */
  endIndex: number;
  /** Total height of the virtual list */
  totalHeight: number;
  /** Offset from top for the visible items */
  offsetTop: number;
  /** Array of visible item indices */
  visibleItems: number[];
  /** Handle scroll event */
  handleScroll: (event: React.UIEvent<HTMLElement>) => void;
  /** Scroll to a specific index */
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLElement>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useVirtualScroll({
  itemCount,
  itemHeight,
  containerHeight,
  overscan = 3,
}: VirtualScrollOptions): VirtualScrollResult {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLElement>(null);

  // Calculate visible range
  const { startIndex, endIndex, totalHeight, offsetTop } = useMemo(() => {
    const totalHeight = itemCount * itemHeight;

    // Calculate visible range
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.ceil((scrollTop + containerHeight) / itemHeight);

    // Apply overscan
    const startIndex = Math.max(0, visibleStart - overscan);
    const endIndex = Math.min(itemCount, visibleEnd + overscan);

    // Calculate offset for positioning
    const offsetTop = startIndex * itemHeight;

    return { startIndex, endIndex, totalHeight, offsetTop };
  }, [itemCount, itemHeight, containerHeight, scrollTop, overscan]);

  // Generate visible item indices
  const visibleItems = useMemo(() => {
    const items: number[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      items.push(i);
    }
    return items;
  }, [startIndex, endIndex]);

  // Scroll handler
  const handleScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
  }, []);

  // Scroll to index
  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = 'auto') => {
    const targetTop = index * itemHeight;
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: targetTop, behavior });
    }
  }, [itemHeight]);

  // Sync scroll position on resize
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      setScrollTop(container.scrollTop);
    }
  }, [containerHeight]);

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetTop,
    visibleItems,
    handleScroll,
    scrollToIndex,
    containerRef: containerRef as React.RefObject<HTMLElement>,
  };
}

// =============================================================================
// Virtual List Component Helper
// =============================================================================

export interface VirtualListProps<T> {
  /** Items to render */
  items: T[];
  /** Height of each item */
  itemHeight: number;
  /** Height of the container */
  containerHeight: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Optional class for container */
  className?: string;
  /** Overscan count */
  overscan?: number;
  /** ARIA label for the list */
  ariaLabel?: string;
}

export default useVirtualScroll;
