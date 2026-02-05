'use client'

import { useEffect, useReducer, useRef } from 'react'

interface AnimationState {
  mounted: boolean
  isVisible: boolean
}

type AnimationAction
  = | { type: 'mount' }
    | { type: 'show' }
    | { type: 'hide' }
    | { type: 'unmount' }

const initialState: AnimationState = {
  mounted: false,
  isVisible: false,
}

function animationReducer(state: AnimationState, action: AnimationAction): AnimationState {
  switch (action.type) {
    case 'mount':
      return { ...state, mounted: true }
    case 'show':
      return { ...state, isVisible: true }
    case 'hide':
      return { ...state, isVisible: false }
    case 'unmount':
      return { mounted: false, isVisible: false }
    default:
      return state
  }
}

export function useLightboxAnimation(open: boolean) {
  const [{ isVisible, mounted }, dispatch] = useReducer(animationReducer, initialState)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const rafIdsRef = useRef<number[]>([])

  useEffect(() => {
    rafIdsRef.current.forEach(id => cancelAnimationFrame(id))
    rafIdsRef.current = []
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (open) {
      const mountId = requestAnimationFrame(() => {
        dispatch({ type: 'mount' })
        const showId = requestAnimationFrame(() => {
          dispatch({ type: 'show' })
        })
        rafIdsRef.current.push(showId)
      })
      rafIdsRef.current.push(mountId)
    }
    else {
      const hideId = requestAnimationFrame(() => {
        dispatch({ type: 'hide' })
      })
      rafIdsRef.current.push(hideId)

      timeoutRef.current = setTimeout(() => {
        dispatch({ type: 'unmount' })
      }, 300)
    }

    return () => {
      rafIdsRef.current.forEach(id => cancelAnimationFrame(id))
      rafIdsRef.current = []
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [open])

  return { isVisible, mounted }
}
