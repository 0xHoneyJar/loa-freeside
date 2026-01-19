/**
 * StateEditor Component Tests
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Tests for state editor functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StateEditor, type UserState } from './StateEditor';

// =============================================================================
// Test Fixtures
// =============================================================================

const defaultState: UserState = {
  bgt: 0,
  engagement: 0,
  tenureDays: 0,
  badges: [],
  nfts: [],
  customAttributes: {},
};

const populatedState: UserState = {
  bgt: 5000,
  engagement: 75,
  tenureDays: 180,
  badges: ['early-adopter', 'contributor'],
  nfts: ['genesis-nft'],
  customAttributes: { vip: 'true' },
};

// =============================================================================
// Tests
// =============================================================================

describe('StateEditor', () => {
  describe('rendering', () => {
    it('should render core stats inputs', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} />);

      expect(screen.getByLabelText(/bgt balance/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/engagement score/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/tenure/i)).toBeInTheDocument();
    });

    it('should render scenario templates', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} />);

      expect(screen.getByText('New User')).toBeInTheDocument();
      expect(screen.getByText('Whale')).toBeInTheDocument();
      expect(screen.getByText('Veteran')).toBeInTheDocument();
      expect(screen.getByText('Lurker')).toBeInTheDocument();
    });

    it('should render state summary', () => {
      render(<StateEditor state={populatedState} onChange={vi.fn()} />);

      expect(screen.getByText('5,000')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('180')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} isLoading />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('core stats editing', () => {
    it('should update BGT when changed', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      const bgtInput = screen.getByLabelText(/bgt balance/i);
      fireEvent.change(bgtInput, { target: { value: '1000' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ bgt: 1000 })
      );
    });

    it('should update engagement when changed', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      const engagementInput = screen.getByLabelText(/engagement score/i);
      fireEvent.change(engagementInput, { target: { value: '50' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ engagement: 50 })
      );
    });

    it('should update tenure when changed', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      const tenureInput = screen.getByLabelText(/tenure/i);
      fireEvent.change(tenureInput, { target: { value: '365' } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ tenureDays: 365 })
      );
    });
  });

  describe('scenario templates', () => {
    it('should apply New User template', () => {
      const onChange = vi.fn();
      render(<StateEditor state={populatedState} onChange={onChange} />);

      fireEvent.click(screen.getByText('New User'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          bgt: 0,
          engagement: 0,
          tenureDays: 0,
          badges: [],
          nfts: [],
        })
      );
    });

    it('should apply Whale template', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      fireEvent.click(screen.getByText('Whale'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          bgt: 50000,
          engagement: 75,
        })
      );
    });

    it('should apply Veteran template', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      fireEvent.click(screen.getByText('Veteran'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          engagement: 95,
          tenureDays: 365,
        })
      );
    });

    it('should disable templates when disabled', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} disabled />);

      expect(screen.getByText('New User').closest('button')).toBeDisabled();
    });
  });

  describe('badges', () => {
    it('should toggle badge selection', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      // Click early-adopter badge
      fireEvent.click(screen.getByText('early-adopter'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          badges: ['early-adopter'],
        })
      );
    });

    it('should remove badge when clicked again', () => {
      const onChange = vi.fn();
      render(<StateEditor state={populatedState} onChange={onChange} />);

      // Click early-adopter badge (already selected)
      fireEvent.click(screen.getByText('early-adopter'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          badges: ['contributor'], // early-adopter removed
        })
      );
    });

    it('should show selected badges highlighted', () => {
      render(<StateEditor state={populatedState} onChange={vi.fn()} />);

      const earlyAdopterButton = screen.getByText('early-adopter');
      expect(earlyAdopterButton).toHaveClass('bg-amber-500');
    });
  });

  describe('NFTs', () => {
    it('should toggle NFT selection', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      // Click genesis-nft
      fireEvent.click(screen.getByText('genesis-nft'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          nfts: ['genesis-nft'],
        })
      );
    });
  });

  describe('custom attributes', () => {
    it('should expand custom attributes section', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} />);

      // Click to expand
      fireEvent.click(screen.getByText('Custom Attributes'));

      expect(screen.getByLabelText(/new attribute key/i)).toBeInTheDocument();
    });

    it('should add custom attribute', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      // Expand section
      fireEvent.click(screen.getByText('Custom Attributes'));

      // Fill in key and value
      fireEvent.change(screen.getByLabelText(/new attribute key/i), {
        target: { value: 'testKey' },
      });
      fireEvent.change(screen.getByLabelText(/new attribute value/i), {
        target: { value: 'testValue' },
      });

      // Click Add
      fireEvent.click(screen.getByText('Add'));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          customAttributes: { testKey: 'testValue' },
        })
      );
    });

    it('should remove custom attribute', () => {
      const onChange = vi.fn();
      render(<StateEditor state={populatedState} onChange={onChange} />);

      // Expand section
      fireEvent.click(screen.getByText('Custom Attributes'));

      // Click remove button
      fireEvent.click(screen.getByLabelText(/remove vip/i));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          customAttributes: {},
        })
      );
    });

    it('should show existing custom attributes', () => {
      render(<StateEditor state={populatedState} onChange={vi.fn()} />);

      // Expand section
      fireEvent.click(screen.getByText('Custom Attributes'));

      expect(screen.getByText('vip:')).toBeInTheDocument();
      expect(screen.getByText('true')).toBeInTheDocument();
    });

    it('should not add empty key', () => {
      const onChange = vi.fn();
      render(<StateEditor state={defaultState} onChange={onChange} />);

      // Expand section
      fireEvent.click(screen.getByText('Custom Attributes'));

      // Click Add without filling in key
      const addButton = screen.getByText('Add');
      expect(addButton).toBeDisabled();
    });
  });

  describe('disabled state', () => {
    it('should disable all inputs when disabled', () => {
      render(<StateEditor state={defaultState} onChange={vi.fn()} disabled />);

      expect(screen.getByLabelText(/bgt balance/i)).toBeDisabled();
      expect(screen.getByLabelText(/engagement score/i)).toBeDisabled();
      expect(screen.getByLabelText(/tenure/i)).toBeDisabled();
    });
  });
});
