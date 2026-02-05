'use client'

import type { ZoomState } from '@/components/image-lightbox/types'
import { useCallback, useRef, useState } from 'react'

export function useLightboxZoom() {
  const [zoom, setZoom] = useState<ZoomState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  })
  const lastDoubleClickRef = useRef<number>(0)

  const resetZoom = useCallback(() => {
    setZoom({ scale: 1, translateX: 0, translateY: 0 })
  }, [])

  const handleZoomIn = useCallback(() => {
    setZoom(prev => ({ ...prev, scale: Math.min(prev.scale * 2, 3) }))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom(prev => ({
      ...prev,
      scale: Math.max(prev.scale / 2, 0.5),
      translateX: prev.scale <= 1 ? 0 : prev.translateX,
      translateY: prev.scale <= 1 ? 0 : prev.translateY,
    }))
  }, [])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      const now = Date.now()
      if (now - lastDoubleClickRef.current < 300) {
        if (zoom.scale > 1) {
          resetZoom()
        }
        else {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left - rect.width / 2
          const y = e.clientY - rect.top - rect.height / 2
          setZoom({
            scale: 2,
            translateX: -x * 2,
            translateY: -y * 2,
          })
        }
        lastDoubleClickRef.current = 0
      }
      else {
        lastDoubleClickRef.current = now
      }
    },
    [zoom.scale, resetZoom],
  )

  const handleWheel = useCallback((e: React.WheelEvent<HTMLImageElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(prev => ({
        ...prev,
        scale: Math.max(0.5, Math.min(3, prev.scale * delta)),
      }))
    }
  }, [])

  return {
    zoom,
    setZoom,
    resetZoom,
    handleZoomIn,
    handleZoomOut,
    handleDoubleClick,
    handleWheel,
  }
}
