import sharp from 'sharp';
import { logger } from './logger.js';

/**
 * Image Processing Utilities
 *
 * Handles PFP compression, resizing, and format conversion
 * for member profile pictures.
 */

/**
 * Image processing configuration
 */
export const IMAGE_CONFIG = {
  /** Target size for profile pictures (square) */
  pfpSize: 256,
  /** Maximum file size in bytes (500KB) */
  maxFileSize: 500 * 1024,
  /** JPEG quality (0-100) */
  jpegQuality: 85,
  /** WebP quality (0-100) */
  webpQuality: 80,
  /** Allowed input MIME types */
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const,
  /** Output format */
  outputFormat: 'webp' as const,
} as const;

/**
 * Result of image processing
 */
export interface ProcessedImage {
  /** Processed image buffer */
  buffer: Buffer;
  /** Output MIME type */
  mimeType: string;
  /** Output file extension */
  extension: string;
  /** Original dimensions */
  originalDimensions: { width: number; height: number };
  /** Final dimensions */
  finalDimensions: { width: number; height: number };
  /** Final file size in bytes */
  fileSize: number;
}

/**
 * Image processing error
 */
export class ImageProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_FORMAT' | 'TOO_LARGE' | 'PROCESSING_FAILED' | 'FETCH_FAILED'
  ) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

/**
 * Check if MIME type is allowed
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return IMAGE_CONFIG.allowedMimeTypes.includes(mimeType as typeof IMAGE_CONFIG.allowedMimeTypes[number]);
}

/**
 * Get file extension for MIME type
 */
export function getExtensionForMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return extensions[mimeType] || 'bin';
}

/**
 * Process and optimize a profile picture from a buffer
 *
 * @param input - Image buffer
 * @param mimeType - Input MIME type (optional, will be detected if not provided)
 * @returns Processed image result
 */
export async function processProfilePicture(
  input: Buffer,
  mimeType?: string
): Promise<ProcessedImage> {
  try {
    // Get image metadata
    const metadata = await sharp(input).metadata();

    if (!metadata.width || !metadata.height) {
      throw new ImageProcessingError('Could not determine image dimensions', 'PROCESSING_FAILED');
    }

    const originalDimensions = { width: metadata.width, height: metadata.height };

    // Validate format
    if (mimeType && !isAllowedMimeType(mimeType)) {
      throw new ImageProcessingError(
        `Unsupported image format: ${mimeType}. Allowed: ${IMAGE_CONFIG.allowedMimeTypes.join(', ')}`,
        'INVALID_FORMAT'
      );
    }

    // Process the image:
    // 1. Resize to target size (cover mode to fill square, centered crop)
    // 2. Convert to WebP for optimal compression
    const processed = await sharp(input)
      .resize(IMAGE_CONFIG.pfpSize, IMAGE_CONFIG.pfpSize, {
        fit: 'cover',
        position: 'centre',
      })
      .webp({ quality: IMAGE_CONFIG.webpQuality })
      .toBuffer();

    // Check file size
    if (processed.length > IMAGE_CONFIG.maxFileSize) {
      // Try with lower quality
      const reprocessed = await sharp(input)
        .resize(IMAGE_CONFIG.pfpSize, IMAGE_CONFIG.pfpSize, {
          fit: 'cover',
          position: 'centre',
        })
        .webp({ quality: 60 })
        .toBuffer();

      if (reprocessed.length > IMAGE_CONFIG.maxFileSize) {
        throw new ImageProcessingError(
          `Image too large after compression: ${Math.round(reprocessed.length / 1024)}KB (max: ${IMAGE_CONFIG.maxFileSize / 1024}KB)`,
          'TOO_LARGE'
        );
      }

      return {
        buffer: reprocessed,
        mimeType: 'image/webp',
        extension: 'webp',
        originalDimensions,
        finalDimensions: { width: IMAGE_CONFIG.pfpSize, height: IMAGE_CONFIG.pfpSize },
        fileSize: reprocessed.length,
      };
    }

    return {
      buffer: processed,
      mimeType: 'image/webp',
      extension: 'webp',
      originalDimensions,
      finalDimensions: { width: IMAGE_CONFIG.pfpSize, height: IMAGE_CONFIG.pfpSize },
      fileSize: processed.length,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw error;
    }

    logger.error({ error }, 'Image processing failed');
    throw new ImageProcessingError(
      'Failed to process image',
      'PROCESSING_FAILED'
    );
  }
}

/**
 * Fetch and process an image from a URL
 *
 * @param url - Image URL (e.g., Discord CDN)
 * @returns Processed image result
 */
export async function fetchAndProcessImage(url: string): Promise<ProcessedImage> {
  try {
    // Validate URL
    const parsedUrl = new URL(url);

    // Only allow HTTPS and specific trusted domains
    const trustedDomains = [
      'cdn.discordapp.com',
      'media.discordapp.net',
      'i.imgur.com',
    ];

    if (parsedUrl.protocol !== 'https:') {
      throw new ImageProcessingError('Only HTTPS URLs are allowed', 'FETCH_FAILED');
    }

    if (!trustedDomains.some((domain) => parsedUrl.hostname === domain)) {
      throw new ImageProcessingError(
        `Untrusted domain: ${parsedUrl.hostname}. Allowed: ${trustedDomains.join(', ')}`,
        'FETCH_FAILED'
      );
    }

    // Fetch the image
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Sietch-Service/1.0',
      },
    });

    if (!response.ok) {
      throw new ImageProcessingError(
        `Failed to fetch image: ${response.status} ${response.statusText}`,
        'FETCH_FAILED'
      );
    }

    // Check content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const mimeType = contentType.split(';')[0] ?? contentType;
    if (!isAllowedMimeType(mimeType)) {
      throw new ImageProcessingError(
        `Unsupported image format from URL: ${contentType}`,
        'INVALID_FORMAT'
      );
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      // Allow up to 5MB for input (will be compressed)
      if (size > 5 * 1024 * 1024) {
        throw new ImageProcessingError(
          `Image too large: ${Math.round(size / 1024 / 1024)}MB (max: 5MB)`,
          'TOO_LARGE'
        );
      }
    }

    // Get buffer and process
    const buffer = Buffer.from(await response.arrayBuffer());
    return processProfilePicture(buffer, mimeType);
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw error;
    }

    logger.error({ error, url }, 'Failed to fetch image');
    throw new ImageProcessingError(
      'Failed to fetch image from URL',
      'FETCH_FAILED'
    );
  }
}

/**
 * Convert image buffer to data URL
 */
export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Generate a placeholder image (single color square)
 *
 * @param color - Hex color (e.g., '#ff0000')
 * @param size - Image size in pixels
 */
export async function generatePlaceholder(
  color: string = '#1a1a2e',
  size: number = IMAGE_CONFIG.pfpSize
): Promise<ProcessedImage> {
  // Parse hex color
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const buffer = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r, g, b },
    },
  })
    .webp({ quality: IMAGE_CONFIG.webpQuality })
    .toBuffer();

  return {
    buffer,
    mimeType: 'image/webp',
    extension: 'webp',
    originalDimensions: { width: size, height: size },
    finalDimensions: { width: size, height: size },
    fileSize: buffer.length,
  };
}

/**
 * Validate that a Discord CDN URL is well-formed
 */
export function isValidDiscordCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'cdn.discordapp.com' || parsed.hostname === 'media.discordapp.net')
    );
  } catch {
    return false;
  }
}

/**
 * Extract Discord CDN URL parameters
 */
export function parseDiscordCdnUrl(url: string): {
  valid: boolean;
  type?: 'avatar' | 'attachment' | 'emoji' | 'other';
  userId?: string;
  hash?: string;
} {
  if (!isValidDiscordCdnUrl(url)) {
    return { valid: false };
  }

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Avatar URL: /avatars/{userId}/{hash}.{ext}
    if (pathParts[0] === 'avatars' && pathParts.length >= 3) {
      const userId = pathParts[1];
      const hashWithExt = pathParts[2];
      const hash = hashWithExt?.split('.')[0];
      return { valid: true, type: 'avatar', userId, hash };
    }

    // Attachment URL: /attachments/{channelId}/{attachmentId}/{filename}
    if (pathParts[0] === 'attachments') {
      return { valid: true, type: 'attachment' };
    }

    return { valid: true, type: 'other' };
  } catch {
    return { valid: false };
  }
}
