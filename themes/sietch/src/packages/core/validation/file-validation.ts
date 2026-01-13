/**
 * File Upload Validation (Sprint 74 - HIGH-3)
 *
 * Validates file uploads using:
 * - Magic bytes detection (actual file type verification)
 * - MIME type validation
 * - File size limits
 * - Extension validation
 *
 * This prevents attackers from uploading malicious files
 * by simply renaming them or changing the Content-Type header.
 *
 * @security Critical for preventing file upload attacks
 * @see https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
 */

import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Allowed file types with their properties
 */
export interface AllowedFileType {
  /** MIME type */
  mime: string;
  /** File extensions (without dot) */
  extensions: string[];
  /** Maximum file size in bytes */
  maxSize: number;
  /** Human-readable description */
  description: string;
}

/**
 * Default allowed image types for profile pictures
 */
export const ALLOWED_IMAGE_TYPES: AllowedFileType[] = [
  {
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    maxSize: 5 * 1024 * 1024, // 5MB
    description: 'JPEG Image',
  },
  {
    mime: 'image/png',
    extensions: ['png'],
    maxSize: 5 * 1024 * 1024, // 5MB
    description: 'PNG Image',
  },
  {
    mime: 'image/gif',
    extensions: ['gif'],
    maxSize: 5 * 1024 * 1024, // 5MB
    description: 'GIF Image',
  },
  {
    mime: 'image/webp',
    extensions: ['webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    description: 'WebP Image',
  },
];

/**
 * Default configuration
 */
export const FILE_VALIDATION_CONFIG = {
  /** Maximum file size (5MB default) */
  maxFileSize: 5 * 1024 * 1024,
  /** Minimum file size (prevent empty files) */
  minFileSize: 100,
  /** Whether to allow animated images */
  allowAnimated: true,
  /** Strict mode: reject if magic bytes don't match declared MIME */
  strictMimeValidation: true,
};

// =============================================================================
// Validation Result Types
// =============================================================================

export interface FileValidationResult {
  /** Whether the file is valid */
  valid: boolean;
  /** Detected MIME type from magic bytes */
  detectedMime?: string;
  /** Detected file extension */
  detectedExtension?: string;
  /** Error message if invalid */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: FileValidationError;
  /** Warnings (non-blocking issues) */
  warnings: string[];
}

export enum FileValidationError {
  EMPTY_FILE = 'EMPTY_FILE',
  FILE_TOO_SMALL = 'FILE_TOO_SMALL',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNKNOWN_TYPE = 'UNKNOWN_TYPE',
  DISALLOWED_TYPE = 'DISALLOWED_TYPE',
  MIME_MISMATCH = 'MIME_MISMATCH',
  MALFORMED_FILE = 'MALFORMED_FILE',
}

// =============================================================================
// Core Validation Functions
// =============================================================================

/**
 * Validate file buffer against allowed types using magic bytes
 *
 * This is the primary validation function that should be used for all
 * file uploads. It verifies the actual file content, not just the
 * declared MIME type or extension.
 *
 * @param buffer - File buffer to validate
 * @param options - Validation options
 * @returns Validation result
 */
export async function validateFileBuffer(
  buffer: Buffer,
  options: {
    allowedTypes?: AllowedFileType[];
    declaredMime?: string;
    maxSize?: number;
    minSize?: number;
    strictMimeValidation?: boolean;
  } = {}
): Promise<FileValidationResult> {
  const {
    allowedTypes = ALLOWED_IMAGE_TYPES,
    declaredMime,
    maxSize = FILE_VALIDATION_CONFIG.maxFileSize,
    minSize = FILE_VALIDATION_CONFIG.minFileSize,
    strictMimeValidation = FILE_VALIDATION_CONFIG.strictMimeValidation,
  } = options;

  const warnings: string[] = [];

  // Check for empty buffer
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      error: 'File is empty',
      errorCode: FileValidationError.EMPTY_FILE,
      warnings,
    };
  }

  // Check minimum size
  if (buffer.length < minSize) {
    return {
      valid: false,
      error: `File too small (${buffer.length} bytes, minimum ${minSize} bytes)`,
      errorCode: FileValidationError.FILE_TOO_SMALL,
      warnings,
    };
  }

  // Check maximum size
  if (buffer.length > maxSize) {
    return {
      valid: false,
      error: `File too large (${Math.round(buffer.length / 1024)}KB, maximum ${Math.round(maxSize / 1024)}KB)`,
      errorCode: FileValidationError.FILE_TOO_LARGE,
      warnings,
    };
  }

  // Detect actual file type from magic bytes
  let fileType;
  try {
    fileType = await fileTypeFromBuffer(buffer);
  } catch (error) {
    logger.warn({ error }, 'Error detecting file type from magic bytes');
    return {
      valid: false,
      error: 'Could not determine file type',
      errorCode: FileValidationError.MALFORMED_FILE,
      warnings,
    };
  }

  // Check if file type was detected
  if (!fileType) {
    return {
      valid: false,
      error: 'Unknown file type - could not detect from file contents',
      errorCode: FileValidationError.UNKNOWN_TYPE,
      warnings,
    };
  }

  const { mime: detectedMime, ext: detectedExtension } = fileType;

  // Check if detected type is in allowed list
  const allowedType = allowedTypes.find((t) => t.mime === detectedMime);

  if (!allowedType) {
    const allowedMimes = allowedTypes.map((t) => t.mime).join(', ');
    return {
      valid: false,
      detectedMime,
      detectedExtension,
      error: `File type ${detectedMime} not allowed. Allowed types: ${allowedMimes}`,
      errorCode: FileValidationError.DISALLOWED_TYPE,
      warnings,
    };
  }

  // Check type-specific size limit
  if (buffer.length > allowedType.maxSize) {
    return {
      valid: false,
      detectedMime,
      detectedExtension,
      error: `File too large for ${allowedType.description} (${Math.round(buffer.length / 1024)}KB, maximum ${Math.round(allowedType.maxSize / 1024)}KB)`,
      errorCode: FileValidationError.FILE_TOO_LARGE,
      warnings,
    };
  }

  // Check MIME type match if declared
  if (strictMimeValidation && declaredMime) {
    const normalizedDeclared = declaredMime.split(';')[0]?.trim().toLowerCase();

    if (normalizedDeclared && normalizedDeclared !== detectedMime) {
      // For security, we reject mismatches in strict mode
      logger.warn(
        {
          declaredMime: normalizedDeclared,
          detectedMime,
        },
        'MIME type mismatch: declared vs detected'
      );

      return {
        valid: false,
        detectedMime,
        detectedExtension,
        error: `File type mismatch: declared ${normalizedDeclared} but detected ${detectedMime}`,
        errorCode: FileValidationError.MIME_MISMATCH,
        warnings,
      };
    }
  }

  return {
    valid: true,
    detectedMime,
    detectedExtension,
    warnings,
  };
}

/**
 * Validate an image file specifically
 *
 * @param buffer - Image buffer
 * @param options - Image-specific options
 * @returns Validation result
 */
export async function validateImageFile(
  buffer: Buffer,
  options: {
    maxSize?: number;
    declaredMime?: string;
    allowAnimated?: boolean;
  } = {}
): Promise<FileValidationResult> {
  const {
    maxSize = FILE_VALIDATION_CONFIG.maxFileSize,
    declaredMime,
    allowAnimated = FILE_VALIDATION_CONFIG.allowAnimated,
  } = options;

  // Use base validation with image types
  const result = await validateFileBuffer(buffer, {
    allowedTypes: ALLOWED_IMAGE_TYPES,
    declaredMime,
    maxSize,
    strictMimeValidation: true,
  });

  // Additional check for animated images if not allowed
  if (result.valid && !allowAnimated && result.detectedMime === 'image/gif') {
    // Check if GIF is animated by looking for multiple frames
    // A simple heuristic: animated GIFs have multiple NETSCAPE extension blocks
    // or multiple image descriptors
    if (isAnimatedGif(buffer)) {
      return {
        valid: false,
        detectedMime: result.detectedMime,
        detectedExtension: result.detectedExtension,
        error: 'Animated images are not allowed',
        errorCode: FileValidationError.DISALLOWED_TYPE,
        warnings: result.warnings,
      };
    }
  }

  return result;
}

/**
 * Simple check if a GIF is animated
 * Looks for the NETSCAPE2.0 application extension which indicates animation
 */
function isAnimatedGif(buffer: Buffer): boolean {
  // Check for NETSCAPE2.0 extension (indicates animation)
  const netscapeMarker = Buffer.from('NETSCAPE2.0');
  const graphicControlExt = 0x21; // Extension introducer
  const graphicControlLabel = 0xf9; // Graphic control label

  let graphicControlCount = 0;

  for (let i = 0; i < buffer.length - 1; i++) {
    // Count graphic control extensions (one per frame)
    if (buffer[i] === graphicControlExt && buffer[i + 1] === graphicControlLabel) {
      graphicControlCount++;
      if (graphicControlCount > 1) {
        return true; // More than one frame = animated
      }
    }
  }

  // Also check for NETSCAPE extension
  if (buffer.includes(netscapeMarker)) {
    return true;
  }

  return false;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get allowed MIME types as array
 */
export function getAllowedMimeTypes(types: AllowedFileType[] = ALLOWED_IMAGE_TYPES): string[] {
  return types.map((t) => t.mime);
}

/**
 * Get allowed extensions as array
 */
export function getAllowedExtensions(types: AllowedFileType[] = ALLOWED_IMAGE_TYPES): string[] {
  return types.flatMap((t) => t.extensions);
}

/**
 * Check if MIME type is allowed
 */
export function isMimeTypeAllowed(
  mime: string,
  types: AllowedFileType[] = ALLOWED_IMAGE_TYPES
): boolean {
  const normalizedMime = mime.split(';')[0]?.trim().toLowerCase();
  return types.some((t) => t.mime === normalizedMime);
}

/**
 * Check if extension is allowed
 */
export function isExtensionAllowed(
  ext: string,
  types: AllowedFileType[] = ALLOWED_IMAGE_TYPES
): boolean {
  const normalizedExt = ext.toLowerCase().replace(/^\./, '');
  return types.some((t) => t.extensions.includes(normalizedExt));
}

/**
 * Get file type info by MIME
 */
export function getFileTypeByMime(
  mime: string,
  types: AllowedFileType[] = ALLOWED_IMAGE_TYPES
): AllowedFileType | undefined {
  const normalizedMime = mime.split(';')[0]?.trim().toLowerCase();
  return types.find((t) => t.mime === normalizedMime);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// =============================================================================
// Pre-upload Validation (Client-side compatible)
// =============================================================================

/**
 * Pre-validation info for client-side checks
 * This doesn't validate magic bytes but provides early feedback
 */
export interface PreUploadValidation {
  mimeAllowed: boolean;
  extensionAllowed: boolean;
  sizeAllowed: boolean;
  errors: string[];
}

/**
 * Pre-validate upload metadata before receiving full file
 * Use for early rejection based on declared properties
 */
export function preValidateUpload(
  metadata: {
    declaredMime?: string;
    fileName?: string;
    size?: number;
  },
  options: {
    allowedTypes?: AllowedFileType[];
    maxSize?: number;
  } = {}
): PreUploadValidation {
  const { allowedTypes = ALLOWED_IMAGE_TYPES, maxSize = FILE_VALIDATION_CONFIG.maxFileSize } =
    options;

  const errors: string[] = [];
  let mimeAllowed = true;
  let extensionAllowed = true;
  let sizeAllowed = true;

  // Check MIME type if provided
  if (metadata.declaredMime) {
    mimeAllowed = isMimeTypeAllowed(metadata.declaredMime, allowedTypes);
    if (!mimeAllowed) {
      errors.push(
        `File type ${metadata.declaredMime} not allowed. Allowed: ${getAllowedMimeTypes(allowedTypes).join(', ')}`
      );
    }
  }

  // Check extension if filename provided
  if (metadata.fileName) {
    const ext = metadata.fileName.split('.').pop() || '';
    extensionAllowed = isExtensionAllowed(ext, allowedTypes);
    if (!extensionAllowed) {
      errors.push(
        `File extension .${ext} not allowed. Allowed: ${getAllowedExtensions(allowedTypes).map((e) => `.${e}`).join(', ')}`
      );
    }
  }

  // Check size if provided
  if (metadata.size !== undefined) {
    sizeAllowed = metadata.size <= maxSize && metadata.size > 0;
    if (!sizeAllowed) {
      if (metadata.size === 0) {
        errors.push('File cannot be empty');
      } else {
        errors.push(`File too large (${formatFileSize(metadata.size)}, max ${formatFileSize(maxSize)})`);
      }
    }
  }

  return {
    mimeAllowed,
    extensionAllowed,
    sizeAllowed,
    errors,
  };
}
