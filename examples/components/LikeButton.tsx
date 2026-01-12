/**
 * LikeButton — Standard Mutation Example
 *
 * Physics: Optimistic, 200ms, No Confirmation
 *
 * This demonstrates correct physics for low-stakes mutations:
 * - Optimistic update (UI changes immediately)
 * - Rollback on error
 * - Snappy spring animation (~200ms)
 * - No confirmation needed
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'

interface LikeButtonProps {
  postId: string
  initialLiked: boolean
  initialCount: number
}

export function LikeButton({
  postId,
  initialLiked,
  initialCount
}: LikeButtonProps) {
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: async (liked: boolean) => {
      const response = await fetch(`/api/posts/${postId}/like`, {
        method: liked ? 'POST' : 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to update')
      return response.json()
    },

    // Optimistic update — UI changes BEFORE server responds
    onMutate: async (liked) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['post', postId] })

      // Snapshot previous value
      const previous = queryClient.getQueryData(['post', postId])

      // Optimistically update
      queryClient.setQueryData(['post', postId], (old: any) => ({
        ...old,
        liked,
        likeCount: old.likeCount + (liked ? 1 : -1),
      }))

      // Return context for rollback
      return { previous }
    },

    onError: (err, liked, context) => {
      // Rollback on error
      queryClient.setQueryData(['post', postId], context?.previous)
    },

    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['post', postId] })
    },
  })

  // Get current state from cache (optimistic)
  const post = queryClient.getQueryData<any>(['post', postId]) ?? {
    liked: initialLiked,
    likeCount: initialCount,
  }

  const handleClick = () => {
    mutate(!post.liked)
  }

  return (
    <motion.button
      onClick={handleClick}
      className={`like-button ${post.liked ? 'like-button--liked' : ''}`}
      whileTap={{ scale: 0.9 }}
      transition={{
        type: 'spring',
        stiffness: 500,  // Snappy spring
        damping: 30,
      }}
      aria-pressed={post.liked}
      aria-label={post.liked ? 'Unlike' : 'Like'}
    >
      <motion.span
        className="like-button__icon"
        animate={{
          scale: post.liked ? [1, 1.3, 1] : 1,
        }}
        transition={{
          duration: 0.2,  // Snappy 200ms
        }}
      >
        {post.liked ? '❤️' : '🤍'}
      </motion.span>

      <span className="like-button__count">
        {post.likeCount}
      </span>
    </motion.button>
  )
}

/**
 * Physics Validation Checklist:
 *
 * ✓ Optimistic sync — onMutate updates UI immediately
 * ✓ Rollback — onError restores previous state
 * ✓ Snappy timing — 200ms spring animation
 * ✓ No confirmation — Single click action
 * ✓ No loading state shown — Optimistic makes it unnecessary
 */
