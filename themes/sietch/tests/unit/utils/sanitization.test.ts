/**
 * Input Sanitization Tests (Sprint 74 - HIGH-3)
 *
 * Tests for sanitization utilities to ensure:
 * - XSS prevention
 * - Control character stripping
 * - Path traversal detection
 * - SQL injection pattern detection
 * - ReDoS prevention via regex escaping
 */

import { describe, it, expect } from 'vitest';
import {
  stripControlChars,
  stripHtmlTags,
  stripHtmlEntities,
  stripUrls,
  stripPathTraversal,
  escapeRegex,
  escapeHtml,
  hasControlChars,
  hasPathTraversal,
  hasScriptInjection,
  hasSqlInjection,
  detectDangerousPatterns,
  sanitizeText,
  sanitizeBio,
  sanitizeNym,
  sanitizeSearchQuery,
  sanitizeFilePath,
  sanitizeWithWarnings,
} from '../../../src/utils/sanitization.js';

describe('Input Sanitization Utilities', () => {
  // ==========================================================================
  // Control Character Tests
  // ==========================================================================
  describe('stripControlChars', () => {
    it('should remove null bytes', () => {
      expect(stripControlChars('Hello\x00World')).toBe('HelloWorld');
    });

    it('should remove ASCII control characters', () => {
      expect(stripControlChars('Test\x01\x02\x03')).toBe('Test');
    });

    it('should preserve newlines and tabs', () => {
      expect(stripControlChars('Hello\tWorld\n')).toBe('Hello\tWorld\n');
    });

    it('should remove DEL character', () => {
      expect(stripControlChars('Hello\x7FWorld')).toBe('HelloWorld');
    });

    it('should handle empty string', () => {
      expect(stripControlChars('')).toBe('');
    });
  });

  describe('hasControlChars', () => {
    it('should detect null byte', () => {
      expect(hasControlChars('Hello\x00World')).toBe(true);
    });

    it('should detect other control chars', () => {
      expect(hasControlChars('Test\x1F')).toBe(true);
    });

    it('should return false for clean string', () => {
      expect(hasControlChars('Hello World')).toBe(false);
    });

    it('should allow newlines', () => {
      expect(hasControlChars('Hello\nWorld')).toBe(false);
    });
  });

  // ==========================================================================
  // HTML Stripping Tests
  // ==========================================================================
  describe('stripHtmlTags', () => {
    it('should remove simple HTML tags', () => {
      expect(stripHtmlTags('<b>Bold</b>')).toBe('Bold');
    });

    it('should remove tags with attributes', () => {
      expect(stripHtmlTags('<a href="evil.com">Link</a>')).toBe('Link');
    });

    it('should remove script tags', () => {
      expect(stripHtmlTags('<script>alert(1)</script>')).toBe('alert(1)');
    });

    it('should remove self-closing tags', () => {
      expect(stripHtmlTags('<img src="x"/>')).toBe('');
    });

    it('should handle nested tags', () => {
      expect(stripHtmlTags('<div><span>Text</span></div>')).toBe('Text');
    });
  });

  describe('stripHtmlEntities', () => {
    it('should remove named entities', () => {
      expect(stripHtmlEntities('Hello&nbsp;World')).toBe('HelloWorld');
    });

    it('should remove numeric entities', () => {
      expect(stripHtmlEntities('Test&#60;script&#62;')).toBe('Testscript');
    });

    it('should remove hex entities', () => {
      expect(stripHtmlEntities('Test&#x3C;')).toBe('Test');
    });
  });

  // ==========================================================================
  // URL Stripping Tests
  // ==========================================================================
  describe('stripUrls', () => {
    it('should replace HTTP URLs', () => {
      expect(stripUrls('Visit http://evil.com for info')).toBe('Visit [link removed] for info');
    });

    it('should replace HTTPS URLs', () => {
      expect(stripUrls('Check https://example.com/path?query=1')).toBe('Check [link removed]');
    });

    it('should use custom replacement', () => {
      expect(stripUrls('See http://test.com', '***')).toBe('See ***');
    });

    it('should replace multiple URLs', () => {
      const input = 'Link1: http://a.com Link2: https://b.com';
      expect(stripUrls(input)).toBe('Link1: [link removed] Link2: [link removed]');
    });
  });

  // ==========================================================================
  // Path Traversal Tests
  // ==========================================================================
  describe('stripPathTraversal', () => {
    it('should remove ../ sequences', () => {
      expect(stripPathTraversal('../etc/passwd')).toBe('etc/passwd');
    });

    it('should remove ..\\ sequences', () => {
      expect(stripPathTraversal('..\\windows\\system32')).toBe('windows\\system32');
    });

    it('should handle multiple traversals', () => {
      expect(stripPathTraversal('../../etc/passwd')).toBe('etc/passwd');
    });
  });

  describe('hasPathTraversal', () => {
    it('should detect Unix path traversal', () => {
      expect(hasPathTraversal('../etc/passwd')).toBe(true);
    });

    it('should detect Windows path traversal', () => {
      expect(hasPathTraversal('..\\windows')).toBe(true);
    });

    it('should return false for safe paths', () => {
      expect(hasPathTraversal('/home/user/file.txt')).toBe(false);
    });
  });

  // ==========================================================================
  // Regex Escaping Tests (ReDoS Prevention)
  // ==========================================================================
  describe('escapeRegex', () => {
    it('should escape dot', () => {
      expect(escapeRegex('file.txt')).toBe('file\\.txt');
    });

    it('should escape asterisk', () => {
      expect(escapeRegex('*.js')).toBe('\\*\\.js');
    });

    it('should escape all special characters', () => {
      const special = '.*+?^${}()|[]\\';
      const escaped = escapeRegex(special);
      expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('should preserve alphanumeric', () => {
      expect(escapeRegex('abc123')).toBe('abc123');
    });
  });

  // ==========================================================================
  // HTML Escaping Tests
  // ==========================================================================
  describe('escapeHtml', () => {
    it('should escape less than', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape ampersand', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape quotes', () => {
      expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#x27;s');
    });
  });

  // ==========================================================================
  // Script Injection Detection Tests
  // ==========================================================================
  describe('hasScriptInjection', () => {
    it('should detect script tags', () => {
      expect(hasScriptInjection('<script>alert(1)</script>')).toBe(true);
    });

    it('should detect javascript: URLs', () => {
      expect(hasScriptInjection('javascript:alert(1)')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(hasScriptInjection('<img onerror=alert(1)>')).toBe(true);
    });

    it('should detect onclick', () => {
      expect(hasScriptInjection('onclick =alert(1)')).toBe(true);
    });

    it('should return false for safe content', () => {
      expect(hasScriptInjection('Hello World')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(hasScriptInjection('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    });
  });

  // ==========================================================================
  // SQL Injection Detection Tests
  // ==========================================================================
  describe('hasSqlInjection', () => {
    it('should detect OR 1=1 pattern', () => {
      expect(hasSqlInjection("' OR '1'='1")).toBe(true);
    });

    it('should detect DROP TABLE', () => {
      expect(hasSqlInjection('; DROP TABLE users;')).toBe(true);
    });

    it('should detect DELETE statement', () => {
      expect(hasSqlInjection('; DELETE FROM users;')).toBe(true);
    });

    it('should detect UNION SELECT', () => {
      expect(hasSqlInjection('; UNION SELECT * FROM passwords')).toBe(true);
    });

    it('should return false for safe input', () => {
      expect(hasSqlInjection('Hello World')).toBe(false);
    });
  });

  // ==========================================================================
  // Composite Detection Tests
  // ==========================================================================
  describe('detectDangerousPatterns', () => {
    it('should detect all dangerous patterns', () => {
      const input = '<script>../test\x00';
      const result = detectDangerousPatterns(input);
      expect(result.hasScriptInjection).toBe(true);
      expect(result.hasPathTraversal).toBe(true);
      expect(result.hasControlChars).toBe(true);
      expect(result.isDangerous).toBe(true);
    });

    it('should return all false for safe input', () => {
      const result = detectDangerousPatterns('Hello World');
      expect(result.isDangerous).toBe(false);
      expect(result.hasControlChars).toBe(false);
      expect(result.hasPathTraversal).toBe(false);
      expect(result.hasScriptInjection).toBe(false);
      expect(result.hasSqlInjection).toBe(false);
    });
  });

  // ==========================================================================
  // Composite Sanitization Tests
  // ==========================================================================
  describe('sanitizeText', () => {
    it('should strip HTML and control chars', () => {
      const result = sanitizeText('<b>Hello\x00World</b>');
      expect(result).toBe('HelloWorld');
    });

    it('should trim whitespace', () => {
      expect(sanitizeText('  Hello World  ')).toBe('Hello World');
    });

    it('should handle complex input', () => {
      const input = '<script>alert(1)</script>&nbsp;\x00Test';
      const result = sanitizeText(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('\x00');
    });
  });

  describe('sanitizeBio', () => {
    it('should strip URLs', () => {
      const result = sanitizeBio('Check out http://evil.com');
      expect(result).toBe('Check out [link removed]');
    });

    it('should respect max length', () => {
      const result = sanitizeBio('a'.repeat(200), 160);
      expect(result.length).toBe(160);
    });

    it('should apply all sanitization', () => {
      const input = '<b>Hello</b> http://test.com \x00';
      const result = sanitizeBio(input);
      expect(result).toBe('Hello [link removed]');
    });
  });

  describe('sanitizeNym', () => {
    it('should accept valid nym', () => {
      expect(sanitizeNym('validnym')).toBe('validnym');
    });

    it('should reject path traversal', () => {
      expect(sanitizeNym('../passwd')).toBeNull();
    });

    it('should reject script injection', () => {
      expect(sanitizeNym('<script>')).toBeNull();
    });

    it('should reject invalid format', () => {
      expect(sanitizeNym('_invalid')).toBeNull();
    });

    it('should reject too short', () => {
      expect(sanitizeNym('ab')).toBeNull();
    });

    it('should reject too long', () => {
      expect(sanitizeNym('a'.repeat(33))).toBeNull();
    });

    it('should strip control chars before validation', () => {
      expect(sanitizeNym('valid\x00nym')).toBe('validnym');
    });
  });

  describe('sanitizeSearchQuery', () => {
    it('should escape regex characters', () => {
      expect(sanitizeSearchQuery('test.*query')).toBe('test\\.\\*query');
    });

    it('should respect max length', () => {
      const result = sanitizeSearchQuery('a'.repeat(150), 100);
      expect(result.length).toBe(100);
    });

    it('should strip control characters', () => {
      expect(sanitizeSearchQuery('test\x00query')).toBe('testquery');
    });
  });

  describe('sanitizeFilePath', () => {
    it('should accept valid path', () => {
      expect(sanitizeFilePath('images/avatar.png')).toBe('images/avatar.png');
    });

    it('should reject path traversal', () => {
      expect(sanitizeFilePath('../etc/passwd')).toBeNull();
    });

    it('should normalize separators', () => {
      expect(sanitizeFilePath('path\\to\\file')).toBe('path/to/file');
    });

    it('should remove leading slashes', () => {
      expect(sanitizeFilePath('/etc/passwd')).toBe('etc/passwd');
    });
  });

  // ==========================================================================
  // Sanitization with Warnings Tests
  // ==========================================================================
  describe('sanitizeWithWarnings', () => {
    it('should return warnings for detected issues', () => {
      const result = sanitizeWithWarnings('<script>test\x00', { stripHtml: true });
      expect(result.warnings.length).toBeGreaterThan(0);
      // Should detect script injection and potentially control chars
      expect(result.warnings.some(w => w.includes('Script') || w.includes('HTML'))).toBe(true);
    });

    it('should strip URLs when requested', () => {
      const result = sanitizeWithWarnings('Visit http://test.com', { stripUrls: true });
      expect(result.sanitized).toContain('[link removed]');
      expect(result.warnings.some(w => w.includes('URLs'))).toBe(true);
    });

    it('should truncate to max length', () => {
      const result = sanitizeWithWarnings('a'.repeat(200), { maxLength: 100 });
      expect(result.sanitized.length).toBe(100);
      expect(result.warnings.some(w => w.includes('Truncated'))).toBe(true);
    });

    it('should escape output when requested', () => {
      const result = sanitizeWithWarnings('Test & value', { escapeOutput: true });
      expect(result.sanitized).toContain('&amp;');
    });

    it('should mark dangerous input as unsuccessful', () => {
      const result = sanitizeWithWarnings('<script>alert(1)</script>');
      expect(result.success).toBe(false);
    });

    it('should mark safe input as successful', () => {
      const result = sanitizeWithWarnings('Hello World');
      expect(result.success).toBe(true);
    });
  });
});
