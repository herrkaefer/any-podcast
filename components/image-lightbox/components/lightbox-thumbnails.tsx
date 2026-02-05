'use client'

import type { ImageInfo } from '@/lib/markdown'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface LightboxThumbnailsProps {
  images: ImageInfo[]
  currentIndex: number
  isDark: boolean
  onThumbnailClick: (index: number) => void
}

export function LightboxThumbnails({ images, currentIndex, isDark, onThumbnailClick }: LightboxThumbnailsProps) {
  const { t } = useTranslation()
  if (images.length <= 1)
    return null

  return (
    <div
      className={`
        absolute right-0 bottom-0 left-0 flex items-center justify-center gap-5
        overflow-x-auto px-4 py-4
      `}
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: isDark ? 'rgba(255, 255, 255, 0.3) transparent' : 'rgba(0, 0, 0, 0.3) transparent',
      }}
    >
      {images.map((img, idx) => {
        const thumbnailAlt = img.alt || t('lightbox.imageAltFallback', { index: idx + 1 })
        return (
          <button
            key={`${img.src}-${img.alt}`}
            type="button"
            onClick={() => onThumbnailClick(idx)}
            className={cn(
              `
                group relative flex-shrink-0 overflow-hidden rounded-lg
                transition-all duration-300
              `,
              idx === currentIndex
                ? 'scale-110 opacity-100'
                : `
                  opacity-70
                  hover:scale-105 hover:opacity-100
                `,
            )}
            style={{ width: '80px', height: '80px' }}
            aria-label={t('lightbox.viewImage', { index: idx + 1 })}
          >
            <div className="relative h-full w-full">
              <Image
                src={img.src}
                alt={thumbnailAlt}
                fill
                sizes="80px"
                className={cn(
                  'object-cover transition-transform duration-300',
                  idx === currentIndex && 'scale-105',
                )}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
