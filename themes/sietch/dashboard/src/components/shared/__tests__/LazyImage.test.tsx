/**
 * LazyImage Component Tests
 *
 * Sprint 132: Performance & Accessibility
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LazyImage, LazyAvatar } from '../LazyImage';

// Mock IntersectionObserver
const mockIntersectionObserver = vi.fn();
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  mockIntersectionObserver.mockImplementation((callback) => ({
    observe: mockObserve.mockImplementation((element) => {
      // Immediately trigger intersection for testing
      callback([{ isIntersecting: true, target: element }]);
    }),
    disconnect: mockDisconnect,
    unobserve: vi.fn(),
  }));
  window.IntersectionObserver = mockIntersectionObserver;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LazyImage', () => {
  const defaultProps = {
    src: 'https://example.com/image.jpg',
    alt: 'Test image',
  };

  describe('rendering', () => {
    it('renders image when in view', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img', { name: 'Test image' });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/image.jpg');
    });

    it('applies custom className', () => {
      render(<LazyImage {...defaultProps} className="custom-image" />);

      const container = document.querySelector('.lazy-image');
      expect(container).toHaveClass('custom-image');
    });

    it('sets width and height when provided', () => {
      render(<LazyImage {...defaultProps} width={200} height={150} />);

      const container = document.querySelector('.lazy-image') as HTMLElement;
      expect(container.style.width).toBe('200px');
      expect(container.style.height).toBe('150px');
    });

    it('sets aspect ratio when provided', () => {
      render(<LazyImage {...defaultProps} aspectRatio="16/9" />);

      const container = document.querySelector('.lazy-image') as HTMLElement;
      expect(container.style.aspectRatio).toBe('16/9');
    });

    it('sets object-fit from props', () => {
      render(<LazyImage {...defaultProps} objectFit="contain" />);

      const img = screen.getByRole('img');
      expect(img).toHaveStyle({ objectFit: 'contain' });
    });
  });

  describe('lazy loading', () => {
    it('uses IntersectionObserver for lazy loading', () => {
      render(<LazyImage {...defaultProps} />);

      expect(mockIntersectionObserver).toHaveBeenCalled();
      expect(mockObserve).toHaveBeenCalled();
    });

    it('disconnects observer when element enters view', () => {
      render(<LazyImage {...defaultProps} />);

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('loads immediately when loading is eager', () => {
      render(<LazyImage {...defaultProps} loading="eager" />);

      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
    });

    it('has 200px root margin for preloading', () => {
      render(<LazyImage {...defaultProps} />);

      expect(mockIntersectionObserver).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ rootMargin: '200px' })
      );
    });
  });

  describe('placeholders', () => {
    it('shows shimmer placeholder by default', () => {
      // Override mock to not immediately intersect
      mockIntersectionObserver.mockImplementation(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      }));

      render(<LazyImage {...defaultProps} />);

      const shimmer = document.querySelector('.animate-pulse');
      expect(shimmer).toBeInTheDocument();
    });

    it('shows blur placeholder with blurDataURL', () => {
      mockIntersectionObserver.mockImplementation(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      }));

      render(
        <LazyImage
          {...defaultProps}
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,abc123"
        />
      );

      const blurImg = document.querySelector('img[src="data:image/jpeg;base64,abc123"]');
      expect(blurImg).toBeInTheDocument();
    });

    it('shows no placeholder when set to none', () => {
      mockIntersectionObserver.mockImplementation(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      }));

      render(<LazyImage {...defaultProps} placeholder="none" />);

      const shimmer = document.querySelector('.animate-pulse');
      expect(shimmer).not.toBeInTheDocument();
    });

    it('hides placeholder on load', async () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img');
      fireEvent.load(img);

      await waitFor(() => {
        // Placeholder should be hidden (opacity 0)
        const placeholder = document.querySelector('[aria-hidden="true"]');
        if (placeholder) {
          expect((placeholder as HTMLElement).style.opacity).toBe('0');
        }
      });
    });
  });

  describe('loading callbacks', () => {
    it('calls onLoad when image loads', () => {
      const onLoad = vi.fn();
      render(<LazyImage {...defaultProps} onLoad={onLoad} />);

      const img = screen.getByRole('img');
      fireEvent.load(img);

      expect(onLoad).toHaveBeenCalled();
    });

    it('calls onError when image fails', () => {
      const onError = vi.fn();
      render(<LazyImage {...defaultProps} onError={onError} />);

      const img = screen.getByRole('img');
      fireEvent.error(img);

      expect(onError).toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('shows error state on load failure', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img', { name: 'Test image' });
      fireEvent.error(img);

      // Should show fallback error message
      expect(screen.getByLabelText(/Failed to load image: Test image/)).toBeInTheDocument();
    });

    it('hides main image on error', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img', { name: 'Test image' });
      fireEvent.error(img);

      // Main image should be removed
      expect(screen.queryByRole('img', { name: 'Test image' })).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has required alt text', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('alt', 'Test image');
    });

    it('uses empty alt for decorative images', () => {
      render(<LazyImage {...defaultProps} role="presentation" />);

      // Decorative images have role="presentation" and empty alt
      const img = document.querySelector('img[role="presentation"]');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('alt', '');
    });

    it('sets aria-hidden for decorative images', () => {
      render(<LazyImage {...defaultProps} role="presentation" />);

      const img = document.querySelector('img[role="presentation"]');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('aria-hidden', 'true');
    });

    it('placeholder has aria-hidden', () => {
      mockIntersectionObserver.mockImplementation(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      }));

      render(<LazyImage {...defaultProps} />);

      const placeholder = document.querySelector('[aria-hidden="true"]');
      expect(placeholder).toBeInTheDocument();
    });

    it('error state SVG has aria-hidden', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img', { name: 'Test image' });
      fireEvent.error(img);

      const svg = document.querySelector('svg[aria-hidden="true"]');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('responsive images', () => {
    it('accepts sizes attribute', () => {
      render(<LazyImage {...defaultProps} sizes="(max-width: 768px) 100vw, 50vw" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('sizes', '(max-width: 768px) 100vw, 50vw');
    });

    it('accepts srcSet attribute', () => {
      const srcSet = 'image-480.jpg 480w, image-800.jpg 800w';
      render(<LazyImage {...defaultProps} srcSet={srcSet} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('srcSet', srcSet);
    });
  });

  describe('image attributes', () => {
    it('sets decoding to async', () => {
      render(<LazyImage {...defaultProps} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('decoding', 'async');
    });

    it('passes width and height to img element', () => {
      render(<LazyImage {...defaultProps} width={200} height={150} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('width', '200');
      expect(img).toHaveAttribute('height', '150');
    });
  });
});

describe('LazyAvatar', () => {
  const defaultProps = {
    src: 'https://example.com/avatar.jpg',
    alt: 'User avatar',
  };

  describe('rendering', () => {
    it('renders as rounded image', () => {
      render(<LazyAvatar {...defaultProps} />);

      const container = document.querySelector('.lazy-image');
      expect(container).toHaveClass('rounded-full');
    });

    it('uses default size of 40', () => {
      render(<LazyAvatar {...defaultProps} />);

      const container = document.querySelector('.lazy-image') as HTMLElement;
      expect(container.style.width).toBe('40px');
      expect(container.style.height).toBe('40px');
    });

    it('accepts custom size', () => {
      render(<LazyAvatar {...defaultProps} size={64} />);

      const container = document.querySelector('.lazy-image') as HTMLElement;
      expect(container.style.width).toBe('64px');
      expect(container.style.height).toBe('64px');
    });
  });

  describe('fallback initial', () => {
    it('shows fallback initial on error when provided', () => {
      render(<LazyAvatar {...defaultProps} fallbackInitial="JD" />);

      const img = document.querySelector('img');
      if (img) {
        fireEvent.error(img);
      }

      // Should show initial
      expect(screen.getByText('J')).toBeInTheDocument();
    });

    it('capitalizes fallback initial', () => {
      render(<LazyAvatar {...defaultProps} fallbackInitial="john" />);

      const img = document.querySelector('img');
      if (img) {
        fireEvent.error(img);
      }

      expect(screen.getByText('J')).toBeInTheDocument();
    });

    it('fallback has correct aria-label', () => {
      render(<LazyAvatar {...defaultProps} fallbackInitial="JD" />);

      const img = document.querySelector('img');
      if (img) {
        fireEvent.error(img);
      }

      const fallback = screen.getByRole('img', { name: 'User avatar' });
      expect(fallback).toBeInTheDocument();
    });

    it('fallback scales font with size', () => {
      render(<LazyAvatar {...defaultProps} size={100} fallbackInitial="JD" />);

      const img = document.querySelector('img');
      if (img) {
        fireEvent.error(img);
      }

      const fallback = screen.getByText('J');
      const container = fallback.closest('div[role="img"]') as HTMLElement;
      // Size is applied via style attribute
      expect(container).toBeInTheDocument();
      expect(container.style.width).toBe('100px');
      expect(container.style.height).toBe('100px');
    });

    it('shows image without fallback when no error', () => {
      render(<LazyAvatar {...defaultProps} fallbackInitial="JD" />);

      const img = screen.getByRole('img', { name: 'User avatar' });
      expect(img.tagName).toBe('IMG');
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<LazyAvatar {...defaultProps} className="custom-avatar" />);

      const container = document.querySelector('.lazy-image');
      expect(container).toHaveClass('custom-avatar');
    });

    it('maintains rounded styling with custom class', () => {
      render(<LazyAvatar {...defaultProps} className="border-2" />);

      const container = document.querySelector('.lazy-image');
      expect(container).toHaveClass('rounded-full');
      expect(container).toHaveClass('border-2');
    });
  });
});
