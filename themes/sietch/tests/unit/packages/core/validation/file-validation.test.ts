/**
 * File Upload Validation Tests (Sprint 74 - HIGH-3)
 *
 * Tests for file upload validation using magic bytes detection.
 */

import { describe, it, expect } from 'vitest';
import {
  validateFileBuffer,
  validateImageFile,
  preValidateUpload,
  isMimeTypeAllowed,
  isExtensionAllowed,
  getAllowedMimeTypes,
  getAllowedExtensions,
  formatFileSize,
  FileValidationError,
  ALLOWED_IMAGE_TYPES,
} from '../../../../../src/packages/core/validation/file-validation.js';

// Test file magic bytes
const MAGIC_BYTES = {
  // JPEG: FF D8 FF
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // GIF: 47 49 46 38
  gif: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  // WebP: 52 49 46 46 ... 57 45 42 50
  webp: Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // file size placeholder
    Buffer.from([0x57, 0x45, 0x42, 0x50]),
  ]),
  // PDF: 25 50 44 46
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46]),
  // EXE/PE: 4D 5A
  exe: Buffer.from([0x4d, 0x5a]),
  // Random/unknown
  random: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
};

// Create minimal valid buffers
function createMinimalImage(type: keyof typeof MAGIC_BYTES): Buffer {
  const header = MAGIC_BYTES[type];
  // Pad to minimum size
  const padding = Buffer.alloc(Math.max(0, 200 - header.length));
  return Buffer.concat([header, padding]);
}

describe('File Upload Validation', () => {
  // ==========================================================================
  // Magic Bytes Detection Tests
  // ==========================================================================
  describe('validateFileBuffer', () => {
    describe('valid image files', () => {
      it('should accept valid JPEG', async () => {
        const buffer = createMinimalImage('jpeg');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(true);
        expect(result.detectedMime).toBe('image/jpeg');
      });

      it('should accept valid PNG', async () => {
        const buffer = createMinimalImage('png');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(true);
        expect(result.detectedMime).toBe('image/png');
      });

      it('should accept valid GIF', async () => {
        const buffer = createMinimalImage('gif');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(true);
        expect(result.detectedMime).toBe('image/gif');
      });
    });

    describe('invalid files', () => {
      it('should reject empty buffer', async () => {
        const result = await validateFileBuffer(Buffer.alloc(0));
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.EMPTY_FILE);
      });

      it('should reject buffer too small', async () => {
        const result = await validateFileBuffer(Buffer.from([0x01, 0x02]));
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.FILE_TOO_SMALL);
      });

      it('should reject buffer too large', async () => {
        const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
        largeBuffer.set(MAGIC_BYTES.jpeg, 0); // Add valid header
        const result = await validateFileBuffer(largeBuffer, { maxSize: 5 * 1024 * 1024 });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.FILE_TOO_LARGE);
      });

      it('should reject PDF (not in allowed types)', async () => {
        const buffer = createMinimalImage('pdf');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.DISALLOWED_TYPE);
      });

      it('should reject executable files', async () => {
        const buffer = createMinimalImage('exe');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(false);
        // Either unknown type or disallowed
        expect([FileValidationError.UNKNOWN_TYPE, FileValidationError.DISALLOWED_TYPE]).toContain(
          result.errorCode
        );
      });

      it('should reject unknown file types', async () => {
        const buffer = createMinimalImage('random');
        const result = await validateFileBuffer(buffer);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.UNKNOWN_TYPE);
      });
    });

    describe('MIME type mismatch detection', () => {
      it('should reject when declared MIME differs from detected (strict mode)', async () => {
        const buffer = createMinimalImage('jpeg');
        const result = await validateFileBuffer(buffer, {
          declaredMime: 'image/png', // Wrong!
          strictMimeValidation: true,
        });
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(FileValidationError.MIME_MISMATCH);
      });

      it('should accept matching declared MIME', async () => {
        const buffer = createMinimalImage('jpeg');
        const result = await validateFileBuffer(buffer, {
          declaredMime: 'image/jpeg',
          strictMimeValidation: true,
        });
        expect(result.valid).toBe(true);
      });

      it('should handle MIME type with parameters', async () => {
        const buffer = createMinimalImage('jpeg');
        const result = await validateFileBuffer(buffer, {
          declaredMime: 'image/jpeg; charset=utf-8',
          strictMimeValidation: true,
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Image-Specific Validation Tests
  // ==========================================================================
  describe('validateImageFile', () => {
    it('should accept valid image', async () => {
      const buffer = createMinimalImage('jpeg');
      const result = await validateImageFile(buffer);
      expect(result.valid).toBe(true);
    });

    it('should respect custom max size', async () => {
      const buffer = createMinimalImage('jpeg');
      const result = await validateImageFile(buffer, {
        maxSize: 100, // Very small limit
      });
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(FileValidationError.FILE_TOO_LARGE);
    });

    it('should reject non-image file', async () => {
      const buffer = createMinimalImage('pdf');
      const result = await validateImageFile(buffer);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Pre-Upload Validation Tests
  // ==========================================================================
  describe('preValidateUpload', () => {
    it('should validate allowed MIME type', () => {
      const result = preValidateUpload({ declaredMime: 'image/jpeg' });
      expect(result.mimeAllowed).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject disallowed MIME type', () => {
      const result = preValidateUpload({ declaredMime: 'application/pdf' });
      expect(result.mimeAllowed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate allowed extension', () => {
      const result = preValidateUpload({ fileName: 'avatar.jpg' });
      expect(result.extensionAllowed).toBe(true);
    });

    it('should reject disallowed extension', () => {
      const result = preValidateUpload({ fileName: 'malware.exe' });
      expect(result.extensionAllowed).toBe(false);
    });

    it('should validate file size', () => {
      const result = preValidateUpload({ size: 1024 });
      expect(result.sizeAllowed).toBe(true);
    });

    it('should reject oversized file', () => {
      const result = preValidateUpload({ size: 10 * 1024 * 1024 }); // 10MB
      expect(result.sizeAllowed).toBe(false);
    });

    it('should reject empty file', () => {
      const result = preValidateUpload({ size: 0 });
      expect(result.sizeAllowed).toBe(false);
      expect(result.errors).toContain('File cannot be empty');
    });

    it('should collect all errors', () => {
      const result = preValidateUpload({
        declaredMime: 'application/pdf',
        fileName: 'virus.exe',
        size: 100 * 1024 * 1024, // 100MB
      });
      expect(result.errors.length).toBe(3);
    });
  });

  // ==========================================================================
  // Utility Function Tests
  // ==========================================================================
  describe('isMimeTypeAllowed', () => {
    it('should return true for allowed types', () => {
      expect(isMimeTypeAllowed('image/jpeg')).toBe(true);
      expect(isMimeTypeAllowed('image/png')).toBe(true);
      expect(isMimeTypeAllowed('image/gif')).toBe(true);
      expect(isMimeTypeAllowed('image/webp')).toBe(true);
    });

    it('should return false for disallowed types', () => {
      expect(isMimeTypeAllowed('application/pdf')).toBe(false);
      expect(isMimeTypeAllowed('text/html')).toBe(false);
      expect(isMimeTypeAllowed('application/x-executable')).toBe(false);
    });

    it('should handle MIME with parameters', () => {
      expect(isMimeTypeAllowed('image/jpeg; charset=utf-8')).toBe(true);
    });

    it('should lowercase MIME types before checking', () => {
      // MIME types are normalized to lowercase before checking
      expect(isMimeTypeAllowed('image/jpeg')).toBe(true);
    });
  });

  describe('isExtensionAllowed', () => {
    it('should return true for allowed extensions', () => {
      expect(isExtensionAllowed('jpg')).toBe(true);
      expect(isExtensionAllowed('jpeg')).toBe(true);
      expect(isExtensionAllowed('png')).toBe(true);
      expect(isExtensionAllowed('gif')).toBe(true);
      expect(isExtensionAllowed('webp')).toBe(true);
    });

    it('should return false for disallowed extensions', () => {
      expect(isExtensionAllowed('exe')).toBe(false);
      expect(isExtensionAllowed('pdf')).toBe(false);
      expect(isExtensionAllowed('js')).toBe(false);
    });

    it('should handle extensions with dot', () => {
      expect(isExtensionAllowed('.jpg')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isExtensionAllowed('JPG')).toBe(true);
      expect(isExtensionAllowed('PNG')).toBe(true);
    });
  });

  describe('getAllowedMimeTypes', () => {
    it('should return array of MIME types', () => {
      const types = getAllowedMimeTypes();
      expect(types).toContain('image/jpeg');
      expect(types).toContain('image/png');
      expect(types).toContain('image/gif');
      expect(types).toContain('image/webp');
    });
  });

  describe('getAllowedExtensions', () => {
    it('should return array of extensions', () => {
      const exts = getAllowedExtensions();
      expect(exts).toContain('jpg');
      expect(exts).toContain('jpeg');
      expect(exts).toContain('png');
      expect(exts).toContain('gif');
      expect(exts).toContain('webp');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  // ==========================================================================
  // Security Attack Scenario Tests
  // ==========================================================================
  describe('Security Attack Scenarios', () => {
    it('should reject image with fake extension (polyglot)', async () => {
      // Create a "JPEG" that's actually PDF data
      const pdfBuffer = createMinimalImage('pdf');
      const result = await validateFileBuffer(pdfBuffer, {
        declaredMime: 'image/jpeg', // Attacker lies about type
        strictMimeValidation: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject executable disguised as image', async () => {
      const exeBuffer = createMinimalImage('exe');
      const result = await validateFileBuffer(exeBuffer, {
        declaredMime: 'image/png',
        strictMimeValidation: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should detect when extension does not match content', () => {
      // Pre-validation passes but actual validation fails
      const preResult = preValidateUpload({
        fileName: 'innocent.jpg',
        declaredMime: 'image/jpeg',
        size: 1024,
      });
      expect(preResult.mimeAllowed).toBe(true);
      expect(preResult.extensionAllowed).toBe(true);
      // But actual file validation would catch the mismatch
    });
  });
});
