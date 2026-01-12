'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// Scramble characters for glitch effect - Dune themed
const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#◇≋▲⫘';

interface GlitchTextProps {
  text: string;
  className?: string;
  as?: 'span' | 'h1' | 'h2' | 'p';
  triggerOnMount?: boolean;
  triggerOnHover?: boolean;
}

export function GlitchText({
  text,
  className = '',
  as: Component = 'span',
  triggerOnMount = false,
  triggerOnHover = true,
}: GlitchTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isScrambling, setIsScrambling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasTriggeredMount = useRef(false);

  const scramble = useCallback(() => {
    if (isScrambling) return;

    setIsScrambling(true);
    let currentIndex = 0;

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
        } else {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }

      setDisplayText(result);
      currentIndex += 1;
    }, 50); // Slightly slower for readability
  }, [isScrambling, text]);

  // Trigger on mount if enabled
  useEffect(() => {
    if (triggerOnMount && !hasTriggeredMount.current) {
      hasTriggeredMount.current = true;
      // Small delay for page load
      const timeout = setTimeout(scramble, 300);
      return () => clearTimeout(timeout);
    }
  }, [triggerOnMount, scramble]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleMouseEnter = triggerOnHover ? scramble : undefined;

  return (
    <Component
      className={className}
      onMouseEnter={handleMouseEnter}
    >
      {displayText}
    </Component>
  );
}
