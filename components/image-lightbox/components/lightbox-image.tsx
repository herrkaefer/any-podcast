'use client'

import type { ZoomState } from '@/components/image-lightbox/types'
import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LightboxImageProps {
  src: string
  alt: string
  zoom: ZoomState
  onDoubleClick: (e: React.MouseEvent<HTMLImageElement>) => void
  onWheel: (e: React.WheelEvent<HTMLImageElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLImageElement>) => void
  onMouseMove: (e: React.MouseEvent<HTMLImageElement>) => void
  onMouseUp: () => void
  onTouchStart: (e: React.TouchEvent<HTMLImageElement>) => void
  onTouchMove: (e: React.TouchEvent<HTMLImageElement>) => void
  onTouchEnd: () => void
}

export function LightboxImage({
  src,
  alt,
  zoom,
  onDoubleClick,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: LightboxImageProps) {
  return (
    <div className={`
      relative flex w-full flex-1 items-center justify-center px-4 py-20
    `}
    >
      <div className="relative max-h-[70vh] w-full max-w-[80vw]">
        <Image
          src={src}
          alt={alt}
          width={1600}
          height={900}
          sizes="(max-width: 768px) 90vw, 80vw"
          className={cn(
            'rounded-lg object-contain transition-transform duration-300',
            zoom.scale !== 1 ? 'cursor-move' : 'cursor-zoom-in',
          )}
          style={{
            transform: `scale(${zoom.scale}) translate(${zoom.translateX / zoom.scale}px, ${zoom.translateY / zoom.scale}px)`,
            transformOrigin: 'center center',
          }}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          draggable={false}
          priority
        />
      </div>
    </div>
  )
}
