'use client'

import { Time } from '@vidstack/react'
import { cn } from '@/lib/utils'

interface TimeProps {
  className?: string
}

export function CurrentTime({ className }: TimeProps = {}) {
  return <Time className={cn('text-sm font-medium tabular-nums', className)} type="current" />
}

export function Duration({ className }: TimeProps = {}) {
  return (
    <Time
      className={cn('text-sm font-medium text-muted-foreground tabular-nums', className)}
      type="duration"
    />
  )
}
