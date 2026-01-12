/**
 * ThemeToggle — Local State Example
 *
 * Physics: Immediate, 100ms, No Confirmation
 *
 * This demonstrates correct physics for client-only state:
 * - No server sync
 * - Instant spring animation
 * - No loading states
 * - No confirmation
 */

import { motion } from 'framer-motion'
import { useTheme } from '@/hooks/useTheme' // Your theme hook

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  const handleToggle = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <button
      onClick={handleToggle}
      className="theme-toggle"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <span className="theme-toggle__track">
        <motion.span
          className="theme-toggle__thumb"
          animate={{
            x: isDark ? 24 : 0,
          }}
          transition={{
            type: 'spring',
            stiffness: 700,  // Very snappy
            damping: 35,     // Minimal overshoot
            // Results in ~100ms feel
          }}
        />

        <span className="theme-toggle__icons">
          <motion.span
            animate={{ opacity: isDark ? 0 : 1 }}
            transition={{ duration: 0.1 }}
          >
            ☀️
          </motion.span>
          <motion.span
            animate={{ opacity: isDark ? 1 : 0 }}
            transition={{ duration: 0.1 }}
          >
            🌙
          </motion.span>
        </span>
      </span>
    </button>
  )
}

/**
 * Physics Validation Checklist:
 *
 * ✓ Immediate sync — No server, useState only
 * ✓ Instant timing — ~100ms spring
 * ✓ No confirmation — Toggle is self-explanatory
 * ✓ No loading state — Nothing to wait for
 * ✓ Accessible — Proper role and aria attributes
 */
