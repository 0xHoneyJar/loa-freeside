/**
 * useVirtualScroll Hook Tests
 *
 * Sprint 132: Performance & Accessibility
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useVirtualScroll } from '../useVirtualScroll';

describe('useVirtualScroll', () => {
  const defaultOptions = {
    itemCount: 100,
    itemHeight: 50,
    containerHeight: 300,
    overscan: 3,
  };

  describe('initial state', () => {
    it('calculates initial visible range', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      // With containerHeight 300 and itemHeight 50, we can see 6 items
      // Plus overscan of 3, so we render 0 to 9 (but capped at overscan logic)
      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBeLessThanOrEqual(defaultOptions.itemCount);
    });

    it('calculates total height', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      expect(result.current.totalHeight).toBe(100 * 50); // itemCount * itemHeight
    });

    it('returns visible items array', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      expect(result.current.visibleItems).toBeInstanceOf(Array);
      expect(result.current.visibleItems.length).toBeGreaterThan(0);
    });

    it('returns initial offset of 0', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      expect(result.current.offsetTop).toBe(0);
    });
  });

  describe('scroll handling', () => {
    it('updates visible range on scroll', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      const initialStartIndex = result.current.startIndex;

      // Simulate scroll to 500px (10 items down)
      act(() => {
        const mockEvent = {
          currentTarget: {
            scrollTop: 500,
          },
        } as unknown as React.UIEvent<HTMLElement>;
        result.current.handleScroll(mockEvent);
      });

      // After scrolling 500px with 50px items, we should be around index 10
      expect(result.current.startIndex).toBeGreaterThan(initialStartIndex);
    });

    it('calculates correct offset after scroll', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      act(() => {
        const mockEvent = {
          currentTarget: {
            scrollTop: 500,
          },
        } as unknown as React.UIEvent<HTMLElement>;
        result.current.handleScroll(mockEvent);
      });

      // Offset should be startIndex * itemHeight
      expect(result.current.offsetTop).toBe(result.current.startIndex * 50);
    });
  });

  describe('overscan', () => {
    it('includes overscan items before visible range', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      act(() => {
        const mockEvent = {
          currentTarget: {
            scrollTop: 500,
          },
        } as unknown as React.UIEvent<HTMLElement>;
        result.current.handleScroll(mockEvent);
      });

      // With overscan, startIndex should be less than the first visible item
      // First visible at 500px would be index 10, minus overscan 3 = 7
      expect(result.current.startIndex).toBeLessThanOrEqual(10 - 3);
    });

    it('includes overscan items after visible range', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      // Visible items = containerHeight / itemHeight = 300 / 50 = 6
      // Plus overscan of 3 on each side
      const expectedMinItems = Math.ceil(300 / 50) + 3; // 6 visible + 3 overscan after
      expect(result.current.visibleItems.length).toBeGreaterThanOrEqual(expectedMinItems);
    });

    it('respects custom overscan value', () => {
      const { result } = renderHook(() =>
        useVirtualScroll({ ...defaultOptions, overscan: 5 })
      );

      // With larger overscan, more items should be rendered
      const expectedMinItems = Math.ceil(300 / 50) + 5;
      expect(result.current.visibleItems.length).toBeGreaterThanOrEqual(expectedMinItems);
    });
  });

  describe('boundary conditions', () => {
    it('handles empty list', () => {
      const { result } = renderHook(() =>
        useVirtualScroll({ ...defaultOptions, itemCount: 0 })
      );

      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBe(0);
      expect(result.current.visibleItems).toEqual([]);
      expect(result.current.totalHeight).toBe(0);
    });

    it('handles single item', () => {
      const { result } = renderHook(() =>
        useVirtualScroll({ ...defaultOptions, itemCount: 1 })
      );

      expect(result.current.visibleItems).toEqual([0]);
      expect(result.current.totalHeight).toBe(50);
    });

    it('clamps start index to 0', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      // Even with overscan, start should not be negative
      expect(result.current.startIndex).toBeGreaterThanOrEqual(0);
    });

    it('clamps end index to item count', () => {
      const { result } = renderHook(() =>
        useVirtualScroll({ ...defaultOptions, itemCount: 5 })
      );

      // End index should not exceed item count
      expect(result.current.endIndex).toBeLessThanOrEqual(5);
    });

    it('handles scroll beyond content', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      act(() => {
        const mockEvent = {
          currentTarget: {
            scrollTop: 10000, // Way beyond 100 * 50 = 5000
          },
        } as unknown as React.UIEvent<HTMLElement>;
        result.current.handleScroll(mockEvent);
      });

      // Should clamp to valid range
      expect(result.current.endIndex).toBeLessThanOrEqual(100);
    });
  });

  describe('scrollToIndex', () => {
    it('provides scrollToIndex function', () => {
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      expect(typeof result.current.scrollToIndex).toBe('function');
    });

    it('scrollToIndex calculates correct scroll position', () => {
      const mockScrollTo = vi.fn();
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      // Mock the container ref
      Object.defineProperty(result.current.containerRef, 'current', {
        value: { scrollTo: mockScrollTo },
        writable: true,
      });

      act(() => {
        result.current.scrollToIndex(10);
      });

      expect(mockScrollTo).toHaveBeenCalledWith({
        top: 10 * 50, // index * itemHeight
        behavior: 'auto',
      });
    });

    it('scrollToIndex supports smooth behavior', () => {
      const mockScrollTo = vi.fn();
      const { result } = renderHook(() => useVirtualScroll(defaultOptions));

      Object.defineProperty(result.current.containerRef, 'current', {
        value: { scrollTo: mockScrollTo },
        writable: true,
      });

      act(() => {
        result.current.scrollToIndex(10, 'smooth');
      });

      expect(mockScrollTo).toHaveBeenCalledWith({
        top: 500,
        behavior: 'smooth',
      });
    });
  });

  describe('reactive updates', () => {
    it('recalculates when itemCount changes', () => {
      const { result, rerender } = renderHook(
        (props) => useVirtualScroll(props),
        { initialProps: defaultOptions }
      );

      const initialTotalHeight = result.current.totalHeight;

      rerender({ ...defaultOptions, itemCount: 200 });

      expect(result.current.totalHeight).toBe(200 * 50);
      expect(result.current.totalHeight).not.toBe(initialTotalHeight);
    });

    it('recalculates when containerHeight changes', () => {
      const { result, rerender } = renderHook(
        (props) => useVirtualScroll(props),
        { initialProps: defaultOptions }
      );

      const initialVisibleCount = result.current.visibleItems.length;

      rerender({ ...defaultOptions, containerHeight: 600 });

      // With double the container height, more items should be visible
      expect(result.current.visibleItems.length).toBeGreaterThan(initialVisibleCount);
    });

    it('recalculates when itemHeight changes', () => {
      const { result, rerender } = renderHook(
        (props) => useVirtualScroll(props),
        { initialProps: defaultOptions }
      );

      rerender({ ...defaultOptions, itemHeight: 100 });

      // Total height should change
      expect(result.current.totalHeight).toBe(100 * 100);
    });
  });
});
