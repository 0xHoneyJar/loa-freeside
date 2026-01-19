/**
 * Accessibility Utilities
 *
 * Sprint 132: Performance & Accessibility
 *
 * Utilities for WCAG 2.1 AA compliance and screen reader support.
 *
 * @module utils/accessibility
 */

// =============================================================================
// Focus Management
// =============================================================================

/**
 * Trap focus within an element (for modals, dialogs, etc.)
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelectors = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const focusableElements = container.querySelectorAll<HTMLElement>(focusableSelectors);
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first element
  firstElement?.focus();

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Restore focus to an element when a dialog closes
 */
export function createFocusRestorer(): {
  save: () => void;
  restore: () => void;
} {
  let savedElement: HTMLElement | null = null;

  return {
    save: () => {
      savedElement = document.activeElement as HTMLElement;
    },
    restore: () => {
      savedElement?.focus();
      savedElement = null;
    },
  };
}

// =============================================================================
// Keyboard Navigation
// =============================================================================

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Get the arrow key direction from a keyboard event
 */
export function getArrowDirection(event: React.KeyboardEvent): ArrowDirection | null {
  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/**
 * Handle keyboard navigation for a list of items
 */
export function handleListKeyboardNavigation<T extends HTMLElement>(
  event: React.KeyboardEvent,
  items: NodeListOf<T> | T[],
  currentIndex: number,
  options?: {
    wrap?: boolean;
    orientation?: 'vertical' | 'horizontal';
    onSelect?: (index: number) => void;
  }
): number | null {
  const { wrap = true, orientation = 'vertical', onSelect } = options || {};
  const itemArray = Array.from(items);
  const count = itemArray.length;

  if (count === 0) return null;

  const direction = getArrowDirection(event);
  if (!direction) {
    // Handle Enter/Space for selection
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(currentIndex);
      return currentIndex;
    }
    return null;
  }

  // Check if direction matches orientation
  const isVertical = orientation === 'vertical';
  const isForward = direction === (isVertical ? 'down' : 'right');
  const isBackward = direction === (isVertical ? 'up' : 'left');

  if (!isForward && !isBackward) return null;

  event.preventDefault();

  let newIndex: number;
  if (isForward) {
    newIndex = currentIndex + 1;
    if (newIndex >= count) {
      newIndex = wrap ? 0 : count - 1;
    }
  } else {
    newIndex = currentIndex - 1;
    if (newIndex < 0) {
      newIndex = wrap ? count - 1 : 0;
    }
  }

  // Focus the new item
  itemArray[newIndex]?.focus();

  return newIndex;
}

// =============================================================================
// Live Regions
// =============================================================================

/**
 * Announce a message to screen readers using a live region
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const liveRegion = getOrCreateLiveRegion(priority);

  // Clear and set message (triggers announcement)
  liveRegion.textContent = '';

  // Use setTimeout to ensure the change is detected
  setTimeout(() => {
    liveRegion.textContent = message;
  }, 50);
}

function getOrCreateLiveRegion(priority: 'polite' | 'assertive'): HTMLElement {
  const id = `live-region-${priority}`;
  let element = document.getElementById(id);

  if (!element) {
    element = document.createElement('div');
    element.id = id;
    element.setAttribute('aria-live', priority);
    element.setAttribute('aria-atomic', 'true');
    element.className = 'sr-only'; // Visually hidden
    element.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(element);
  }

  return element;
}

// =============================================================================
// ARIA Helpers
// =============================================================================

/**
 * Generate ARIA props for an expandable element
 */
export function getExpandableAriaProps(isExpanded: boolean, controlsId: string) {
  return {
    'aria-expanded': isExpanded,
    'aria-controls': controlsId,
  };
}

/**
 * Generate ARIA props for a selectable item
 */
export function getSelectableAriaProps(isSelected: boolean) {
  return {
    'aria-selected': isSelected,
  };
}

/**
 * Generate ARIA props for a checked item
 */
export function getCheckedAriaProps(isChecked: boolean | 'mixed') {
  return {
    'aria-checked': isChecked,
  };
}

/**
 * Generate ARIA props for a toggle button
 */
export function getToggleButtonAriaProps(isPressed: boolean) {
  return {
    'aria-pressed': isPressed,
  };
}

/**
 * Generate ARIA props for a loading state
 */
export function getLoadingAriaProps(isLoading: boolean, label?: string) {
  return {
    'aria-busy': isLoading,
    'aria-live': isLoading ? ('polite' as const) : undefined,
    'aria-label': isLoading && label ? `${label}, loading` : label,
  };
}

// =============================================================================
// Color Contrast
// =============================================================================

/**
 * Check if a color combination meets WCAG contrast requirements
 * @param foreground Hex color (e.g., "#ffffff")
 * @param background Hex color (e.g., "#000000")
 * @param level 'AA' or 'AAA'
 * @param isLargeText Whether text is large (>=18pt or bold >=14pt)
 */
export function meetsContrastRequirement(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA',
  isLargeText = false
): boolean {
  const ratio = getContrastRatio(foreground, background);

  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7;
  }
  // AA
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

/**
 * Calculate contrast ratio between two colors
 */
export function getContrastRatio(foreground: string, background: string): number {
  const lumA = getLuminance(foreground);
  const lumB = getLuminance(background);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : null;
}

// =============================================================================
// Skip Links
// =============================================================================

/**
 * Create a skip link for keyboard users
 */
export interface SkipLink {
  id: string;
  label: string;
  targetId: string;
}

export const DEFAULT_SKIP_LINKS: SkipLink[] = [
  { id: 'skip-to-main', label: 'Skip to main content', targetId: 'main-content' },
  { id: 'skip-to-nav', label: 'Skip to navigation', targetId: 'main-nav' },
];
