import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const ONE_DAY = 24 * 60 * 60 * 1000
const CONTENT_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function getPastDays(days: number) {
  return Array.from({ length: days }, (_, index) => {
    return new Date(Date.now() - index * ONE_DAY).toISOString().split('T')[0]
  })
}

export async function listContentDays(kv: KVNamespace, prefix: string) {
  const days = new Set<string>()
  let cursor: string | undefined

  do {
    const result = await kv.list({ prefix, cursor, limit: 1000 })
    for (const key of result.keys) {
      const day = key.name.slice(prefix.length)
      if (CONTENT_DAY_PATTERN.test(day)) {
        days.add(day)
      }
    }
    cursor = result.list_complete ? undefined : result.cursor
  } while (cursor)

  return Array.from(days).sort((a, b) => b.localeCompare(a))
}

export async function getContentDays(kv: KVNamespace, prefix: string, dayLimit: number) {
  if (dayLimit > 0) {
    return getPastDays(dayLimit)
  }

  return listContentDays(kv, prefix)
}
