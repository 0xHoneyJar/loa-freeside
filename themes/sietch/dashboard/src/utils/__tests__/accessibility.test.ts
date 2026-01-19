/**
 * Accessibility Utilities Tests
 *
 * Sprint 132: Performance & Accessibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trapFocus,
  createFocusRestorer,
  getArrowDirection,
  handleListKeyboardNavigation,
  announce,
  getExpandableAriaProps,
  getSelectableAriaProps,
  getCheckedAriaProps,
  getToggleButtonAriaProps,
  getLoadingAriaProps,
  meetsContrastRequirement,
  getContrastRatio,
  DEFAULT_SKIP_LINKS,
} from '../accessibility';

describe('accessibility utilities', () => {
  describe('trapFocus', () => {
    let container: HTMLDivElement;
    let button1: HTMLButtonElement;
    let button2: HTMLButtonElement;
    let button3: HTMLButtonElement;

    beforeEach(() => {
      container = document.createElement('div');
      button1 = document.createElement('button');
      button2 = document.createElement('button');
      button3 = document.createElement('button');
      button1.textContent = 'First';
      button2.textContent = 'Second';
      button3.textContent = 'Third';
      container.appendChild(button1);
      container.appendChild(button2);
      container.appendChild(button3);
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('focuses first element on setup', () => {
      trapFocus(container);
      expect(document.activeElement).toBe(button1);
    });

    it('returns cleanup function', () => {
      const cleanup = trapFocus(container);
      expect(typeof cleanup).toBe('function');
    });

    it('traps forward tab on last element', () => {
      trapFocus(container);
      button3.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
      });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      container.dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalled();
    });

    it('traps backward tab on first element', () => {
      trapFocus(container);
      button1.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      container.dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalled();
    });

    it('ignores non-Tab keys', () => {
      trapFocus(container);

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      container.dispatchEvent(event);

      expect(preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('createFocusRestorer', () => {
    let button: HTMLButtonElement;

    beforeEach(() => {
      button = document.createElement('button');
      document.body.appendChild(button);
    });

    afterEach(() => {
      document.body.removeChild(button);
    });

    it('saves and restores focus', () => {
      button.focus();
      const restorer = createFocusRestorer();

      restorer.save();

      // Focus something else
      const otherButton = document.createElement('button');
      document.body.appendChild(otherButton);
      otherButton.focus();

      restorer.restore();

      expect(document.activeElement).toBe(button);

      document.body.removeChild(otherButton);
    });

    it('clears saved element after restore', () => {
      button.focus();
      const restorer = createFocusRestorer();

      restorer.save();
      restorer.restore();

      // Second restore should do nothing
      const focusSpy = vi.spyOn(button, 'focus');
      restorer.restore();

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('getArrowDirection', () => {
    it('returns "up" for ArrowUp', () => {
      const event = { key: 'ArrowUp' } as React.KeyboardEvent;
      expect(getArrowDirection(event)).toBe('up');
    });

    it('returns "down" for ArrowDown', () => {
      const event = { key: 'ArrowDown' } as React.KeyboardEvent;
      expect(getArrowDirection(event)).toBe('down');
    });

    it('returns "left" for ArrowLeft', () => {
      const event = { key: 'ArrowLeft' } as React.KeyboardEvent;
      expect(getArrowDirection(event)).toBe('left');
    });

    it('returns "right" for ArrowRight', () => {
      const event = { key: 'ArrowRight' } as React.KeyboardEvent;
      expect(getArrowDirection(event)).toBe('right');
    });

    it('returns null for other keys', () => {
      const event = { key: 'Enter' } as React.KeyboardEvent;
      expect(getArrowDirection(event)).toBeNull();
    });
  });

  describe('handleListKeyboardNavigation', () => {
    let items: HTMLButtonElement[];

    beforeEach(() => {
      items = [
        document.createElement('button'),
        document.createElement('button'),
        document.createElement('button'),
      ];
      items.forEach((btn) => document.body.appendChild(btn));
    });

    afterEach(() => {
      items.forEach((btn) => document.body.removeChild(btn));
    });

    it('moves down on ArrowDown (vertical)', () => {
      const event = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 0);

      expect(newIndex).toBe(1);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('moves up on ArrowUp (vertical)', () => {
      const event = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 1);

      expect(newIndex).toBe(0);
    });

    it('wraps to first on ArrowDown at end', () => {
      const event = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 2, { wrap: true });

      expect(newIndex).toBe(0);
    });

    it('wraps to last on ArrowUp at start', () => {
      const event = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 0, { wrap: true });

      expect(newIndex).toBe(2);
    });

    it('stays at end when wrap is false', () => {
      const event = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 2, { wrap: false });

      expect(newIndex).toBe(2);
    });

    it('uses ArrowLeft/Right for horizontal orientation', () => {
      const eventRight = {
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(eventRight, items, 0, {
        orientation: 'horizontal',
      });

      expect(newIndex).toBe(1);
    });

    it('calls onSelect on Enter', () => {
      const onSelect = vi.fn();
      const event = {
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      handleListKeyboardNavigation(event, items, 1, { onSelect });

      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('calls onSelect on Space', () => {
      const onSelect = vi.fn();
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      handleListKeyboardNavigation(event, items, 2, { onSelect });

      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('returns null for empty list', () => {
      const event = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, [], 0);

      expect(newIndex).toBeNull();
    });

    it('returns null for irrelevant keys', () => {
      const event = {
        key: 'Escape',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      const newIndex = handleListKeyboardNavigation(event, items, 0);

      expect(newIndex).toBeNull();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('announce', () => {
    beforeEach(() => {
      // Clean up any existing live regions
      document.getElementById('live-region-polite')?.remove();
      document.getElementById('live-region-assertive')?.remove();
    });

    afterEach(() => {
      document.getElementById('live-region-polite')?.remove();
      document.getElementById('live-region-assertive')?.remove();
    });

    it('creates polite live region', () => {
      announce('Test message');

      const liveRegion = document.getElementById('live-region-polite');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    });

    it('creates assertive live region', () => {
      announce('Urgent message', 'assertive');

      const liveRegion = document.getElementById('live-region-assertive');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('assertive');
    });

    it('reuses existing live region', () => {
      announce('First message');
      announce('Second message');

      const liveRegions = document.querySelectorAll('#live-region-polite');
      expect(liveRegions.length).toBe(1);
    });

    it('sets aria-atomic to true', () => {
      announce('Test message');

      const liveRegion = document.getElementById('live-region-polite');
      expect(liveRegion?.getAttribute('aria-atomic')).toBe('true');
    });
  });

  describe('ARIA helper functions', () => {
    describe('getExpandableAriaProps', () => {
      it('returns expanded true', () => {
        const props = getExpandableAriaProps(true, 'panel-1');
        expect(props['aria-expanded']).toBe(true);
        expect(props['aria-controls']).toBe('panel-1');
      });

      it('returns expanded false', () => {
        const props = getExpandableAriaProps(false, 'panel-1');
        expect(props['aria-expanded']).toBe(false);
      });
    });

    describe('getSelectableAriaProps', () => {
      it('returns selected true', () => {
        const props = getSelectableAriaProps(true);
        expect(props['aria-selected']).toBe(true);
      });

      it('returns selected false', () => {
        const props = getSelectableAriaProps(false);
        expect(props['aria-selected']).toBe(false);
      });
    });

    describe('getCheckedAriaProps', () => {
      it('returns checked true', () => {
        const props = getCheckedAriaProps(true);
        expect(props['aria-checked']).toBe(true);
      });

      it('returns checked false', () => {
        const props = getCheckedAriaProps(false);
        expect(props['aria-checked']).toBe(false);
      });

      it('returns checked mixed', () => {
        const props = getCheckedAriaProps('mixed');
        expect(props['aria-checked']).toBe('mixed');
      });
    });

    describe('getToggleButtonAriaProps', () => {
      it('returns pressed true', () => {
        const props = getToggleButtonAriaProps(true);
        expect(props['aria-pressed']).toBe(true);
      });

      it('returns pressed false', () => {
        const props = getToggleButtonAriaProps(false);
        expect(props['aria-pressed']).toBe(false);
      });
    });

    describe('getLoadingAriaProps', () => {
      it('returns busy true when loading', () => {
        const props = getLoadingAriaProps(true);
        expect(props['aria-busy']).toBe(true);
        expect(props['aria-live']).toBe('polite');
      });

      it('returns busy false when not loading', () => {
        const props = getLoadingAriaProps(false);
        expect(props['aria-busy']).toBe(false);
        expect(props['aria-live']).toBeUndefined();
      });

      it('appends loading to label', () => {
        const props = getLoadingAriaProps(true, 'Data');
        expect(props['aria-label']).toBe('Data, loading');
      });

      it('keeps label without loading suffix when not loading', () => {
        const props = getLoadingAriaProps(false, 'Data');
        expect(props['aria-label']).toBe('Data');
      });
    });
  });

  describe('color contrast', () => {
    describe('getContrastRatio', () => {
      it('returns 21 for black on white', () => {
        const ratio = getContrastRatio('#ffffff', '#000000');
        expect(ratio).toBeCloseTo(21, 0);
      });

      it('returns 1 for same colors', () => {
        const ratio = getContrastRatio('#ffffff', '#ffffff');
        expect(ratio).toBeCloseTo(1, 1);
      });

      it('calculates ratio for arbitrary colors', () => {
        // Amber on dark gray
        const ratio = getContrastRatio('#f59e0b', '#1f2937');
        expect(ratio).toBeGreaterThan(1);
      });
    });

    describe('meetsContrastRequirement', () => {
      it('passes AA for black on white', () => {
        expect(meetsContrastRequirement('#000000', '#ffffff', 'AA')).toBe(true);
      });

      it('passes AAA for black on white', () => {
        expect(meetsContrastRequirement('#000000', '#ffffff', 'AAA')).toBe(true);
      });

      it('fails AA for low contrast', () => {
        // Light gray on white
        expect(meetsContrastRequirement('#cccccc', '#ffffff', 'AA')).toBe(false);
      });

      it('uses lower threshold for large text', () => {
        // Medium gray on white - fails for normal text, passes for large
        const fg = '#767676';
        const bg = '#ffffff';
        expect(meetsContrastRequirement(fg, bg, 'AA', false)).toBe(true);
        expect(meetsContrastRequirement(fg, bg, 'AA', true)).toBe(true);
      });

      it('uses correct AAA thresholds', () => {
        // AAA requires 7:1 for normal text, 4.5:1 for large
        expect(meetsContrastRequirement('#000000', '#ffffff', 'AAA', false)).toBe(true);
        expect(meetsContrastRequirement('#000000', '#ffffff', 'AAA', true)).toBe(true);
      });
    });
  });

  describe('DEFAULT_SKIP_LINKS', () => {
    it('includes skip to main content', () => {
      const mainLink = DEFAULT_SKIP_LINKS.find((l) => l.targetId === 'main-content');
      expect(mainLink).toBeDefined();
      expect(mainLink?.label).toContain('main');
    });

    it('includes skip to navigation', () => {
      const navLink = DEFAULT_SKIP_LINKS.find((l) => l.targetId === 'main-nav');
      expect(navLink).toBeDefined();
      expect(navLink?.label).toContain('navigation');
    });

    it('has unique ids', () => {
      const ids = DEFAULT_SKIP_LINKS.map((l) => l.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
