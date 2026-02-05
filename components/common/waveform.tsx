'use client'

import { useStore } from '@tanstack/react-store'
import { useEffect, useId, useRef, useState } from 'react'
import { getPlayerStore } from '@/stores/player-store'

const bars = {
  total: 90,
  width: 2,
  gap: 2,
  minHeight: 30,
  maxHeight: 100,
}

function generateStaticHeights() {
  return Array.from({ length: bars.total }, (_, index) => {
    const progress = index / bars.total
    const envelope = 1 - (Math.abs(progress - 0.5) * 2) ** 1.2
    const wave = Math.sin(progress * Math.PI * 6 + Math.PI / 4) * 0.3 + 0.7
    const height = envelope * wave
    const calculated = bars.minHeight + height * (bars.maxHeight - bars.minHeight)
    return Math.round(calculated * 10000) / 10000
  })
}

function generateWaveHeights(time: number) {
  return Array.from({ length: bars.total }, (_, index) => {
    const progress = index / bars.total
    const wave1 = Math.sin(progress * Math.PI * 8 + time * 2) * 0.4
    const wave2 = Math.sin(progress * Math.PI * 12 + time * 1.5) * 0.3
    const wave3 = Math.sin(progress * Math.PI * 6 + time * 2.5) * 0.2
    const wave4 = Math.sin(progress * Math.PI * 4 + time * 1.2) * 0.1
    const combined = (wave1 + wave2 + wave3 + wave4 + 1) / 2
    const envelope = 1 - (Math.abs(progress - 0.5) * 2) ** 0.8
    const height = combined * envelope
    const calculated = bars.minHeight + height * (bars.maxHeight - bars.minHeight)
    return Math.round(calculated * 10000) / 10000
  })
}

export function Waveform(props: React.SVGProps<SVGSVGElement>) {
  const id = useId()
  const playerStore = getPlayerStore()
  const isPlaying = useStore(playerStore, state => state.isPlaying)
  const [animatedHeights, setAnimatedHeights] = useState<number[]>(() =>
    generateStaticHeights(),
  )
  const timeRef = useRef(0)
  const staticHeightsRef = useRef(generateStaticHeights())

  useEffect(() => {
    if (!isPlaying) {
      staticHeightsRef.current = generateStaticHeights()
      timeRef.current = 0
    }
  }, [isPlaying])

  useEffect(() => {
    if (!isPlaying)
      return

    let animationFrame = 0
    let lastTime = performance.now()

    const animate = (timestamp: number) => {
      const delta = (timestamp - lastTime) / 1000
      lastTime = timestamp
      timeRef.current += delta * 2
      setAnimatedHeights(generateWaveHeights(timeRef.current))
      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [isPlaying])

  const barHeights = isPlaying ? animatedHeights : staticHeightsRef.current

  return (
    <svg {...props} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="35%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </linearGradient>
        <linearGradient id={`${id}-gradient`}>
          <stop offset="0%" stopColor="var(--theme-gradient-start)" />
          <stop offset="50%" stopColor="var(--theme-gradient-mid)" />
          <stop offset="100%" stopColor="var(--theme-gradient-end)" />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <rect width="100%" height="100%" fill={`url(#${id}-pattern)`} />
        </mask>
        <pattern
          id={`${id}-pattern`}
          width={bars.total * bars.width + bars.total * bars.gap}
          height="100%"
          patternUnits="userSpaceOnUse"
        >
          {Array.from({ length: bars.total }, (_, index) => (
            <rect
              key={index}
              width={bars.width}
              height={`${barHeights[index]}%`}
              x={bars.gap * (index + 1) + bars.width * index}
              fill={`url(#${id}-fade)`}
            />
          ))}
        </pattern>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${id}-gradient)`}
        mask={`url(#${id}-mask)`}
        opacity="0.25"
      />
    </svg>
  )
}
