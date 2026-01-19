/**
 * Lazy Image Component
 *
 * Sprint 132: Performance & Accessibility
 *
 * Image component with lazy loading and proper accessibility.
 *
 * @module components/shared/LazyImage
 */

import React, { useState, useRef, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface LazyImageProps {
  /** Image source URL */
  src: string;
  /** Alt text (required for accessibility) */
  alt: string;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** CSS class name */
  className?: string;
  /** Placeholder to show while loading */
  placeholder?: 'blur' | 'shimmer' | 'none';
  /** Blur data URL for blur placeholder */
  blurDataURL?: string;
  /** Loading strategy */
  loading?: 'lazy' | 'eager';
  /** Callback when image loads */
  onLoad?: () => void;
  /** Callback when image fails to load */
  onError?: () => void;
  /** Aspect ratio (e.g., "16/9") */
  aspectRatio?: string;
  /** Object fit */
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /** Sizes attribute for responsive images */
  sizes?: string;
  /** Srcset for responsive images */
  srcSet?: string;
  /** Role attribute (default: img, use "presentation" for decorative images) */
  role?: 'img' | 'presentation';
}

// =============================================================================
// Component
// =============================================================================

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  width,
  height,
  className = '',
  placeholder = 'shimmer',
  blurDataURL,
  loading = 'lazy',
  onLoad,
  onError,
  aspectRatio,
  objectFit = 'cover',
  sizes,
  srcSet,
  role = 'img',
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(loading === 'eager');
  const imgRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (loading === 'eager') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '200px', // Load images 200px before they enter viewport
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [loading]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
    onError?.();
  };

  // Container style
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
    aspectRatio: aspectRatio,
  };

  // Image style
  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit,
    transition: 'opacity 0.3s ease-in-out',
    opacity: isLoaded ? 1 : 0,
  };

  // Placeholder styles
  const placeholderStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    transition: 'opacity 0.3s ease-in-out',
    opacity: isLoaded ? 0 : 1,
  };

  // For decorative images, use empty alt and role="presentation"
  const imgAlt = role === 'presentation' ? '' : alt;
  const imgRole = role === 'presentation' ? 'presentation' : undefined;
  const ariaHidden = role === 'presentation' ? true : undefined;

  return (
    <div ref={imgRef} className={`lazy-image ${className}`} style={containerStyle}>
      {/* Placeholder */}
      {placeholder !== 'none' && !isLoaded && !hasError && (
        <div style={placeholderStyle} aria-hidden="true">
          {placeholder === 'blur' && blurDataURL ? (
            <img
              src={blurDataURL}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit,
                filter: 'blur(20px)',
                transform: 'scale(1.1)', // Prevent blur edges
              }}
            />
          ) : placeholder === 'shimmer' ? (
            <div
              className="w-full h-full bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 animate-pulse"
              style={{
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s infinite',
              }}
            />
          ) : null}
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div
          className="flex items-center justify-center w-full h-full bg-gray-800 text-gray-500"
          role="img"
          aria-label={`Failed to load image: ${alt}`}
        >
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}

      {/* Actual image */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={imgAlt}
          role={imgRole}
          aria-hidden={ariaHidden}
          width={width}
          height={height}
          sizes={sizes}
          srcSet={srcSet}
          onLoad={handleLoad}
          onError={handleError}
          style={imageStyle}
          decoding="async"
        />
      )}
    </div>
  );
};

// =============================================================================
// Avatar Variant
// =============================================================================

export interface LazyAvatarProps extends Omit<LazyImageProps, 'width' | 'height' | 'aspectRatio'> {
  /** Size in pixels (both width and height) */
  size?: number;
  /** Fallback initial(s) to show on error */
  fallbackInitial?: string;
}

export const LazyAvatar: React.FC<LazyAvatarProps> = ({
  size = 40,
  fallbackInitial,
  className = '',
  ...props
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError && fallbackInitial) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-gray-700 text-white font-medium ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        role="img"
        aria-label={props.alt}
      >
        {fallbackInitial.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <LazyImage
      {...props}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      onError={() => setHasError(true)}
    />
  );
};

export default LazyImage;
