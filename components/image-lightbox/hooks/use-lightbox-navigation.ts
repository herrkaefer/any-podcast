'use client'

import { useCallback, useEffect, useState } from 'react'

interface UseLightboxNavigationProps {
  imagesLength: number
  initialIndex: number
  open: boolean
  onViewChange?: (index: number) => void
  resetZoom: () => void
}

export function useLightboxNavigation({ imagesLength, initialIndex, open, onViewChange, resetZoom }: UseLightboxNavigationProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  useEffect(() => {
    if (!open)
      return

    const rafId = requestAnimationFrame(() => {
      setCurrentIndex(initialIndex)
      resetZoom()
    })

    return () => cancelAnimationFrame(rafId)
  }, [initialIndex, open, resetZoom])

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1
      setCurrentIndex(newIndex)
      onViewChange?.(newIndex)
      resetZoom()
    }
  }, [currentIndex, onViewChange, resetZoom])

  const handleNext = useCallback(() => {
    if (currentIndex < imagesLength - 1) {
      const newIndex = currentIndex + 1
      setCurrentIndex(newIndex)
      onViewChange?.(newIndex)
      resetZoom()
    }
  }, [currentIndex, imagesLength, onViewChange, resetZoom])

  const handleThumbnailClick = useCallback(
    (idx: number) => {
      setCurrentIndex(idx)
      onViewChange?.(idx)
      resetZoom()
    },
    [onViewChange, resetZoom],
  )

  useEffect(() => {
    if (!open)
      return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        handlePrevious()
      }
      else if (e.key === 'ArrowRight' && currentIndex < imagesLength - 1) {
        handleNext()
      }
      else if (e.key === 'Escape') {
        onViewChange?.(currentIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, currentIndex, imagesLength, handlePrevious, handleNext, onViewChange])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    }
    else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return {
    currentIndex,
    handlePrevious,
    handleNext,
    handleThumbnailClick,
  }
}
