/**
 * DeleteButton — Soft Delete Example
 *
 * Physics: Optimistic (because undo exists), 200ms, Toast Confirmation
 *
 * This demonstrates correct physics for reversible deletions:
 * - Optimistic update (item disappears immediately)
 * - Undo via toast (5 second window)
 * - Snappy animation
 * - Not scary because it's reversible
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { toast } from 'sonner' // Or your toast library

interface DeleteButtonProps {
  itemId: string
  itemName: string
  onDeleted?: () => void
}

export function DeleteButton({
  itemId,
  itemName,
  onDeleted
}: DeleteButtonProps) {
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Delete failed')
      return response.json()
    },

    // Optimistic — Safe because undo exists
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['items'] })

      const previous = queryClient.getQueryData(['items'])

      // Remove from list immediately
      queryClient.setQueryData(['items'], (old: any[]) =>
        old?.filter((item) => item.id !== itemId) ?? []
      )

      return { previous }
    },

    onError: (err, _, context) => {
      // Rollback
      queryClient.setQueryData(['items'], context?.previous)
      toast.error('Failed to delete')
    },

    onSuccess: () => {
      // Show undo toast
      toast(`"${itemName}" deleted`, {
        action: {
          label: 'Undo',
          onClick: () => handleUndo(),
        },
        duration: 5000, // 5 second undo window
      })

      onDeleted?.()
    },
  })

  const undoMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/items/${itemId}/restore`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error('Restore failed')
      return response.json()
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
      toast.success(`"${itemName}" restored`)
    },

    onError: () => {
      toast.error('Failed to restore')
    },
  })

  const handleDelete = () => {
    deleteMutation.mutate()
  }

  const handleUndo = () => {
    undoMutation.mutate()
  }

  return (
    <motion.button
      onClick={handleDelete}
      disabled={deleteMutation.isPending}
      className="delete-button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: 'spring',
        stiffness: 500,
        damping: 30, // Snappy
      }}
    >
      {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
    </motion.button>
  )
}

/**
 * Physics Validation Checklist:
 *
 * ✓ Optimistic sync — Safe because undo exists
 * ✓ Snappy timing — 200ms spring
 * ✓ Toast confirmation with undo — 5 second window
 * ✓ Rollback on error
 * ✓ Not scary — Optimistic + undo = confident feel
 */
