'use client'

import { useCallback, useState } from 'react'

interface UseLightboxOptions {
  initialIndex?: number
}

export function useLightbox({ initialIndex = 0 }: UseLightboxOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  const open = useCallback((index: number) => {
    setCurrentIndex(index)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  const setIndex = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  return {
    isOpen,
    currentIndex,
    open,
    close,
    setIndex,
  }
}
