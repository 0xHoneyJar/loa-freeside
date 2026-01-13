'use client';

import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';

// Characters to use for scrambling - themed around the aesthetic
const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________SPICEDUNEYHON';

interface TextScrambleProps {
  children: string;
  className?: string;
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'a';
  scrambleOnHover?: boolean;
  scrambleOnMount?: boolean;
  speed?: number;
}

export function TextScramble({
  children,
  className = '',
  as: Component = 'span',
  scrambleOnHover = true,
  scrambleOnMount = false,
  speed = 30,
}: TextScrambleProps) {
  const [displayText, setDisplayText] = useState(children);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const targetText = useRef(children);
  const currentIndex = useRef(0);

  const scramble = useCallback(() => {
    if (isScrambling) return;

    setIsScrambling(true);
    currentIndex.current = 0;
    const text = targetText.current;

    intervalRef.current = setInterval(() => {
      if (currentIndex.current >= text.length) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        setDisplayText(text);
        setIsScrambling(false);
        return;
      }

      // Build the display text: revealed chars + scrambled chars
      let result = '';
      for (let i = 0; i < text.length; i++) {
        if (i < currentIndex.current) {
          result += text[i];
        } else if (text[i] === ' ') {
          result += ' ';
        } else {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }

      setDisplayText(result);
      currentIndex.current += 1;
    }, speed);
  }, [isScrambling, speed]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Scramble on mount if enabled
  useEffect(() => {
    if (scrambleOnMount) {
      // Small delay for visual effect
      const timeout = setTimeout(scramble, 100);
      return () => clearTimeout(timeout);
    }
  }, [scrambleOnMount, scramble]);

  // Update target if children change
  useEffect(() => {
    targetText.current = children;
    if (!isScrambling) {
      setDisplayText(children);
    }
  }, [children, isScrambling]);

  const handleMouseEnter = () => {
    if (scrambleOnHover && !isScrambling) {
      scramble();
    }
  };

  return (
    <Component
      className={className}
      onMouseEnter={handleMouseEnter}
    >
      {displayText}
    </Component>
  );
}

// Wrapper for links that need scramble effect
interface ScrambleLinkProps {
  href: string;
  children: string;
  className?: string;
  external?: boolean;
}

export function ScrambleLink({ href, children, className = '', external = false }: ScrambleLinkProps) {
  const [displayText, setDisplayText] = useState(children);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const scramble = useCallback(() => {
    if (isScrambling) return;

    setIsScrambling(true);
    let currentIndex = 0;
    const text = children;

    intervalRef.current = setInterval(() => {
      if (currentIndex >= text.length) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        setDisplayText(text);
        setIsScrambling(false);
        return;
      }

      let result = '';
      for (let i = 0; i < text.length; i++) {
        if (i < currentIndex) {
          result += text[i];
        } else if (text[i] === ' ') {
          result += ' ';
        } else {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }

      setDisplayText(result);
      currentIndex += 1;
    }, 25);
  }, [isScrambling, children]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isScrambling) {
      setDisplayText(children);
    }
  }, [children, isScrambling]);

  const linkProps = external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};

  return (
    <a
      href={href}
      className={className}
      onMouseEnter={scramble}
      {...linkProps}
    >
      {displayText}
    </a>
  );
}

// Global scramble provider that applies to all text within
interface ScrambleProviderProps {
  children: ReactNode;
  className?: string;
}

export function ScrambleProvider({ children, className = '' }: ScrambleProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const originalTextsRef = useRef<Map<Element, string>>(new Map());
  const scramblingRef = useRef<Set<Element>>(new Set());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrambleElement = (element: Element) => {
      if (scramblingRef.current.has(element)) return;

      // Get original text
      let originalText = originalTextsRef.current.get(element);
      if (!originalText) {
        originalText = element.textContent || '';
        originalTextsRef.current.set(element, originalText);
      }

      if (!originalText || originalText.trim().length === 0) return;

      scramblingRef.current.add(element);

      let currentIndex = 0;
      const text = originalText;

      const interval = setInterval(() => {
        if (currentIndex >= text.length) {
          clearInterval(interval);
          element.textContent = text;
          scramblingRef.current.delete(element);
          return;
        }

        let result = '';
        for (let i = 0; i < text.length; i++) {
          if (i < currentIndex) {
            result += text[i];
          } else if (text[i] === ' ' || text[i] === '\n') {
            result += text[i];
          } else {
            result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          }
        }

        element.textContent = result;
        currentIndex += 1;
      }, 20);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as Element;

      // Skip elements inside tables
      if (target.closest('table')) return;

      // Only scramble leaf text nodes (elements with no child elements, only text)
      if (target && target.childNodes.length > 0) {
        const hasOnlyText = Array.from(target.childNodes).every(
          node => node.nodeType === Node.TEXT_NODE
        );

        if (hasOnlyText && target.textContent && target.textContent.trim().length > 0) {
          scrambleElement(target);
        }
      }
    };

    container.addEventListener('mouseover', handleMouseOver);

    return () => {
      container.removeEventListener('mouseover', handleMouseOver);
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
