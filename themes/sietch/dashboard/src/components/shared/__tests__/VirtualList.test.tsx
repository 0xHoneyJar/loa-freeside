/**
 * VirtualList Component Tests
 *
 * Sprint 132: Performance & Accessibility
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VirtualList, type VirtualListProps } from '../VirtualList';

// Mock the useVirtualScroll hook
vi.mock('../../../hooks/useVirtualScroll', () => ({
  useVirtualScroll: vi.fn(({ itemCount, itemHeight, containerHeight, overscan = 3 }) => {
    // Calculate visible items based on container height
    const visibleCount = Math.min(
      itemCount,
      Math.ceil(containerHeight / itemHeight) + overscan * 2
    );
    const visibleItems = Array.from({ length: visibleCount }, (_, i) => i);

    return {
      startIndex: 0,
      endIndex: visibleCount,
      totalHeight: itemCount * itemHeight,
      offsetTop: 0,
      visibleItems,
      handleScroll: vi.fn(),
      scrollToIndex: vi.fn(),
      containerRef: { current: null },
    };
  }),
}));

describe('VirtualList', () => {
  const defaultItems = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

  const defaultProps: VirtualListProps<typeof defaultItems[0]> = {
    items: defaultItems,
    itemHeight: 50,
    containerHeight: 300,
    renderItem: (item, _index, style) => (
      <div style={style} data-testid={`item-${item.id}`}>
        {item.name}
      </div>
    ),
  };

  describe('rendering', () => {
    it('renders virtual list container', () => {
      render(<VirtualList {...defaultProps} />);

      const list = screen.getByRole('list');
      expect(list).toBeInTheDocument();
    });

    it('renders only visible items', () => {
      render(<VirtualList {...defaultProps} />);

      // Should not render all 100 items, only visible ones plus overscan
      const item0 = screen.getByTestId('item-0');
      expect(item0).toBeInTheDocument();

      // Item 50 should not be rendered (too far down)
      expect(screen.queryByTestId('item-50')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<VirtualList {...defaultProps} className="custom-list" />);

      const list = screen.getByRole('list');
      expect(list).toHaveClass('custom-list');
    });

    it('sets container height from props', () => {
      render(<VirtualList {...defaultProps} containerHeight={400} />);

      const list = screen.getByRole('list');
      expect(list).toHaveStyle({ height: '400px' });
    });
  });

  describe('accessibility', () => {
    it('has list role by default', () => {
      render(<VirtualList {...defaultProps} />);

      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    it('accepts custom role', () => {
      render(<VirtualList {...defaultProps} role="listbox" />);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('applies aria-label', () => {
      render(<VirtualList {...defaultProps} ariaLabel="Item list" />);

      expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Item list');
    });

    it('sets aria-rowcount for total items', () => {
      render(<VirtualList {...defaultProps} />);

      expect(screen.getByRole('list')).toHaveAttribute('aria-rowcount', '100');
    });

    it('renders items with listitem role', () => {
      render(<VirtualList {...defaultProps} />);

      const listItems = screen.getAllByRole('listitem');
      expect(listItems.length).toBeGreaterThan(0);
    });

    it('sets aria-rowindex on list items', () => {
      render(<VirtualList {...defaultProps} />);

      const listItems = screen.getAllByRole('listitem');
      // First item should have aria-rowindex 1 (1-indexed)
      expect(listItems[0]).toHaveAttribute('aria-rowindex', '1');
    });
  });

  describe('empty state', () => {
    it('renders default empty message', () => {
      render(<VirtualList {...defaultProps} items={[]} />);

      expect(screen.getByText('No items to display')).toBeInTheDocument();
    });

    it('renders custom empty content', () => {
      render(
        <VirtualList
          {...defaultProps}
          items={[]}
          emptyContent={<div>Nothing here!</div>}
        />
      );

      expect(screen.getByText('Nothing here!')).toBeInTheDocument();
    });

    it('maintains aria attributes in empty state', () => {
      render(
        <VirtualList {...defaultProps} items={[]} ariaLabel="Empty list" />
      );

      const list = screen.getByRole('list');
      expect(list).toHaveAttribute('aria-label', 'Empty list');
    });
  });

  describe('loading state', () => {
    it('shows loading indicator', () => {
      render(<VirtualList {...defaultProps} isLoading={true} />);

      const loadingSpinner = document.querySelector('.animate-spin');
      expect(loadingSpinner).toBeInTheDocument();
    });

    it('renders custom loading content', () => {
      render(
        <VirtualList
          {...defaultProps}
          isLoading={true}
          loadingContent={<div>Loading items...</div>}
        />
      );

      expect(screen.getByText('Loading items...')).toBeInTheDocument();
    });

    it('sets aria-busy when loading', () => {
      render(<VirtualList {...defaultProps} isLoading={true} />);

      const list = screen.getByRole('list');
      expect(list).toHaveAttribute('aria-busy', 'true');
    });

    it('does not render items when loading', () => {
      render(<VirtualList {...defaultProps} isLoading={true} />);

      expect(screen.queryByTestId('item-0')).not.toBeInTheDocument();
    });
  });

  describe('key extraction', () => {
    it('uses index as key by default', () => {
      render(<VirtualList {...defaultProps} />);

      // Items should render without key warnings
      expect(screen.getByTestId('item-0')).toBeInTheDocument();
    });

    it('uses custom getKey function', () => {
      render(
        <VirtualList
          {...defaultProps}
          getKey={(item) => `custom-${item.id}`}
        />
      );

      // Should still render correctly with custom keys
      expect(screen.getByTestId('item-0')).toBeInTheDocument();
    });
  });

  describe('renderItem', () => {
    it('passes item to render function', () => {
      const renderItem = vi.fn((item, _index, style) => (
        <div style={style}>{item.name}</div>
      ));

      render(<VirtualList {...defaultProps} renderItem={renderItem} />);

      expect(renderItem).toHaveBeenCalled();
      expect(renderItem.mock.calls[0][0]).toEqual(defaultItems[0]);
    });

    it('passes index to render function', () => {
      const renderItem = vi.fn((item, index, style) => (
        <div style={style}>
          {index}: {item.name}
        </div>
      ));

      render(<VirtualList {...defaultProps} renderItem={renderItem} />);

      expect(renderItem.mock.calls[0][1]).toBe(0);
    });

    it('passes style with itemHeight to render function', () => {
      const renderItem = vi.fn((item, _index, style) => (
        <div style={style}>{item.name}</div>
      ));

      render(<VirtualList {...defaultProps} renderItem={renderItem} />);

      const passedStyle = renderItem.mock.calls[0][2];
      expect(passedStyle.height).toBe(50);
      expect(passedStyle.boxSizing).toBe('border-box');
    });
  });

  describe('overscan', () => {
    it('uses default overscan of 3', () => {
      render(<VirtualList {...defaultProps} />);

      // Should render more items than just visible
      const listItems = screen.getAllByRole('listitem');
      // containerHeight (300) / itemHeight (50) = 6 visible
      // + overscan (3) * 2 = 12 total
      expect(listItems.length).toBeGreaterThan(6);
    });

    it('accepts custom overscan value', () => {
      render(<VirtualList {...defaultProps} overscan={5} />);

      const listItems = screen.getAllByRole('listitem');
      expect(listItems.length).toBeGreaterThan(0);
    });
  });
});
