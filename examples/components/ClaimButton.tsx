/**
 * ClaimButton — Financial Mutation Example
 *
 * Physics: Pessimistic, 800ms, Confirmation Required
 *
 * This demonstrates correct physics for financial operations:
 * - Two-phase confirmation (click → confirm)
 * - Pessimistic sync (no optimistic UI updates)
 * - Deliberate timing (800ms transitions)
 * - Clear escape hatch (cancel button)
 * - Explicit amount display
 * - Error handling
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'

interface ClaimButtonProps {
  poolId: string
  amount: bigint
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export function ClaimButton({
  poolId,
  amount,
  onSuccess,
  onError
}: ClaimButtonProps) {
  // Phase tracking: idle → confirming → pending → success/error
  const [phase, setPhase] = useState<'idle' | 'confirming'>('idle')

  const queryClient = useQueryClient()

  const { mutate, isPending, isError, error, reset } = useMutation({
    mutationFn: async () => {
      // Simulate API call
      const response = await fetch(`/api/pools/${poolId}/claim`, {
        method: 'POST',
        body: JSON.stringify({ amount: amount.toString() }),
      })
      if (!response.ok) throw new Error('Claim failed')
      return response.json()
    },

    // NO onMutate — Pessimistic means no optimistic updates

    onSuccess: () => {
      // Only update UI after server confirms
      queryClient.invalidateQueries({ queryKey: ['pools', poolId] })
      queryClient.invalidateQueries({ queryKey: ['balance'] })
      setPhase('idle')
      onSuccess?.()
    },

    onError: (err) => {
      onError?.(err as Error)
      // Stay in confirming phase to show error and allow retry
    },
  })

  const handleInitiate = () => {
    setPhase('confirming')
  }

  const handleConfirm = () => {
    mutate()
  }

  const handleCancel = () => {
    setPhase('idle')
    reset()
  }

  // Format amount for display
  const formattedAmount = formatTokenAmount(amount)

  return (
    <div className="claim-button-container">
      <AnimatePresence mode="wait">
        {phase === 'idle' ? (
          // Phase 1: Initial button
          <motion.button
            key="initiate"
            onClick={handleInitiate}
            className="claim-button claim-button--initiate"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            Claim {formattedAmount}
          </motion.button>
        ) : (
          // Phase 2: Confirmation
          <motion.div
            key="confirm"
            className="claim-confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              duration: 0.3,
              ease: [0.4, 0, 0.2, 1] // Deliberate ease-out
            }}
          >
            <p className="claim-confirm__message">
              Claim <strong>{formattedAmount}</strong> from this pool?
            </p>

            {isError && (
              <motion.p
                className="claim-confirm__error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                {(error as Error)?.message || 'Something went wrong'}
              </motion.p>
            )}

            <div className="claim-confirm__actions">
              {/* Cancel — Always visible and enabled */}
              <button
                onClick={handleCancel}
                className="claim-button claim-button--cancel"
                disabled={false} // Never disable cancel
              >
                Cancel
              </button>

              {/* Confirm — Disabled during pending */}
              <motion.button
                onClick={handleConfirm}
                disabled={isPending}
                className="claim-button claim-button--confirm"
                animate={{
                  opacity: isPending ? 0.7 : 1,
                }}
                transition={{
                  duration: 0.8 // Deliberate 800ms timing
                }}
              >
                {isPending ? (
                  <span className="claim-button__loading">
                    <Spinner />
                    Claiming...
                  </span>
                ) : (
                  'Confirm Claim'
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Helpers
function formatTokenAmount(amount: bigint): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  }).format(Number(amount) / 1e18)
}

function Spinner() {
  return (
    <motion.span
      className="spinner"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    >
      ⟳
    </motion.span>
  )
}

/**
 * Physics Validation Checklist:
 *
 * ✓ Pessimistic sync — No onMutate, UI updates only onSuccess
 * ✓ Deliberate timing — 800ms animation on confirm button
 * ✓ Confirmation required — Two-phase flow (click → confirm)
 * ✓ Escape hatch — Cancel button always available
 * ✓ Explicit amount — User sees exactly what they're claiming
 * ✓ Error handling — Errors shown, retry possible
 * ✓ Loading state — Clear pending indicator
 */
