'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

export function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== 'undefined',
    () => false,
  )
}
